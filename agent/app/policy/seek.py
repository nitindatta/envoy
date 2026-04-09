"""SEEK provider policy.

Phase 1 scope: a deny-list filter that drops jobs by company or by keywords
in the title before they are persisted. Settings UI comes later; for now the
lists are hard-coded and easy to edit.

The policy returns a `BlockReason` (or None) for each job, so the workflow
can record *why* something was blocked rather than silently dropping it.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.state.jobs import SeekJob


# Lowercase company names to drop outright.
BLOCKED_COMPANIES: frozenset[str] = frozenset(
    {
        # Add as discovered. Examples:
        # "outsourced staffing co",
    }
)

# Lowercase substrings — if any appear in the title, the job is blocked.
BLOCKED_TITLE_KEYWORDS: frozenset[str] = frozenset(
    {
        "intern",
        "internship",
        "graduate program",
    }
)


@dataclass(frozen=True)
class BlockReason:
    rule: str
    detail: str


def is_blocked(job: SeekJob) -> BlockReason | None:
    """Return the reason this job is blocked, or None if it passes the filter."""
    company_lower = job.company.strip().lower()
    if company_lower in BLOCKED_COMPANIES:
        return BlockReason(rule="company", detail=job.company)

    title_lower = job.title.lower()
    for keyword in BLOCKED_TITLE_KEYWORDS:
        if keyword in title_lower:
            return BlockReason(rule="title_keyword", detail=keyword)

    return None
