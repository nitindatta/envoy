"""tools/ client wrapper for the SEEK job detail route."""

from __future__ import annotations

from app.state.envelope import ToolDrift, ToolError
from app.state.prepare import SeekJobDetail
from app.tools.client import ToolClient


class SeekDetailDriftError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(f"SEEK detail drift: {reason}")
        self.reason = reason


class SeekDetailError(Exception):
    def __init__(self, error: ToolError) -> None:
        super().__init__(f"SEEK detail error: {error.type}: {error.message}")
        self.error = error


async def fetch_job_detail(client: ToolClient, *, job_id: str) -> SeekJobDetail:
    envelope = await client.call("/tools/providers/seek/job", {"job_id": job_id})

    if envelope.status == "drift":
        reason = envelope.drift.parser_id if envelope.drift else "unknown"
        raise SeekDetailDriftError(reason)
    if envelope.status == "error":
        assert envelope.error is not None
        raise SeekDetailError(envelope.error)
    if envelope.status != "ok" or not isinstance(envelope.data, dict):
        raise SeekDetailError(
            ToolError(type="unexpected_envelope", message=f"status={envelope.status}")
        )

    return SeekJobDetail.model_validate(envelope.data["job"])
