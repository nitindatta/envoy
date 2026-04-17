"""tools/ client wrapper for the SEEK search route.

Calls `POST /tools/providers/seek/search` and decodes the ToolEnvelope into
typed Pydantic models. The wrapper raises specific exceptions for drift /
error envelopes so the workflow can route them to the right handler.
"""

from __future__ import annotations

from app.state.envelope import ToolDrift, ToolError
from app.state.provider_job import ProviderJob
from app.tools.client import ToolClient


class SeekDriftError(Exception):
    def __init__(self, drift: ToolDrift) -> None:
        super().__init__(f"SEEK parser drift: {drift.parser_id}")
        self.drift = drift


class SeekToolError(Exception):
    def __init__(self, error: ToolError) -> None:
        super().__init__(f"SEEK tool error: {error.type}: {error.message}")
        self.error = error


async def search_seek(
    client: ToolClient,
    *,
    keywords: str,
    location: str | None = None,
    max_pages: int = 1,
) -> list[ProviderJob]:
    payload: dict[str, object] = {"keywords": keywords, "max_pages": max_pages}
    if location is not None:
        payload["location"] = location

    envelope = await client.call("/tools/providers/seek/search", payload)

    if envelope.status == "drift":
        assert envelope.drift is not None
        raise SeekDriftError(envelope.drift)
    if envelope.status == "error":
        assert envelope.error is not None
        raise SeekToolError(envelope.error)
    if envelope.status != "ok" or not isinstance(envelope.data, dict):
        raise SeekToolError(
            ToolError(type="unexpected_envelope", message=f"status={envelope.status}")
        )

    raw_jobs = envelope.data.get("jobs", [])
    if not isinstance(raw_jobs, list):
        raise SeekToolError(ToolError(type="bad_payload", message="jobs is not a list"))
    return [ProviderJob.model_validate(item) for item in raw_jobs]
