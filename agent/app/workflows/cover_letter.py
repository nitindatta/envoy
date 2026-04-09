"""LangGraph workflow for cover letter generation.

Nodes:
  extract_requirements  → LLM: pull key themes/skills from the job description
  match_profile         → LLM: find the best available profile evidence per requirement
  evaluate_fit          → LLM: score overall fit; route to write or gaps summary
  write_draft           → LLM: write the letter from matched evidence
  check_length          → deterministic: trim to max_words if over limit

Conditional edge after evaluate_fit:
  fit_score >= 0.5  →  write_draft → check_length → END
  fit_score < 0.5   →  END (cover_letter = "", gaps populated)

Callers should check CoverLetterResult.is_suitable before using the letter.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from langgraph.graph import StateGraph, END
from pydantic import BaseModel, Field
from openai import AsyncOpenAI

from app.settings import Settings
from app.state.prepare import SeekJobDetail


# ── State ──────────────────────────────────────────────────────────────────

class CoverLetterState(BaseModel):
    # Inputs
    job_title: str
    job_company: str
    job_description: str
    job_salary: str | None = None

    name: str
    headline: str
    summary: str
    experience_text: str
    projects_text: str
    skills: str

    tone: str = "consultative, senior, practical"
    max_words: int = 320

    # Intermediate outputs
    requirements: str = ""
    evidence: str = ""
    fit_score: float = 1.0          # 0.0–1.0 from evaluate_fit
    fit_verdict: str = ""           # "suitable" | "not_suitable"
    gaps: list[str] = Field(default_factory=list)
    draft: str = ""

    # Final output
    cover_letter: str = ""
    word_count: int = 0
    is_suitable: bool = True


# ── Result returned to callers ─────────────────────────────────────────────

class CoverLetterResult(BaseModel):
    is_suitable: bool
    cover_letter: str = ""          # empty when not suitable
    gaps: list[str] = Field(default_factory=list)   # populated when not suitable


# ── Graph ──────────────────────────────────────────────────────────────────

def build_cover_letter_graph(settings: Settings) -> Any:
    client = AsyncOpenAI(
        base_url=settings.openai_base_url,
        api_key=settings.openai_api_key,
    )

    # ── Node 1: extract_requirements ───────────────────────────────────────
    async def extract_requirements(state: CoverLetterState) -> dict:
        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Extract the 4-5 most important requirements from this job description. "
                        "Be specific — name the actual skills, behaviours, or deliverables asked for. "
                        "Return a numbered list only. No preamble."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Job: {state.job_title} at {state.job_company}\n\n{state.job_description[:3000]}",
                },
            ],
            temperature=0.1,
            max_tokens=300,
        )
        return {"requirements": response.choices[0].message.content or ""}

    # ── Node 2: match_profile ──────────────────────────────────────────────
    async def match_profile(state: CoverLetterState) -> dict:
        """Find the best available match for each requirement.
        Always return a match — the fit evaluator will judge quality, not this node."""
        profile_block = f"""Name: {state.name}
Headline: {state.headline}
Summary: {state.summary}

Experience:
{state.experience_text}

Projects:
{state.projects_text}

