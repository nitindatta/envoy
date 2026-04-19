"""Structured cover letter workflow implementation."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Literal

from langgraph.graph import END, StateGraph
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from app.settings import Settings
from app.state.prepare import SeekJobDetail

log = logging.getLogger("cover_letter")

_TITLE_WORDS = {
    "recruiter",
    "recruitment",
    "manager",
    "team",
    "hr",
    "hiring",
    "talent",
    "acquisition",
    "coordinator",
    "specialist",
    "officer",
    "department",
    "admin",
    "administrator",
    "contact",
    "enquiries",
    "ceo",
    "cto",
    "coo",
    "cfo",
    "founder",
    "co-founder",
    "director",
    "president",
    "executive",
    "vp",
    "vice",
    "principal",
    "owner",
    "head",
    "chief",
    "partner",
}
_STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "into",
    "is",
    "of",
    "on",
    "or",
    "that",
    "the",
    "their",
    "this",
    "to",
    "with",
    "will",
    "you",
    "your",
    "our",
    "we",
}
_GENERIC_PHRASES = {
    "excited to apply",
    "passionate about",
    "fast learner",
    "team player",
    "strong communicator",
    "strong communication skills",
}


class RequirementItem(BaseModel):
    id: str
    requirement: str
    priority: Literal["high", "medium", "low"] = "medium"


class EvidenceCard(BaseModel):
    id: str
    source: str
    role_title: str = ""
    confidence: str = "draft"
    situation: str = ""
    task: str = ""
    action: str = ""
    outcome: str = ""
    metrics: list[str] = Field(default_factory=list)
    proof_points: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    allowed_claim_seed: list[str] = Field(default_factory=list)
    completeness_score: float = 0.0
    is_project: bool = False


class SelectedEvidenceMatch(BaseModel):
    requirement_id: str
    requirement: str
    priority: Literal["high", "medium", "low"] = "medium"
    matched_evidence_ids: list[str] = Field(default_factory=list)
    support_level: Literal["strong", "moderate", "weak"] = "weak"
    allowed_claims: list[str] = Field(default_factory=list)
    rationale: str = ""
    gaps: list[str] = Field(default_factory=list)


class LetterPlanParagraph(BaseModel):
    paragraph: int
    purpose: str
    requirement_ids: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    angle: str = ""


class LetterPlan(BaseModel):
    opening_angle: str = ""
    paragraph_plan: list[LetterPlanParagraph] = Field(default_factory=list)
    closing_angle: str = ""
    must_include: list[str] = Field(default_factory=list)
    must_avoid: list[str] = Field(default_factory=list)


class CritiqueResult(BaseModel):
    pass_review: bool = True
    issues: list[str] = Field(default_factory=list)
    rewrite_required: bool = False
    coverage_score: float = 0.0
    grounding_score: float = 0.0
    tone_score: float = 0.0
    revision_brief: str = ""


class CoverLetterState(BaseModel):
    job_title: str
    job_company: str
    job_description: str
    job_salary: str | None = None
    name: str
    headline: str
    summary: str
    narrative_strengths_text: str
    experience_text: str
    projects_text: str
    skills: str
    tone: str = "consultative, senior, practical"
    max_words: int = 320
    writing_samples: list[str] = Field(default_factory=list)
    voice_profile: dict[str, Any] = Field(default_factory=dict)
    profile_source: str = ""
    approved_evidence_count: int = 0
    cached_must_have: list[str] = Field(default_factory=list)
    cached_duties: list[str] = Field(default_factory=list)
    cached_nice_to_have: list[str] = Field(default_factory=list)
    cached_contact_name: str = ""
    contact_name: str = ""
    requirements: str = ""
    bonus_requirements: str = ""
    requirements_json: list[RequirementItem] = Field(default_factory=list)
    evidence_catalog: list[EvidenceCard] = Field(default_factory=list)
    selected_evidence: list[SelectedEvidenceMatch] = Field(default_factory=list)
    letter_plan: LetterPlan = Field(default_factory=LetterPlan)
    critique: CritiqueResult = Field(default_factory=CritiqueResult)
    evidence: str = ""
    fit_score: float = 1.0
    fit_verdict: str = ""
    gaps: list[str] = Field(default_factory=list)
    draft: str = ""
    cover_letter: str = ""
    word_count: int = 0
    is_suitable: bool = True


class CoverLetterResult(BaseModel):
    is_suitable: bool
    cover_letter: str = ""
    gaps: list[str] = Field(default_factory=list)
    evidence: str = ""


def _is_real_name(value: str) -> bool:
    if not value or not value.strip():
        return False
    lower = value.strip().lower()
    words = re.split(r"[\s,]+", lower)
    if any(word in _TITLE_WORDS for word in words):
        return False
    return any(re.match(r"^[a-z]+$", word) for word in words)


def _strip_code_fences(raw: str) -> str:
    return re.sub(r"```[a-z]*\n?", "", raw).strip()


def _parse_json(raw: str) -> Any | None:
    try:
        return json.loads(_strip_code_fences(raw))
    except Exception:
        return None


def _priority_for_index(index: int) -> Literal["high", "medium", "low"]:
    if index < 3:
        return "high"
    if index < 6:
        return "medium"
    return "low"


def _requirement_items_from_lists(must_have: list[str], duties: list[str]) -> list[RequirementItem]:
    items: list[RequirementItem] = []
    seen: set[str] = set()
    for index, requirement in enumerate(must_have):
        text = str(requirement).strip()
        key = text.lower()
        if not text or key in seen:
            continue
        seen.add(key)
        items.append(
            RequirementItem(
                id=f"must-{len(items) + 1}",
                requirement=text,
                priority=_priority_for_index(index),
            )
        )
    for duty in duties[:3]:
        text = str(duty).strip()
        key = text.lower()
        if not text or key in seen:
            continue
        seen.add(key)
        items.append(
            RequirementItem(
                id=f"duty-{len(items) + 1}",
                requirement=text,
                priority="medium",
            )
        )
    return items


def _claim_fragments(
    *,
    situation: str = "",
    task: str = "",
    action: str = "",
    outcome: str = "",
    metrics: list[str] | None = None,
    proof_points: list[str] | None = None,
) -> list[str]:
    claims: list[str] = []
    for value in (situation, task, action, outcome):
        text = str(value).strip()
        if text and text not in claims:
            claims.append(text)
    for metric in metrics or []:
        text = str(metric).strip()
        if text and text not in claims:
            claims.append(text)
    for point in proof_points or []:
        text = str(point).strip()
        if text and text not in claims:
            claims.append(text)
    return claims


def _completeness_score(
    *,
    situation: str = "",
    task: str = "",
    action: str = "",
    outcome: str = "",
    metrics: list[str] | None = None,
) -> float:
    score = 0.0
    score += 0.2 if str(situation).strip() else 0.0
    score += 0.2 if str(task).strip() else 0.0
    score += 0.2 if str(action).strip() else 0.0
    score += 0.25 if str(outcome).strip() else 0.0
    score += 0.15 if metrics else 0.0
    return round(min(score, 1.0), 2)


def _evidence_card_from_item(item: dict) -> EvidenceCard:
    metrics = [str(metric).strip() for metric in item.get("metrics", []) if str(metric).strip()]
    proof_points = [str(point).strip() for point in item.get("proof_points", []) if str(point).strip()]
    situation = str(item.get("situation") or "")
    task = str(item.get("task") or "")
    action = str(item.get("action") or "")
    outcome = str(item.get("outcome") or "")
    return EvidenceCard(
        id=str(item.get("id") or f"evidence-{item.get('source', 'item')}"),
        source=str(item.get("source") or "Evidence"),
        role_title=str(item.get("role_title") or ""),
        confidence=str(item.get("confidence") or "draft"),
        situation=situation,
        task=task,
        action=action,
        outcome=outcome,
        metrics=metrics,
        proof_points=proof_points,
        tags=[
            *[str(skill).strip() for skill in item.get("skills", []) if str(skill).strip()],
            *[str(domain).strip() for domain in item.get("domain", []) if str(domain).strip()],
        ],
        allowed_claim_seed=_claim_fragments(
            situation=situation,
            task=task,
            action=action,
            outcome=outcome,
            metrics=metrics,
            proof_points=proof_points,
        ),
        completeness_score=_completeness_score(
            situation=situation,
            task=task,
            action=action,
            outcome=outcome,
            metrics=metrics,
        ),
        is_project=str(item.get("role_title") or "").strip().lower() == "project",
    )


def _evidence_card_from_legacy_experience(exp: dict, index: int) -> EvidenceCard:
    highlights = [str(highlight).strip() for highlight in exp.get("highlights", []) if str(highlight).strip()]
    metrics = [str(metric).strip() for metric in exp.get("metrics", []) if str(metric).strip()]
    action = highlights[0] if highlights else ""
    proof_points = highlights[1:]
    outcome = metrics[0] if metrics else ""
    return EvidenceCard(
        id=f"legacy-exp-{index + 1}",
        source=str(exp.get("company") or f"Experience {index + 1}"),
        role_title=str(exp.get("title") or ""),
        confidence="draft",
        action=action,
        outcome=outcome,
        metrics=metrics,
        proof_points=proof_points,
        tags=[str(skill).strip() for skill in exp.get("skills", []) if str(skill).strip()],
        allowed_claim_seed=_claim_fragments(action=action, outcome=outcome, metrics=metrics, proof_points=proof_points),
        completeness_score=_completeness_score(action=action, outcome=outcome, metrics=metrics),
    )


def _evidence_card_from_legacy_project(project: dict, index: int) -> EvidenceCard:
    summary = str(project.get("summary") or "").strip()
    proof_points = [summary] if summary else []
    return EvidenceCard(
        id=f"legacy-project-{index + 1}",
        source=str(project.get("name") or f"Project {index + 1}"),
        role_title="Project",
        confidence="draft",
        action=summary,
        proof_points=proof_points,
        tags=[str(tech).strip() for tech in project.get("technologies", []) if str(tech).strip()],
        allowed_claim_seed=_claim_fragments(action=summary, proof_points=proof_points),
        completeness_score=_completeness_score(action=summary),
        is_project=True,
    )


def _sort_evidence_cards(cards: list[EvidenceCard]) -> list[EvidenceCard]:
    def _sort_key(card: EvidenceCard) -> tuple[int, float, str]:
        confidence_rank = 0 if card.confidence.strip().lower() == "approved" else 1
        return (confidence_rank, -card.completeness_score, f"{card.source} {card.role_title}".lower())

    return sorted(cards, key=_sort_key)


def _build_evidence_catalog(profile: dict) -> list[EvidenceCard]:
    cards: list[EvidenceCard] = []
    evidence_items = [item for item in profile.get("evidence_items", []) if isinstance(item, dict)]
    if evidence_items:
        cards.extend(_evidence_card_from_item(item) for item in evidence_items)
        return _sort_evidence_cards(cards)

    for index, exp in enumerate(profile.get("experience", [])):
        if isinstance(exp, dict):
            cards.append(_evidence_card_from_legacy_experience(exp, index))
    for index, project in enumerate(profile.get("selected_projects", [])):
        if isinstance(project, dict):
            cards.append(_evidence_card_from_legacy_project(project, index))
    return _sort_evidence_cards(cards)


def _normalize_tokens(text: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9]+", text.lower())
        if len(token) > 2 and token not in _STOP_WORDS
    }


def _card_search_text(card: EvidenceCard) -> str:
    return " ".join(
        filter(
            None,
            [
                card.source,
                card.role_title,
                card.situation,
                card.task,
                card.action,
                card.outcome,
                " ".join(card.metrics),
                " ".join(card.proof_points),
                " ".join(card.tags),
            ],
        )
    )


def _score_card_for_requirement(requirement: RequirementItem, card: EvidenceCard) -> float:
    req_tokens = _normalize_tokens(requirement.requirement)
    card_tokens = _normalize_tokens(_card_search_text(card))
    overlap = len(req_tokens & card_tokens)
    score = float(overlap)
    score += card.completeness_score * 2.0
    if card.confidence.strip().lower() == "approved":
        score += 1.0
    if card.metrics:
        score += 0.5
    if card.outcome:
        score += 0.5
    return score


def _support_level_from_score(score: float) -> Literal["strong", "moderate", "weak"]:
    if score >= 4.0:
        return "strong"
    if score >= 2.4:
        return "moderate"
    return "weak"


def _gaps_for_card(card: EvidenceCard) -> list[str]:
    gaps: list[str] = []
    if not card.outcome:
        gaps.append("missing outcome")
    if not card.metrics:
        gaps.append("missing metric")
    if not card.task:
        gaps.append("ownership could be clearer")
    return gaps


def _fallback_select_evidence(
    requirements: list[RequirementItem],
    evidence_catalog: list[EvidenceCard],
) -> list[SelectedEvidenceMatch]:
    selections: list[SelectedEvidenceMatch] = []
    for requirement in requirements:
        ranked = sorted(
            evidence_catalog,
            key=lambda card: _score_card_for_requirement(requirement, card),
            reverse=True,
        )
        top_card = ranked[0] if ranked else None
        score = _score_card_for_requirement(requirement, top_card) if top_card else 0.0
        support = _support_level_from_score(score)
        selections.append(
            SelectedEvidenceMatch(
                requirement_id=requirement.id,
                requirement=requirement.requirement,
                priority=requirement.priority,
                matched_evidence_ids=[top_card.id] if top_card else [],
                support_level=support,
                allowed_claims=(top_card.allowed_claim_seed[:5] if top_card else []),
                rationale=(
                    f"Best available overlap from {top_card.source}"
                    if top_card
                    else "No evidence available"
                ),
                gaps=(_gaps_for_card(top_card) if top_card else ["no evidence item available"]),
            )
        )
    return selections


def _selected_evidence_from_payload(payload: Any) -> list[SelectedEvidenceMatch] | None:
    if isinstance(payload, dict):
        payload = payload.get("matches") or payload.get("selected_evidence") or payload.get("items")
    if not isinstance(payload, list):
        return None
    try:
        return [SelectedEvidenceMatch.model_validate(item) for item in payload]
    except Exception:
        return None


def _render_match_evidence(
    selected_evidence: list[SelectedEvidenceMatch],
    evidence_catalog: list[EvidenceCard],
) -> str:
    by_id = {card.id: card for card in evidence_catalog}
    lines: list[str] = []
    for match in selected_evidence:
        label = match.support_level.upper()
        sources = [
            f"{by_id[evidence_id].source} ({by_id[evidence_id].role_title})".strip()
            if evidence_id in by_id
            else evidence_id
            for evidence_id in match.matched_evidence_ids
        ]
        claim = match.allowed_claims[0] if match.allowed_claims else "No safe claim selected"
        evidence_text = "; ".join(filter(None, [", ".join(sources), claim]))
        lines.append(f"[{label}] {match.requirement} -> {evidence_text}".strip())
    return "\n".join(lines)


def _evaluate_selected_evidence(
    requirements: list[RequirementItem],
    selected_evidence: list[SelectedEvidenceMatch],
) -> tuple[float, str, list[str], bool]:
    support_scores = {"strong": 1.0, "moderate": 0.68, "weak": 0.25}
    priority_weights = {"high": 1.4, "medium": 1.0, "low": 0.7}
    selected_by_id = {match.requirement_id: match for match in selected_evidence}
    total_weight = 0.0
    weighted_score = 0.0
    gaps: list[str] = []
    high_priority_weak = 0

    for requirement in requirements:
        weight = priority_weights.get(requirement.priority, 1.0)
        total_weight += weight
        match = selected_by_id.get(requirement.id)
        if match is None:
            gaps.append(requirement.requirement)
            if requirement.priority == "high":
                high_priority_weak += 1
            continue

        support_score = support_scores.get(match.support_level, 0.25)
        weighted_score += support_score * weight
        if match.support_level == "weak" or not match.matched_evidence_ids:
            gaps.append(requirement.requirement)
            if requirement.priority == "high":
                high_priority_weak += 1

    fit_score = round(weighted_score / total_weight, 2) if total_weight else 0.0
    high_priority_count = sum(1 for requirement in requirements if requirement.priority == "high")
    is_suitable = fit_score >= 0.55 and high_priority_weak <= max(1, high_priority_count // 2)
    verdict = "suitable" if is_suitable else "not_suitable"
    return fit_score, verdict, gaps[:3], is_suitable


def _fallback_plan_letter(
    requirements: list[RequirementItem],
    selected_evidence: list[SelectedEvidenceMatch],
) -> LetterPlan:
    usable = [match for match in selected_evidence if match.matched_evidence_ids]
    if not usable:
        return LetterPlan(
            opening_angle="Direct fit statement based on the strongest available evidence.",
            paragraph_plan=[],
            closing_angle="Keep the close practical and role-focused.",
            must_include=["one concrete result"],
            must_avoid=["generic enthusiasm", "unsupported claims"],
        )

    ordered = sorted(
        usable,
        key=lambda match: (
            0 if match.priority == "high" else 1 if match.priority == "medium" else 2,
            0 if match.support_level == "strong" else 1 if match.support_level == "moderate" else 2,
        ),
    )
    paragraph_plan: list[LetterPlanParagraph] = []
    for paragraph_index, match in enumerate(ordered[:3], start=1):
        purpose = "core fit" if paragraph_index == 1 else "delivery depth" if paragraph_index == 2 else "role alignment"
        paragraph_plan.append(
            LetterPlanParagraph(
                paragraph=paragraph_index,
                purpose=purpose,
                requirement_ids=[match.requirement_id],
                evidence_ids=match.matched_evidence_ids[:1],
                angle=match.requirement,
            )
        )

    return LetterPlan(
        opening_angle=f"Open with direct fit for {ordered[0].requirement}.",
        paragraph_plan=paragraph_plan,
        closing_angle="Close on practical interest in the role and immediate relevance.",
        must_include=["one specific result", "clear ownership"],
        must_avoid=["generic enthusiasm", "unsupported metrics"],
    )


def _fallback_critique(
    draft: str,
    plan: LetterPlan,
    selected_evidence: list[SelectedEvidenceMatch],
    voice_profile: dict[str, Any],
) -> CritiqueResult:
    lowered = draft.lower()
    issues: list[str] = []
    for phrase in _GENERIC_PHRASES:
        if phrase in lowered:
            issues.append(f"Remove generic phrase: {phrase}")
    if not draft.strip():
        issues.append("Draft is empty.")
    if len(plan.paragraph_plan) > 0:
        paragraph_count = len([paragraph for paragraph in draft.split("\n\n") if paragraph.strip()])
        if paragraph_count < min(3, len(plan.paragraph_plan)):
            issues.append("Cover letter is missing planned paragraph coverage.")
    if not any(char.isdigit() for char in draft):
        if any(any(char.isdigit() for char in claim) for match in selected_evidence for claim in match.allowed_claims):
            issues.append("A quantified claim was available but not used.")
    tone_score = 0.75 if voice_profile.get("tone_labels") else 0.65
    coverage_score = max(0.0, 1.0 - (0.2 * len(issues)))
    grounding_score = 0.85 if not issues else max(0.45, 0.85 - (0.15 * len(issues)))
    return CritiqueResult(
        pass_review=not issues,
        issues=issues,
        rewrite_required=bool(issues),
        coverage_score=round(coverage_score, 2),
        grounding_score=round(grounding_score, 2),
        tone_score=round(tone_score, 2),
        revision_brief="Tighten claims to stay grounded and remove generic phrasing." if issues else "",
    )


def _voice_block(state: CoverLetterState) -> str:
    lines: list[str] = []
    if state.voice_profile:
        lines.append("VOICE PROFILE")
        tone_labels = state.voice_profile.get("tone_labels") or []
        if tone_labels:
            lines.append(f"- tone_labels: {', '.join(str(label) for label in tone_labels)}")
        for key in ("formality", "sentence_style", "opening_style"):
            value = state.voice_profile.get(key)
            if value:
                lines.append(f"- {key}: {value}")
        for key in ("uses_contractions", "prefers_first_person"):
            value = state.voice_profile.get(key)
            if isinstance(value, bool):
                lines.append(f"- {key}: {'yes' if value else 'no'}")
        avoid = state.voice_profile.get("avoid") or []
        if avoid:
            lines.append(f"- avoid: {', '.join(str(item) for item in avoid)}")
    if state.writing_samples:
        lines.append("VOICE SAMPLES")
        for sample in state.writing_samples[:6]:
            lines.append(f'"{sample}"')
    elif state.summary:
        lines.append("VOICE SAMPLE")
        lines.append(f'"{state.summary[:600]}"')
    return "\n".join(lines)


def _serialize_selected_evidence(
    selected_evidence: list[SelectedEvidenceMatch],
    evidence_catalog: list[EvidenceCard],
) -> str:
    by_id = {card.id: card for card in evidence_catalog}
    payload: list[dict[str, Any]] = []
    for match in selected_evidence:
        payload.append(
            {
                "requirement_id": match.requirement_id,
                "requirement": match.requirement,
                "priority": match.priority,
                "support_level": match.support_level,
                "allowed_claims": match.allowed_claims,
                "gaps": match.gaps,
                "evidence_cards": [
                    by_id[evidence_id].model_dump()
                    for evidence_id in match.matched_evidence_ids
                    if evidence_id in by_id
                ],
            }
        )
    return json.dumps(payload, ensure_ascii=True, indent=2)


def build_cover_letter_graph(settings: Settings) -> Any:
    client = AsyncOpenAI(base_url=settings.openai_base_url, api_key=settings.openai_api_key)

    async def parse_jd(state: CoverLetterState) -> dict[str, Any]:
        if state.cached_must_have:
            must_have = state.cached_must_have
            duties = state.cached_duties
            nice_to_have = state.cached_nice_to_have
            contact_name = state.cached_contact_name if _is_real_name(state.cached_contact_name) else ""
            requirements = "\n".join(f"{index + 1}. {item}" for index, item in enumerate(must_have))
            bonus = "\n".join(f"- {item}" for item in nice_to_have)
            requirement_items = _requirement_items_from_lists(must_have, duties)
            return {
                "requirements": requirements,
                "bonus_requirements": bonus,
                "contact_name": contact_name,
                "requirements_json": [item.model_dump() for item in requirement_items],
            }

        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Parse a job description into structured data.\n"
                        "Return JSON with exactly these keys:\n"
                        '{"must_have": ["..."], "duties": ["..."], "nice_to_have": ["..."], '
                        '"contact_name": "...", "contact_confidence": "high|low"}\n'
                        "must_have should capture the concrete requirements the candidate must bring. "
                        "duties should capture the main role themes and responsibilities. "
                        "nice_to_have should only include explicit bonus or preferred items. "
                        'Only return a contact_name when the JD clearly names the application contact. '
                        "Return JSON only."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Job: {state.job_title} at {state.job_company}\n\n{state.job_description[:4000]}",
                },
            ],
            temperature=0.1,
            max_tokens=700,
        )
        parsed = _parse_json(response.choices[0].message.content or "{}") or {}
        must_have = [str(item).strip() for item in parsed.get("must_have", []) if str(item).strip()]
        duties = [str(item).strip() for item in parsed.get("duties", []) if str(item).strip()]
        nice_to_have = [str(item).strip() for item in parsed.get("nice_to_have", []) if str(item).strip()]
        raw_contact = str(parsed.get("contact_name", "")).strip()
        confidence = str(parsed.get("contact_confidence", "low")).strip().lower()
        contact_name = raw_contact if confidence == "high" and _is_real_name(raw_contact) else ""

        requirement_items = _requirement_items_from_lists(must_have, duties)
        requirements = "\n".join(f"{index + 1}. {item.requirement}" for index, item in enumerate(requirement_items))
        bonus = "\n".join(f"- {item}" for item in nice_to_have)
        log.info(
            "[parse_jd] job=%s must_have=%d duties=%d nice_to_have=%d contact=%r",
            state.job_title,
            len(must_have),
            len(duties),
            len(nice_to_have),
            contact_name,
        )
        return {
            "requirements": requirements,
            "bonus_requirements": bonus,
            "contact_name": contact_name,
            "requirements_json": [item.model_dump() for item in requirement_items],
        }

    async def select_evidence(state: CoverLetterState) -> dict[str, Any]:
        requirements = state.requirements_json
        evidence_catalog = state.evidence_catalog
        fallback = _fallback_select_evidence(requirements, evidence_catalog)

        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You select the best profile evidence for each job requirement.\n"
                        "Return JSON only. Use either a raw JSON array or an object with a 'matches' key.\n"
                        "Each match must use exactly these keys:\n"
                        '{"requirement_id": "...", "requirement": "...", "priority": "high|medium|low", '
                        '"matched_evidence_ids": ["..."], "support_level": "strong|moderate|weak", '
                        '"allowed_claims": ["..."], "rationale": "...", "gaps": ["..."]}\n'
                        "Rules:\n"
                        "- Prefer approved evidence when it supports the requirement.\n"
                        "- allowed_claims may only restate facts already present in the evidence card.\n"
                        "- Never invent metrics, scale, ownership, or outcomes.\n"
                        "- If evidence is weak, keep support_level='weak' and explain the gap.\n"
                        "- Use at most 2 evidence ids per requirement.\n"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"REQUIREMENTS JSON:\n{json.dumps([item.model_dump() for item in requirements], indent=2)}\n\n"
                        f"EVIDENCE CATALOG JSON:\n{json.dumps([card.model_dump() for card in evidence_catalog], indent=2)}"
                    ),
                },
            ],
            temperature=0.1,
            max_tokens=1400,
        )

        parsed = _selected_evidence_from_payload(_parse_json(response.choices[0].message.content or "[]"))
        selected = parsed or fallback
        evidence_text = _render_match_evidence(selected, evidence_catalog)
        log.info(
            "[select_evidence] job=%s strong=%d moderate=%d weak=%d",
            state.job_title,
            sum(1 for item in selected if item.support_level == "strong"),
            sum(1 for item in selected if item.support_level == "moderate"),
            sum(1 for item in selected if item.support_level == "weak"),
        )
        return {
            "selected_evidence": [item.model_dump() for item in selected],
            "evidence": evidence_text,
        }

    def evaluate_fit(state: CoverLetterState) -> dict[str, Any]:
        fit_score, verdict, gaps, is_suitable = _evaluate_selected_evidence(
            state.requirements_json,
            state.selected_evidence,
        )
        log.info(
            "[evaluate_fit] job=%s score=%.2f verdict=%s suitable=%s gaps=%s",
            state.job_title,
            fit_score,
            verdict,
            is_suitable,
            gaps,
        )
        return {
            "fit_score": fit_score,
            "fit_verdict": verdict,
            "gaps": gaps,
            "is_suitable": is_suitable,
        }

    async def plan_letter(state: CoverLetterState) -> dict[str, Any]:
        fallback = _fallback_plan_letter(state.requirements_json, state.selected_evidence)
        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are planning a cover letter. Return JSON only.\n"
                        "Use this exact schema:\n"
                        '{"opening_angle": "...", "paragraph_plan": [{"paragraph": 1, "purpose": "...", '
                        '"requirement_ids": ["..."], "evidence_ids": ["..."], "angle": "..."}], '
                        '"closing_angle": "...", "must_include": ["..."], "must_avoid": ["..."]}\n'
                        "Rules:\n"
                        "- Plan 3 paragraphs total.\n"
                        "- Use only requirement ids and evidence ids already provided.\n"
                        "- Focus on the 2-3 strongest themes, not every requirement.\n"
                        "- Make paragraph 1 the strongest fit paragraph.\n"
                        "- Make at least one paragraph include a concrete result or metric.\n"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"JOB: {state.job_title} at {state.job_company}\n\n"
                        f"SELECTED EVIDENCE JSON:\n{_serialize_selected_evidence(state.selected_evidence, state.evidence_catalog)}\n\n"
                        f"VOICE PROFILE:\n{json.dumps(state.voice_profile, indent=2)}"
                    ),
                },
            ],
            temperature=0.2,
            max_tokens=900,
        )
        try:
            plan = LetterPlan.model_validate(_parse_json(response.choices[0].message.content or "{}"))
        except Exception:
            plan = fallback
        return {"letter_plan": plan.model_dump()}

    async def write_draft(state: CoverLetterState) -> dict[str, Any]:
        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Write a cover letter body from a structured plan.\n"
                        "Return ONLY the body text in 3 short paragraphs separated by blank lines.\n"
                        "Rules:\n"
                        "- Use only facts present in the selected evidence JSON.\n"
                        "- The allowed_claims are the safest phrases. Stay within them.\n"
                        "- Each paragraph must map to the planned requirement ids and evidence ids.\n"
                        "- Prefer direct, practical phrasing over generic enthusiasm.\n"
                        "- Use the voice profile and voice samples for tone only, not for facts.\n"
                        "- If evidence is weaker than desired, stay narrower instead of embellishing.\n"
                        "- No greeting, no sign-off, no 'I am excited to apply'.\n"
                        "- Avoid buzzwords and unsupported claims.\n"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"{_voice_block(state)}\n\n"
                        f"JOB: {state.job_title} at {state.job_company}\n"
                        f"TARGET WORDS: {state.max_words}\n\n"
                        f"LETTER PLAN JSON:\n{json.dumps(state.letter_plan.model_dump(), indent=2)}\n\n"
                        f"SELECTED EVIDENCE JSON:\n{_serialize_selected_evidence(state.selected_evidence, state.evidence_catalog)}"
                    ),
                },
            ],
            temperature=0.45,
            max_tokens=700,
        )
        draft = (response.choices[0].message.content or "").strip()
        log.info("[write_draft] job=%s words=%d", state.job_title, len(draft.split()))
        return {"draft": draft}

    async def critique_draft(state: CoverLetterState) -> dict[str, Any]:
        fallback = _fallback_critique(
            state.draft,
            state.letter_plan,
            state.selected_evidence,
            state.voice_profile,
        )
        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Review a draft cover letter for grounding, coverage, and tone.\n"
                        "Return JSON only with exactly these keys:\n"
                        '{"pass_review": true, "issues": ["..."], "rewrite_required": false, '
                        '"coverage_score": 0.0, "grounding_score": 0.0, "tone_score": 0.0, '
                        '"revision_brief": "..."}\n'
                        "Rules:\n"
                        "- Flag unsupported claims.\n"
                        "- Flag generic, templated phrases.\n"
                        "- Check whether the plan and evidence are actually covered.\n"
                        "- Ask for a rewrite only when there is a real issue.\n"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"DRAFT:\n{state.draft}\n\n"
                        f"LETTER PLAN JSON:\n{json.dumps(state.letter_plan.model_dump(), indent=2)}\n\n"
                        f"SELECTED EVIDENCE JSON:\n{_serialize_selected_evidence(state.selected_evidence, state.evidence_catalog)}\n\n"
                        f"VOICE PROFILE:\n{json.dumps(state.voice_profile, indent=2)}"
                    ),
                },
            ],
            temperature=0.1,
            max_tokens=500,
        )
        try:
            critique = CritiqueResult.model_validate(_parse_json(response.choices[0].message.content or "{}"))
        except Exception:
            critique = fallback
        return {"critique": critique.model_dump()}

    async def revise_draft(state: CoverLetterState) -> dict[str, Any]:
        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Revise the cover letter body once.\n"
                        "Return ONLY the revised body text in 3 short paragraphs separated by blank lines.\n"
                        "Rules:\n"
                        "- Fix only the issues in the revision brief.\n"
                        "- Do not add any new facts.\n"
                        "- Stay within the selected evidence and plan.\n"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"CURRENT DRAFT:\n{state.draft}\n\n"
                        f"REVISION BRIEF:\n{state.critique.revision_brief}\n\n"
                        f"LETTER PLAN JSON:\n{json.dumps(state.letter_plan.model_dump(), indent=2)}\n\n"
                        f"SELECTED EVIDENCE JSON:\n{_serialize_selected_evidence(state.selected_evidence, state.evidence_catalog)}\n\n"
                        f"{_voice_block(state)}"
                    ),
                },
            ],
            temperature=0.35,
            max_tokens=700,
        )
        return {"draft": (response.choices[0].message.content or "").strip()}

    def check_length(state: CoverLetterState) -> dict[str, Any]:
        body = state.draft.strip()
        word_count = len(body.split())
        if word_count > state.max_words:
            paragraphs = [paragraph.strip() for paragraph in body.split("\n\n") if paragraph.strip()]
            kept: list[str] = []
            total = 0
            for paragraph in paragraphs:
                words = paragraph.split()
                if total + len(words) <= state.max_words:
                    kept.append(paragraph)
                    total += len(words)
                    continue
                remaining = state.max_words - total
                if remaining > 0:
                    truncated = " ".join(words[:remaining])
                    sentence_match = re.search(r"[.!?][^.!?]*$", truncated)
                    if sentence_match:
                        truncated = truncated[: sentence_match.start() + 1].strip()
                    if truncated:
                        kept.append(truncated)
                break
            body = "\n\n".join(kept)
            word_count = len(body.split())

        body = body.replace("\u2014", ",").replace("\u2013", ",")
        greeting = f"Hi {state.contact_name.split()[0]}," if _is_real_name(state.contact_name) else "Hi Recruitment Manager,"
        sign_off = f"Regards,\n{state.name}"
        return {
            "cover_letter": f"{greeting}\n\n{body}\n\n{sign_off}",
            "word_count": word_count,
        }

    graph = StateGraph(CoverLetterState)
    graph.add_node("parse_jd", parse_jd)
    graph.add_node("select_evidence", select_evidence)
    graph.add_node("evaluate_fit", evaluate_fit)
    graph.add_node("plan_letter", plan_letter)
    graph.add_node("write_draft", write_draft)
    graph.add_node("critique_draft", critique_draft)
    graph.add_node("revise_draft", revise_draft)
    graph.add_node("check_length", check_length)
    graph.set_entry_point("parse_jd")
    graph.add_edge("parse_jd", "select_evidence")
    graph.add_edge("select_evidence", "evaluate_fit")

    def route_after_fit(state: CoverLetterState) -> Literal["plan_letter", "__end__"]:
        return "plan_letter" if state.is_suitable else END

    def route_after_critique(state: CoverLetterState) -> Literal["revise_draft", "check_length"]:
        return "revise_draft" if state.critique.rewrite_required else "check_length"

    graph.add_conditional_edges("evaluate_fit", route_after_fit)
    graph.add_edge("plan_letter", "write_draft")
    graph.add_edge("write_draft", "critique_draft")
    graph.add_conditional_edges("critique_draft", route_after_critique)
    graph.add_edge("revise_draft", "check_length")
    graph.add_edge("check_length", END)
    return graph.compile()


def _format_experience(profile: dict) -> str:
    if profile.get("evidence_items"):
        lines: list[str] = []
        for item in _sorted_evidence_items(profile)[:8]:
            header = f"- {item.get('source', 'Evidence')}"
            role_title = item.get("role_title")
            if role_title:
                header += f" · {role_title}"
            confidence = str(item.get("confidence", "")).strip()
            if confidence:
                header += f" [{confidence}]"
            details: list[str] = []
            if item.get("situation"):
                details.append(f"Situation: {item['situation']}")
            if item.get("task"):
                details.append(f"Task: {item['task']}")
            if item.get("action"):
                details.append(f"Action: {item['action']}")
            if item.get("outcome"):
                details.append(f"Outcome: {item['outcome']}")
            for metric in item.get("metrics", [])[:3]:
                details.append(f"* {metric}")
            for point in item.get("proof_points", [])[:2]:
                text = str(point).strip()
                if text and text not in details:
                    details.append(f"- {text}")
            line = header
            if details:
                line += "\n    " + "\n    ".join(details)
            lines.append(line)
        return "\n".join(lines) or "Not provided"

    lines: list[str] = []
    for exp in profile.get("experience", [])[:8]:
        line = f"- {exp.get('title', '')} at {exp.get('company', '')}"
        period = exp.get("period", "")
        if period:
            line += f" ({period})"
        for highlight in exp.get("highlights", [])[:3]:
            line += f"\n    - {highlight}"
        for metric in exp.get("metrics", [])[:3]:
            line += f"\n    * {metric}"
        lines.append(line)
    return "\n".join(lines) or "Not provided"


def _format_projects(profile: dict) -> str:
    if profile.get("evidence_items"):
        lines: list[str] = []
        for item in _sorted_evidence_items(profile):
            if item.get("role_title") != "Project":
                continue
            summary_parts = [str(item.get("action", "")).strip(), str(item.get("outcome", "")).strip()]
            summary = " ".join(part for part in summary_parts if part)
            lines.append(f"- {item.get('source')}: {summary}".strip())
        return "\n".join(line for line in lines if line) or "None listed"

    lines = [f"- {project.get('name')}: {project.get('summary', '')}" for project in profile.get("selected_projects", [])]
    return "\n".join(lines) or "None listed"


def _format_narrative_strengths(profile: dict) -> str:
    if profile.get("evidence_items"):
        strengths: list[str] = []
        for item in _sorted_evidence_items(profile)[:6]:
            fragments = [str(item.get("action", "")).strip(), str(item.get("outcome", "")).strip()]
            metrics = [str(metric).strip() for metric in item.get("metrics", []) if str(metric).strip()]
            line = " ".join(fragment for fragment in fragments if fragment)
            if metrics:
                line = f"{line} Metrics: {'; '.join(metrics[:2])}".strip()
            if line:
                strengths.append(f"- {item.get('source')}: {line}")
        return "\n".join(strengths)

    items = profile.get("narrative_strengths", [])
    return "\n".join(f"- {item}" for item in items) if items else ""


def _sorted_evidence_items(profile: dict) -> list[dict]:
    evidence_items = [item for item in profile.get("evidence_items", []) if isinstance(item, dict)]

    def _sort_key(item: dict) -> tuple[int, int, str]:
        confidence = str(item.get("confidence", "")).strip().lower()
        confidence_rank = 0 if confidence == "approved" else 1
        gaps = sum(1 for field in ("situation", "task", "outcome") if not str(item.get(field, "")).strip())
        if not item.get("metrics"):
            gaps += 1
        return (confidence_rank, gaps, str(item.get("source", "")).lower())

    return sorted(evidence_items, key=_sort_key)


async def run_cover_letter(
    settings: Settings,
    *,
    job: SeekJobDetail,
    profile: dict,
    cached_analysis=None,
) -> CoverLetterResult:
    prefs = profile.get("proposal_preferences", {})
    evidence_catalog = _build_evidence_catalog(profile)
    profile_source = "canonical" if profile.get("evidence_items") else "legacy"
    writing_samples = (
        profile.get("writing_samples")
        or profile.get("voice_samples")
        or [
            item.get("tone_sample", "")
            for item in profile.get("evidence_items", [])
            if isinstance(item, dict) and item.get("tone_sample")
        ]
    )

    initial = CoverLetterState(
        job_title=job.title,
        job_company=job.company,
        job_description=cached_analysis.description if cached_analysis and cached_analysis.description else job.description,
        job_salary=job.salary,
        name=profile.get("name", ""),
        headline=profile.get("headline", ""),
        summary=profile.get("summary", ""),
        narrative_strengths_text=_format_narrative_strengths(profile),
        experience_text=_format_experience(profile),
        projects_text=_format_projects(profile),
        skills=", ".join(profile.get("core_strengths", [])),
        tone=prefs.get("tone", "consultative, senior, practical"),
        max_words=prefs.get("max_words", 320),
        writing_samples=writing_samples,
        voice_profile=profile.get("voice_profile", {}),
        profile_source=profile_source,
        approved_evidence_count=sum(
            1
            for item in profile.get("evidence_items", [])
            if isinstance(item, dict) and str(item.get("confidence", "")).strip().lower() == "approved"
        ),
        cached_must_have=cached_analysis.must_have if cached_analysis else [],
        cached_duties=cached_analysis.duties if cached_analysis else [],
        cached_nice_to_have=cached_analysis.nice_to_have if cached_analysis else [],
        cached_contact_name=cached_analysis.contact_name if cached_analysis else "",
        evidence_catalog=evidence_catalog,
    )

    graph = build_cover_letter_graph(settings)
    result = await graph.ainvoke(initial.model_dump())
    state = CoverLetterState.model_validate(result)
    return CoverLetterResult(
        is_suitable=state.is_suitable,
        cover_letter=state.cover_letter,
        gaps=state.gaps,
        evidence=state.evidence,
    )
