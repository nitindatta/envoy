"""LangGraph prepare workflow.

Nodes:
  fetch_detail  → fetch full job description from tools/
  generate      → AI cover letter + predicted questions
  persist       → save application + drafts to SQLite

The graph is a linear chain (no branching in Phase 2).
HITL gate: the portal approves/discards after preparation; the workflow
itself only creates the draft and marks state="prepared".
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from langgraph.graph import StateGraph, END

from app.persistence.sqlite.applications import SqliteApplicationRepository, SqliteDraftRepository
from app.persistence.sqlite.jobs import SqliteJobRepository
from app.services.ai import predict_questions
from app.settings import Settings
from app.state.prepare import PrepareState, SeekJobDetail
from app.tools.client import ToolClient
from app.tools.seek_detail import fetch_job_detail
from app.workflows.cover_letter import run_cover_letter


def build_prepare_graph(
    settings: Settings,
    tool_client: ToolClient,
    job_repo: SqliteJobRepository,
    app_repo: SqliteApplicationRepository,
    draft_repo: SqliteDraftRepository,
):
    profile = _load_profile(settings)

    async def fetch_detail(state: PrepareState) -> dict[str, Any]:
        job = await job_repo.get(state.job_id)
        if job is None:
            return {"error": f"job {state.job_id} not found in database"}

        # Extract provider_job_id from payload
        provider_job_id = str(job.payload.get("provider_job_id", ""))
        if not provider_job_id:
            return {"error": f"job {state.job_id} has no provider_job_id in payload"}

        detail = await fetch_job_detail(tool_client, job_id=provider_job_id)
        return {"detail": detail}

    async def generate(state: PrepareState) -> dict[str, Any]:
        if state.error or state.detail is None:
            return {}

        cl_result = await run_cover_letter(
            settings, job=state.detail, profile=profile
        )
        questions = await predict_questions(
            settings, job=state.detail, profile=profile
        )
        return {
            "cover_letter": cl_result.cover_letter,
            "is_suitable": cl_result.is_suitable,
            "gaps": cl_result.gaps,
            "questions": questions,
        }

    async def persist(state: PrepareState) -> dict[str, Any]:
        if state.error or not state.is_suitable:
            return {}  # Not suitable — nothing to persist

        job = await job_repo.get(state.job_id)
        if job is None:
            return {"error": f"job {state.job_id} not found"}

        app_id = await app_repo.create(
            job_id=state.job_id,
            source_provider=job.provider,
            source_url=job.source_url,
        )

        await draft_repo.create(
            application_id=app_id,
            draft_type="cover_letter",
            generator=settings.openai_model,
            content=state.cover_letter,
        )

        for qa in state.questions:
            import hashlib
            fingerprint = hashlib.md5(qa["question"].encode()).hexdigest()
            await draft_repo.create(
                application_id=app_id,
                draft_type="question_answer",
                question_fingerprint=fingerprint,
                generator=settings.openai_model,
                content=json.dumps(qa),
            )

        return {"application_id": app_id}

    graph = StateGraph(PrepareState)
    graph.add_node("fetch_detail", fetch_detail)
    graph.add_node("generate", generate)
    graph.add_node("persist", persist)

    graph.set_entry_point("fetch_detail")
    graph.add_edge("fetch_detail", "generate")
    graph.add_edge("generate", "persist")
    graph.add_edge("persist", END)

    return graph.compile()


async def run_prepare(
    settings: Settings,
    tool_client: ToolClient,
    job_repo: SqliteJobRepository,
    app_repo: SqliteApplicationRepository,
    draft_repo: SqliteDraftRepository,
    *,
    job_id: str,
) -> PrepareState:
    graph = build_prepare_graph(settings, tool_client, job_repo, app_repo, draft_repo)
    initial = PrepareState(job_id=job_id)
    result = await graph.ainvoke(initial)
    return PrepareState.model_validate(result)


def _load_profile(settings: Settings) -> dict:
    path = settings.resolved_profile_path
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))
