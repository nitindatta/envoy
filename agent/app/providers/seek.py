from __future__ import annotations

from app.policy import seek as seek_policy
from app.policy.seek import BlockReason
from app.state.provider_job import ProviderJob
from app.state.provider_job_detail import ProviderJobDetail
from app.tools.client import ToolClient
from app.tools.seek import search_seek
from app.tools.seek_detail import fetch_job_detail


class SeekAdapter:
    async def search(
        self,
        client: ToolClient,
        *,
        keywords: str,
        location: str | None,
        max_pages: int,
    ) -> list[ProviderJob]:
        return await search_seek(client, keywords=keywords, location=location, max_pages=max_pages)

    async def fetch_detail(self, client: ToolClient, job_id: str) -> ProviderJobDetail:
        detail = await fetch_job_detail(client, job_id=job_id)
        return ProviderJobDetail.model_validate(detail.model_dump())

    def is_blocked(self, job: ProviderJob) -> BlockReason | None:
        return seek_policy.is_blocked(job)
