"""Domain models for the prepare phase.

These cover the application lifecycle, drafts, and the LangGraph workflow
state used during preparation.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


from app.state.provider_job_detail import ProviderJobDetail

# Backward-compat alias — use ProviderJobDetail for new code.
SeekJobDetail = ProviderJobDetail


class Application(BaseModel):
    """Persisted application row."""

    id: str
    job_id: str
    source_provider: str
    source_url: str
    target_portal: str | None = None
    target_application_url: str | None = None
    state: str  # preparing | prepared | approved | discarded | submitted
    created_at: datetime
    updated_at: datetime
    last_apply_step_json: str | None = None
    is_suitable: bool = True
    gaps_json: str = "[]"
    fit_score: float | None = None


class Draft(BaseModel):
    """A generated draft (cover letter or Q&A answer)."""

    id: str
    application_id: str
    draft_type: str  # cover_letter | question_answer
    question_fingerprint: str | None = None
    generator: str
    content: str
    version: int
    created_at: datetime


class PrepareRequest(BaseModel):
    """Request body for POST /api/workflows/prepare."""

    job_id: str


class PrepareResponse(BaseModel):
    """Response body for POST /api/workflows/prepare."""

    application_id: str
    cover_letter: str
    job_description: str = ""
    questions: list[dict[str, str]] = Field(default_factory=list)
    is_suitable: bool = True
    gaps: list[str] = Field(default_factory=list)
    fit_score: float | None = None
    match_evidence: str = ""  # [STRONG/MODERATE/WEAK] requirement → evidence lines


class PrepareState(BaseModel):
    """LangGraph workflow state for the prepare phase."""

    # Input
    job_id: str

    # Fetched from tools/
    detail: SeekJobDetail | None = None

    # Generated
    cover_letter: str = ""
    match_evidence: str = ""  # [STRONG/MODERATE/WEAK] req → evidence lines
    questions: list[dict[str, str]] = Field(default_factory=list)
    is_suitable: bool = True
    gaps: list[str] = Field(default_factory=list)
    fit_score: float | None = None

    # Persisted
    application_id: str = ""

    # Error
    error: str | None = None
