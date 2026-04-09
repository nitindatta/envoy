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
import logging
from pathlib import Path
from typing import Any

from langgraph.graph import StateGraph, END

log = logging.getLogger("prepare")

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
        log.info("[fetch_detail] job_id=%s", state.job_id)
        job = await job_repo.get(state.job_id)
        if job is None:
            log.warning("[fetch_detail] job_id=%s not found in database", state.job_id)
            return {"error": f"job {state.job_id} not found in database"}

        # Extract provider_job_id from payload
        provider_job_id = str(job.payload.get("provider_job_id", ""))
        if not provider_job_id:
            log.warning("[fetch_detail] job_id=%s has no provider_job_id", state.job_id)
            return {"error": f"job {state.job_id} has no provider_job_id in payload"}

        log.info("[fetch_detail] fetching detail for provider_job_id=%s title=%s", provider_job_id, job.title)
        detail = await fetch_job_detail(tool_client, job_id=provider_job_id)
        log.info("[fetch_detail] done title=%s company=%s desc_len=%d",
                 detail.title, detail.company, len(detail.description))
        return {"detail": detail}

    async def generate(state: PrepareState) -> dict[str, Any]:
        if state.error or state.detail is None:
            log.warning("[generate] skipping — error=%s detail=%s", state.error, state.detail)
            return {}

        log.info("[generate] starting cover letter + Q&A for job=%s", state.detail.title)
        cl_result = await run_cover_letter(
            settings, job=state.detail, profile=profile
        )
        log.info("[generate] cover_letter: suitable=%s gaps=%s words=%d",
                 cl_result.is_suitable, cl_result.gaps, len(cl_result.cover_letter.split()))
        questions = await predict_questions(
            settings, job=state.detail, profile=profile
        )
        log.info("[generate] done: questions=%d", len(questions))
        return {
            "cover_letter": cl_result.cover_letter,
            "is_suitable": cl_result.is_suitable,
            "gaps": cl_result.gaps,
            "questions": questions,
        }

    async def persist(state: PrepareState) -> dict[str, Any]:
        if state.error:
            log.warning("[persist] skipping — error=%s", state.error)
            return {}
        if not state.is_suitable:
            log.info("[persist] skipping — not suitable (gaps=%s)", state.gaps)
            return {}

        job = await job_repo.get(state.job_id)
        if job is None:
            log.warning("[persist] job_id=%s not found", state.job_id)
            return {"error": f"job {state.job_id} not found"}

        app_id = await app_repo.create(
            job_id=state.job_id,
            source_provider=job.provider,
            source_url=job.source_url,
        )
        log.info("[persist] created application_id=%s for job=%s", app_id, state.job_id)

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

        log.info("[persist] saved cover_letter + %d Q&A drafts for application_id=%s",
                 len(state.questions), app_id)
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