Skills: {state.skills}"""

        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You match a candidate profile to job requirements. "
                        "For each requirement, find the CLOSEST matching item from the profile "
                        "(a role, project, skill, or summary point). "
                        "Always pick something — your job is to find the best available evidence, "
                        "not to judge fit. Rate each match as STRONG, MODERATE, or WEAK. "
                        "Format each item as: [STRONG/MODERATE/WEAK] Requirement → Evidence\n"
                        "Do not say 'no match' or 'no evidence'. Always cite the closest item."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"REQUIREMENTS:\n{state.requirements}\n\n"
                        f"CANDIDATE PROFILE:\n{profile_block}"
                    ),
                },
            ],
            temperature=0.1,
            max_tokens=600,
        )
        return {"evidence": response.choices[0].message.content or ""}

    # ── Node 3: evaluate_fit ───────────────────────────────────────────────
    async def evaluate_fit(state: CoverLetterState) -> dict:
        """Score overall fit and identify gaps. Routes to write or gaps summary."""
        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You evaluate how well a candidate matches a job based on the evidence mapping provided. "
                        "Return JSON with exactly these keys:\n"
                        '{"fit_score": 0.0-1.0, "verdict": "suitable" or "not_suitable", '
                        '"gaps": ["gap 1", "gap 2"]}\n'
                        "fit_score >= 0.5 means suitable (enough evidence to write a credible letter). "
                        "gaps should name the specific missing skills/experience, max 3 items. "
                        "Return ONLY the JSON object, no other text."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Job: {state.job_title} at {state.job_company}\n\n"
                        f"Evidence mapping:\n{state.evidence}"
                    ),
                },
            ],
            temperature=0.1,
            max_tokens=200,
        )

        raw = response.choices[0].message.content or "{}"
        # Strip markdown code fences if present
        raw = re.sub(r"```[a-z]*\n?", "", raw).strip()

        try:
            import json
            parsed = json.loads(raw)
            fit_score = float(parsed.get("fit_score", 0.5))
            verdict = parsed.get("verdict", "suitable")
            gaps = parsed.get("gaps", [])
        except Exception:
            fit_score = 0.5
            verdict = "suitable"
            gaps = []

        is_suitable = fit_score >= 0.5
        return {
            "fit_score": fit_score,
            "fit_verdict": verdict,
            "gaps": gaps,
            "is_suitable": is_suitable,
        }

    # ── Node 4: write_draft ────────────────────────────────────────────────
    async def write_draft(state: CoverLetterState) -> dict:
        # Only use STRONG and MODERATE evidence items
        strong_evidence = "\n".join(
            line for line in state.evidence.splitlines()
            if "[STRONG]" in line or "[MODERATE]" in line
        ) or state.evidence  # fallback to all if nothing tagged

        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"Write a cover letter in a {state.tone} tone. "
                        f"Target {state.max_words} words. "
                        "Use only the evidence items provided as talking points. "
                        "Open with one specific sentence naming the fit. "
                        "Then 2-3 sentences of evidence. Brief closing. "
                        "No 'I am excited to apply', no generic phrases, no sign-off."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Write a cover letter for {state.name} applying to "
                        f"{state.job_title} at {state.job_company}.\n\n"
                        f"Use these matched talking points:\n{strong_evidence}"
                    ),
                },
            ],
            temperature=0.35,
            max_tokens=700,
        )
        return {"draft": response.choices[0].message.content or ""}

    # ── Node 5: check_length ───────────────────────────────────────────────
    def check_length(state: CoverLetterState) -> dict:
        text = state.draft.strip()
        words = text.split()
        word_count = len(words)

        if word_count <= state.max_words:
            return {"cover_letter": text, "word_count": word_count}

        truncated = " ".join(words[: state.max_words])
        match = re.search(r"[.!?][^.!?]*$", truncated)
        if match:
            truncated = truncated[: match.start() + 1]

        return {"cover_letter": truncated.strip(), "word_count": len(truncated.split())}

    # ── Routing ────────────────────────────────────────────────────────────
    def route_after_evaluate(state: CoverLetterState) -> Literal["write_draft", "__end__"]:
        return "write_draft" if state.is_suitable else END

    # ── Assemble ───────────────────────────────────────────────────────────
    graph = StateGraph(CoverLetterState)
    graph.add_node("extract_requirements", extract_requirements)
    graph.add_node("match_profile", match_profile)
    graph.add_node("evaluate_fit", evaluate_fit)
    graph.add_node("write_draft", write_draft)
    graph.add_node("check_length", check_length)

    graph.set_entry_point("extract_requirements")
    graph.add_edge("extract_requirements", "match_profile")
    graph.add_edge("match_profile", "evaluate_fit")
    graph.add_conditional_edges("evaluate_fit", route_after_evaluate)
    graph.add_edge("write_draft", "check_length")
    graph.add_edge("check_length", END)

    return graph.compile()


# ── Helpers ────────────────────────────────────────────────────────────────

def _format_experience(profile: dict) -> str:
    lines = []
    for exp in profile.get("experience", [])[:5]:
        line = f"- {exp.get('title', '')} at {exp.get('company', '')}"
        period = exp.get("period", "")
        if period:
            line += f" ({period})"
        for h in exp.get("highlights", [])[:4]:
            line += f"\n    • {h}"
        lines.append(line)
    return "\n".join(lines) or "Not provided"


def _format_projects(profile: dict) -> str:
    lines = [
        f"- {p.get('name')}: {p.get('summary', '')}"
        for p in profile.get("selected_projects", [])
    ]
    return "\n".join(lines) or "None listed"


# ── Public entry point ─────────────────────────────────────────────────────

async def run_cover_letter(
    settings: Settings,
    *,
    job: SeekJobDetail,
    profile: dict,
) -> CoverLetterResult:
    prefs = profile.get("proposal_preferences", {})

    initial = CoverLetterState(
        job_title=job.title,
        job_company=job.company,
        job_description=job.description,
        job_salary=job.salary,
        name=profile.get("name", ""),
        headline=profile.get("headline", ""),
        summary=profile.get("summary", ""),
        experience_text=_format_experience(profile),
        projects_text=_format_projects(profile),
        skills=", ".join(profile.get("core_strengths", [])),
        tone=prefs.get("tone", "consultative, senior, practical"),
        max_words=prefs.get("max_words", 320),
    )

    graph = build_cover_letter_graph(settings)
    result = await graph.ainvoke(initial.model_dump())
    state = CoverLetterState.model_validate(result)

    return CoverLetterResult(
        is_suitable=state.is_suitable,
        cover_letter=state.cover_letter,
        gaps=state.gaps,
    )
