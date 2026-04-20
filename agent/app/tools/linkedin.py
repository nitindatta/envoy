from __future__ import annotations

from app.state.envelope import ToolDrift, ToolError
from app.state.provider_job import ProviderJob
from app.tools.client import ToolClient


class LinkedInDriftError(Exception):
    def __init__(self, drift: ToolDrift) -> None:
        super().__init__(f"LinkedIn parser drift: {drift.parser_id}")
        self.drift = drift


class LinkedInToolError(Exception):
    def __init__(self, error: ToolError) -> None:
        super().__init__(f"LinkedIn tool error: {error.type}: {error.message}")
        self.error = error


async def search_linkedin(
    client: ToolClient,
    *,
    keywords: str,
    location: str | None = None,
    max_pages: int = 1,
) -> list[ProviderJob]:
    payload: dict[str, object] = {"keywords": keywords, "max_pages": max_pages}
    if location is not None:
        payload["location"] = location

    envelope = await client.call("/tools/providers/linkedin/search", payload)

    if envelope.status == "drift":
        assert envelope.drift is not None
        raise LinkedInDriftError(envelope.drift)
    if envelope.status == "error":
        assert envelope.error is not None
        raise LinkedInToolError(envelope.error)
    if envelope.status != "ok" or not isinstance(envelope.data, dict):
        raise LinkedInToolError(
            ToolError(type="unexpected_envelope", message=f"status={envelope.status}")
        )

    raw_jobs = envelope.data.get("jobs", [])
    if not isinstance(raw_jobs, list):
        raise LinkedInToolError(ToolError(type="bad_payload", message="jobs is not a list"))
    return [ProviderJob.model_validate(item) for item in raw_jobs]
