"""Provider search workflow (SEEK, Indeed).

LangGraph pipeline: search_jobs → filter_jobs → persist_jobs.

Dependencies (tool client, repository) are bound at graph build time via a
closure. The graph state is plain data (`SearchState`).
"""

from __future__ import annotations

from langgraph.graph import END, StateGraph

from app.persistence.sqlite.jobs import SqliteJobRepository
from app.providers import registry
from app.state.search import BlockedJob, SearchState
from app.tools.client import ToolClient


def build_search_graph(
    tool_client: ToolClient,
    repository: SqliteJobRepository,
):
    """Build a compiled LangGraph for the provider search workflow."""

    async def search_jobs(state: SearchState) -> dict[str, object]:
        adapter = registry.get(state.provider)
        jobs = await adapter.search(
            tool_client,
            keywords=state.keywords,
            location=state.location,
            max_pages=state.max_pages,
        )
        return {"discovered": jobs}

    async def filter_jobs(state: SearchState) -> dict[str, object]:
        adapter = registry.get(state.provider)
        kept = []
        blocked = []
        for job in state.discovered:
            reason = adapter.is_blocked(job)
            if reason is None:
                kept.append(job)
            else:
                blocked.append(BlockedJob(job=job, rule=reason.rule, detail=reason.detail))
        return {"discovered": kept, "blocked": blocked}

    async def persist_jobs(state: SearchState) -> dict[str, object]:
        ids: list[str] = []
        for job in state.discovered:
            job_id, is_new = await repository.upsert(
                provider=state.provider,
                source_url=job.url,
                canonical_key=f"{state.provider}:{job.provider_job_id}",
                title=job.title,
                company=job.company,
                location=job.location,
                summary=job.snippet,
                payload=job.model_dump(mode="json"),
                posted_at=job.posted_at,
            )
            if is_new:
                await repository.tag_job(job_id, state.keywords)
                ids.append(job_id)
        return {"persisted_job_ids": ids}

    graph: StateGraph = StateGraph(SearchState)
    graph.add_node("search_jobs", search_jobs)
    graph.add_node("filter_jobs", filter_jobs)
    graph.add_node("persist_jobs", persist_jobs)
    graph.set_entry_point("search_jobs")
    graph.add_edge("search_jobs", "filter_jobs")
    graph.add_edge("filter_jobs", "persist_jobs")
    graph.add_edge("persist_jobs", END)
    return graph.compile()


async def run_search(
    tool_client: ToolClient,
    repository: SqliteJobRepository,
    *,
    keywords: str,
    location: str | None,
    max_pages: int,
    provider: str = "seek",
) -> SearchState:
    """Run the search workflow for the given provider and return the final state."""
    graph = build_search_graph(tool_client, repository)
    result = await graph.ainvoke(
        SearchState(provider=provider, keywords=keywords, location=location, max_pages=max_pages)
    )
    return SearchState.model_validate(result)
