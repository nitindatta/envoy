"""Domain models for jobs and search.

These are the canonical Pydantic types used by the search workflow, the
JobRepository, the tools/ client wrapper, and the API routes. SQLite rows are
mapped to and from these models in `app.persistence.sqlite.jobs`.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SeekJob(BaseModel):
    """A single job as returned by the tools/ SEEK search route.

    This mirrors the response shape from `POST /tools/providers/seek/search`
    and is the contract between agent/ and tools/. Do not add fields here
    without updating the tools/ side too.
    """

    provider_job_id: str
    title: str
    company: str
    location: str | None = None
    url: str
    posted_at: str | None = None
    snippet: str | None = None


class SearchRequest(BaseModel):
    """Request body for `POST /api/workflows/search`."""

    provider: str = Field(default="seek")
    keywords: str
    location: str | None = None
    max_pages: int = Field(default=1, ge=1, le=10)


class Job(BaseModel):
    """A persisted job row.

    Mirrors the `jobs` table. `payload` holds the original tools/ response
    so downstream phases can re-extract fields without re-scraping.
    """

    id: str
    provider: str
    source_url: str
    canonical_key: str
    title: str
    company: str
    location: str | None = None
    summary: str | None = None
    payload: dict[str, object]
    state: str = "discovered"  # discovered | in_review | ignored
    discovered_at: datetime
    last_seen_at: datetime


class SearchResponse(BaseModel):
    """Response body for `POST /api/workflows/search`."""

    discovered: int
    blocked: int
    persisted: int
    job_ids: list[str]
