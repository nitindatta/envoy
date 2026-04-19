from __future__ import annotations

from pydantic import BaseModel


class ProviderJobDetail(BaseModel):
    """Normalized job detail returned by any provider's detail tool."""

    provider_job_id: str
    title: str
    company: str
    location: str | None = None
    salary: str | None = None
    work_type: str | None = None
    listed_at: str | None = None
    description: str
    classification: str | None = None
    url: str
