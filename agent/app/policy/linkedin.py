from __future__ import annotations

from app.policy.seek import BlockReason
from app.state.provider_job import ProviderJob

BLOCKED_COMPANIES: frozenset[str] = frozenset(
    {
        # Add as discovered.
    }
)

BLOCKED_TITLE_KEYWORDS: frozenset[str] = frozenset(
    {
        "intern",
        "internship",
        "graduate program",
    }
)


def is_blocked(job: ProviderJob) -> BlockReason | None:
    company_lower = job.company.strip().lower()
    if company_lower in BLOCKED_COMPANIES:
        return BlockReason(rule="company", detail=job.company)

    title_lower = job.title.lower()
    for keyword in BLOCKED_TITLE_KEYWORDS:
        if keyword in title_lower:
            return BlockReason(rule="title_keyword", detail=keyword)

    return None
