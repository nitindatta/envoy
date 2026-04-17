"""Wire contract type for jobs returned by tools/ provider parsers.

This module defines `ProviderJob`, the canonical Python mirror of
`providerJobSchema` in tools/src/providers/types.ts.

Do not add fields here without updating the TS side too.
"""

from __future__ import annotations

from pydantic import AwareDatetime, BaseModel, Field


class ProviderJob(BaseModel):
    """Wire contract between tools/ parsers and agent/.

    Mirrors providerJobSchema in tools/src/providers/types.ts.
    Do not add fields here without updating the TS side too.
    """

    provider_job_id: str
    title: str
    company: str
    location: str | None = None
    url: str
    posted_at: AwareDatetime | None = None  # ISO 8601 — normalized by parser
    snippet: str | None = None
    salary: str | None = None
    work_type: str | None = None
    work_arrangement: str | None = None
    logo_url: str | None = None
    tags: list[str] = Field(default_factory=list)
    bullet_points: list[str] = Field(default_factory=list)
