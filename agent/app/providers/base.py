from __future__ import annotations

from typing import Protocol

from app.policy.seek import BlockReason
from app.state.provider_job import ProviderJob
from app.state.provider_job_detail import ProviderJobDetail
from app.tools.client import ToolClient


class ProviderAdapter(Protocol):
    async def search(
        self,
        client: ToolClient,
        *,
        keywords: str,
        location: str | None,
        max_pages: int,
    ) -> list[ProviderJob]: ...

    async def fetch_detail(
        self,
        client: ToolClient,
        job_id: str,
    ) -> ProviderJobDetail: ...

    def is_blocked(self, job: ProviderJob) -> BlockReason | None: ...
