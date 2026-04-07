#!/usr/bin/env python3
"""Local, review-first Upwork job assistant.

This tool helps evaluate job posts and draft tailored proposal packets using a
structured freelancer profile. It intentionally stops short of blind submission
so every application can be reviewed before anything is sent.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROFILE = ROOT / "profile" / "nitin_datta_profile.json"
OUTPUT_DIR = ROOT / "applications"

ROLE_KEYWORDS: Dict[str, Sequence[str]] = {
    "ai": [
        "llm",
        "rag",
        "embedding",
        "embeddings",
        "semantic search",
        "agent",
        "agents",
        "ai",
        "genai",
        "openai",
        "prompt",
        "vector",
    ],
    "data": [
        "databricks",
        "spark",
        "pyspark",
        "delta lake",
        "dbt",
        "dagster",
        "airflow",
        "etl",
        "elt",
        "data pipeline",
        "ingestion",
        "warehouse",
        "lakehouse",
    ],
    "cloud": [
        "aws",
        "azure",
        "lambda",
        "glue",
        "s3",
        "kinesis",
        "redshift",
        "data factory",
        "serverless",
    ],
    "architecture": [
        "microservices",
        "distributed systems",
        "system design",
        "integration",
        "api",
        "backend",
        "scalable",
        "reliable",
        "architecture",
    ],
}

NEGATIVE_KEYWORDS = {
    "frontend_only": ["figma", "shopify", "wordpress", "webflow", "landing page", "ui designer"],
    "mobile_only": ["swift", "kotlin", "react native", "flutter", "ios", "android"],
    "mismatch": ["logo design", "video editing", "seo backlink", "virtual assistant", "bookkeeping"],
}

@dataclass
class FitResult:
    score: int
    recommendation: str
    matched_skills: List[str]
    matched_domains: List[str]
    concerns: List[str]
    reasons: List[str]


def load_profile(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_job_text(path: Path) -> str:
    with path.open("r", encoding="utf-8") as handle:
        return handle.read().strip()


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def collect_skill_matches(job_text: str, profile: dict) -> Tuple[List[str], List[str]]:
    text = normalize(job_text)
    matched_skills = [skill for skill in profile["core_strengths"] if skill.lower() in text]
    matched_domains = [domain for domain, keywords in ROLE_KEYWORDS.items() if any(keyword in text for keyword in keywords)]
    return sorted(set(matched_skills)), sorted(set(matched_domains))


def score_job(job_text: str, profile: dict) -> FitResult:
    text = normalize(job_text)
    matched_skills, matched_domains = collect_skill_matches(job_text, profile)

    score = 45
    reasons: List[str] = []
    concerns: List[str] = []

    score += min(len(matched_skills) * 4, 28)
    score += len(matched_domains) * 6

    if any(word in text for word in ["senior", "architect", "lead", "principal"]):
        score += 5
        reasons.append("The role signals senior ownership, which aligns with your background.")

    if any(word in text for word in ["databricks", "spark", "dbt", "azure", "aws"]):
        reasons.append("The stack overlaps strongly with your recent data platform work.")

    if any(word in text for word in ["llm", "rag", "agent", "embedding", "semantic search"]):
        reasons.append("The brief includes AI system patterns that match your current positioning.")

    penalty_hits = []
    for category, keywords in NEGATIVE_KEYWORDS.items():
        hits = [keyword for keyword in keywords if keyword in text]
        if hits:
            penalty_hits.extend(hits)
            if category == "frontend_only":
                score -= 18
                concerns.append("The brief leans toward frontend or site-builder work rather than backend/data/AI delivery.")
            elif category == "mobile_only":
                score -= 14
                concerns.append("The brief looks mobile-app heavy, which is weaker overlap with your stated focus.")
            else:
                score -= 25
                concerns.append("The brief appears outside your target service mix.")

    if "commission only" in text or "equity only" in text:
        score -= 20
        concerns.append("Compensation terms look weak for the level of work requested.")

    if not matched_skills and not matched_domains:
        score -= 18
        concerns.append("There are very few direct keyword overlaps with your current profile.")

    score = max(0, min(100, score))

    if score >= 80:
        recommendation = "Strong fit"
    elif score >= 65:
        recommendation = "Worth applying"
    elif score >= 50:
        recommendation = "Borderline"
    else:
        recommendation = "Skip"

    if not reasons:
        reasons.append("You have broad architecture and data-platform experience that may still translate well if the client values end-to-end delivery.")

    return FitResult(
        score=score,
        recommendation=recommendation,
        matched_skills=matched_skills,
        matched_domains=matched_domains,
        concerns=concerns,
        reasons=reasons,
    )


def extract_focus_terms(job_text: str, profile: dict, limit: int = 8) -> List[str]:
    text = normalize(job_text)
    candidates = [skill for skill in profile["core_strengths"] if skill.lower() in text]
    if len(candidates) >= limit:
        return candidates[:limit]

    token_counts = Counter(re.findall(r"[a-zA-Z][a-zA-Z+#.\-/]{2,}", job_text.lower()))
    stopwords = {
        "the", "and", "for", "with", "you", "our", "this", "that", "from", "have", "will", "are", "job",
        "project", "work", "need", "looking", "developer", "engineer", "experience", "team", "build", "data",
    }
    extras = [token for token, _ in token_counts.most_common() if token not in stopwords and token not in {c.lower() for c in candidates}]
    return (candidates + extras)[:limit]


def build_proposal(job_text: str, profile: dict, fit: FitResult) -> str:
    focus_terms = extract_focus_terms(job_text, profile)
    relevant_highlights: List[str] = []
    for role in profile["experience"]:
        for highlight in role["highlights"]:
            if any(term.lower() in highlight.lower() for term in focus_terms[:5]):
                relevant_highlights.append(highlight)
        if len(relevant_highlights) >= 3:
            break

    if len(relevant_highlights) < 3:
        for role in profile["experience"]:
            for highlight in role["highlights"]:
                if highlight not in relevant_highlights:
                    relevant_highlights.append(highlight)
                if len(relevant_highlights) >= 3:
                    break
            if len(relevant_highlights) >= 3:
                break

    first_paragraph = (
        f"Hi, I’m {profile['name']}. I help teams build production-ready AI, data, and platform systems, and your brief looks like a strong match for that blend of hands-on delivery and architecture thinking. "
        f"I’ve worked across Databricks, Spark, Python, Go, .NET, AWS, and Azure, with a recent focus on LLM pipelines, embeddings, RAG, and integration-heavy backend systems."
    )

    second_paragraph = "Relevant examples from my recent work include: " + " ".join(
        f"- {item}" for item in relevant_highlights
    )

    third_paragraph = (
        "If we work together, I’d start by tightening the requirements, confirming the target architecture, and then breaking delivery into clear milestones so we can move quickly without losing reliability. "
        "I’m comfortable owning both implementation and the integration details that usually make these projects succeed or fail in production."
    )

    closing = (
        "If helpful, I can also outline a practical first-phase plan after reviewing the full job post and any existing system context."
    )

    return "\n\n".join([first_paragraph, second_paragraph, third_paragraph, closing])


def build_screening_answers(job_text: str, profile: dict, fit: FitResult) -> List[str]:
    answers = []
    answers.append(
        "I’ve delivered production-facing data and AI systems across Databricks, Spark, AWS, and Azure, and more recently focused on LLM pipelines, embeddings, RAG, and agent-style workflows."
    )
    answers.append(
        "My approach is to de-risk early: clarify the desired outcome, confirm the target architecture, build a thin but working end-to-end slice first, and then harden for scale, monitoring, and maintainability."
    )
    if fit.concerns:
        answers.append(
            "One thing I’d want to confirm up front is the exact scope, so I can align the implementation plan to the parts where my background adds the most value."
        )
    return answers


def build_application_packet(job_path: Path, profile: dict, fit: FitResult) -> str:
    job_text = load_job_text(job_path)
    proposal = build_proposal(job_text, profile, fit)
    screening_answers = build_screening_answers(job_text, profile, fit)
    focus_terms = extract_focus_terms(job_text, profile)

    lines = [
        f"# Application Packet: {job_path.stem}",
        "",
        "## Fit Summary",
        f"- Recommendation: {fit.recommendation}",
        f"- Fit score: {fit.score}/100",
        f"- Matched domains: {', '.join(fit.matched_domains) if fit.matched_domains else 'None detected'}",
        f"- Matched skills: {', '.join(fit.matched_skills) if fit.matched_skills else 'None detected'}",
        "",
        "## Reasons To Apply",
    ]

    lines.extend([f"- {reason}" for reason in fit.reasons])

    lines.append("")
    lines.append("## Risks / Questions")
    if fit.concerns:
        lines.extend([f"- {concern}" for concern in fit.concerns])
    else:
        lines.append("- No major fit risks detected from the text alone.")

    lines.extend(
        [
            "",
            "## Focus Terms",
            f"- {', '.join(focus_terms) if focus_terms else 'None extracted'}",
            "",
            "## Draft Proposal",
            proposal,
            "",
            "## Suggested Screening Answers",
        ]
    )
    lines.extend([f"1. {answer}" for answer in screening_answers])

    lines.extend(
        [
            "",
            "## Final Review Checklist",
            "- Confirm the proposal language matches the exact client brief.",
            "- Adjust any claims that need stronger proof or portfolio links.",
            "- Verify hourly rate, milestones, and availability before submission.",
            "- Manually review and submit through Upwork.",
        ]
    )

    return "\n".join(lines).strip() + "\n"


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "application"


def print_review(job_path: Path, fit: FitResult) -> None:
    print(f"Job file: {job_path}")
    print(f"Recommendation: {fit.recommendation}")
    print(f"Fit score: {fit.score}/100")
    print(f"Matched domains: {', '.join(fit.matched_domains) if fit.matched_domains else 'None'}")
    print(f"Matched skills: {', '.join(fit.matched_skills) if fit.matched_skills else 'None'}")
    if fit.reasons:
        print("Reasons:")
        for reason in fit.reasons:
            print(f"- {reason}")
    if fit.concerns:
        print("Concerns:")
        for concern in fit.concerns:
            print(f"- {concern}")


def save_packet(job_path: Path, packet: str) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    destination = OUTPUT_DIR / f"{slugify(job_path.stem)}.md"
    destination.write_text(packet, encoding="utf-8")
    return destination


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Review-first Upwork job assistant")
    parser.add_argument("command", choices=["review", "draft"], help="Action to run")
    parser.add_argument("job_file", help="Path to a plain-text job description")
    parser.add_argument("--profile", default=str(DEFAULT_PROFILE), help="Path to profile JSON")
    parser.add_argument("--print-packet", action="store_true", help="Print the full application packet to stdout")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    profile_path = Path(args.profile).expanduser().resolve()
    job_path = Path(args.job_file).expanduser().resolve()

    if not profile_path.exists():
        parser.error(f"Profile not found: {profile_path}")
    if not job_path.exists():
        parser.error(f"Job file not found: {job_path}")

    profile = load_profile(profile_path)
    job_text = load_job_text(job_path)
    fit = score_job(job_text, profile)

    if args.command == "review":
        print_review(job_path, fit)
        return 0

    packet = build_application_packet(job_path, profile, fit)
    output_path = save_packet(job_path, packet)
    print(f"Saved application packet to: {output_path}")
    if args.print_packet:
        print()
        print(packet)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
