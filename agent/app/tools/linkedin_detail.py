from __future__ import annotations

from app.state.envelope import ToolError
from app.state.provider_job_detail import ProviderJobDetail
from app.tools.client import ToolClient


class LinkedInDetailDriftError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(f"LinkedIn detail drift: {reason}")
        self.reason = reason


class LinkedInDetailError(Exception):
    def __init__(self, error: ToolError) -> None:
        super().__init__(f"LinkedIn detail error: {error.type}: {error.message}")
        self.error = error


async def fetch_job_detail(client: ToolClient, *, job_id: str) -> ProviderJobDetail:
    envelope = await client.call("/tools/providers/linkedin/job", {"job_id": job_id})

    if envelope.status == "drift":
        reason = envelope.drift.parser_id if envelope.drift else "unknown"
        raise LinkedInDetailDriftError(reason)
    if envelope.status == "error":
        assert envelope.error is not None
        raise LinkedInDetailError(envelope.error)
    if envelope.status != "ok" or not isinstance(envelope.data, dict):
        raise LinkedInDetailError(
            ToolError(type="unexpected_envelope", message=f"status={envelope.status}")
        )

    return ProviderJobDetail.model_validate(envelope.data["job"])
