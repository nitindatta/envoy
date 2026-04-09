"""State model for the SEEK search workflow."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.state.jobs import SeekJob


class BlockedJob(BaseModel):
    job: SeekJob
    rule: str
    detail: str


class SearchState(BaseModel):
    # Inputs
    provider: str = "seek"
    keywords: str
    location: str | None = None
    max_pages: int = 1

    # Working data
    discovered: list[SeekJob] = Field(default_factory=list)
    blocked: list[BlockedJob] = Field(default_factory=list)
    persisted_job_ids: list[str] = Field(default_factory=list)
