"""LangGraph apply workflow — Phase 3.

Nodes:
  launch        → open browser session, navigate to job, click Apply
  inspect       → inspect current form step → StepInfo
  propose       → resolve field values (profile / memory / LLM)
  gate          → HITL pause (interrupt_before pattern — portal fills approved_values)
  fill          → fill_and_continue → advance to next step
  finish        → close session, update application state

HITL pattern:
  compile(interrupt_before=["gate"]) — graph pauses BEFORE gate on every loop.
  Portal reads proposed_values from returned state, user edits.
  resume_apply calls graph.update_state() then graph.ainvoke(None, config).
  gate node runs with the updated state (approved_values and action_label already merged in).
"""

from __future__ import annotations

import json
from typing import Any, Literal

import aiosqlite
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from app.persistence.sqlite.applications import SqliteApplicationRepository, SqliteDraftRepository
from app.persistence.sqlite.workflow_runs import SqliteWorkflowRunRepository, SqliteBrowserSessionRepository
from app.services.answer_field import propose_field_values
from app.settings import Settings
from app.state.apply import ApplyState, StepInfo
from app.tools.browser_client import (
    inspect_apply_step,
    fill_and_continue,
    close_session,
    start_apply,
    launch_session,
    BrowserToolError,
)
from app.tools.client import ToolClient, ToolServiceError


def _load_profile(settings: Settings) -> dict:
    path = settings.resolved_profile_path
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def build_apply_graph(
    settings: Settings,
    tool_client: ToolClient,
    app_repo: SqliteApplicationRepository,
    draft_repo: SqliteDraftRepository,
    run_repo: SqliteWorkflowRunRepository,
    session_repo: SqliteBrowserSessionRepository,
    db_conn: aiosqlite.Connection,
):
    profile = _load_profile(settings)

    # ── launch ─────────────────────────────────────────────────────────────
    async def node_launch(state: ApplyState) -> dict[str, Any]:
        app = await app_repo.get(state.application_id)
        if app is None:
            return {"status": "failed", "error": f"application {state.application_id} not found"}

        try:
            session_key = await launch_session(tool_client, provider="seek")
        except (BrowserToolError, ToolServiceError) as exc:
            return {"status": "failed", "error": str(exc)}

        # Record session in DB for stale cleanup
        await session_repo.create(
            provider="seek",
            session_key=session_key,
            application_id=state.application_id,
        )

        try:
            env = await tool_client.call(
                "/tools/providers/start_apply",
                {"session_key": session_key, "provider": "seek", "job_url": app.source_url},
            )
        except ToolServiceError as exc:
            return {"session_key": session_key, "status": "failed", "error": str(exc)}

        # Auth required — not logged in to SEEK
        if env.status == "needs_human":
            reason = (env.data or {}).get("reason", "auth_required")
            login_url = (env.data or {}).get("login_url", "")
            return {
                "session_key": session_key,
                "status": "paused",
                "pause_reason": reason,
                "current_step": StepInfo(
                    page_url=login_url,
                    page_type="auth_required",
                    fields=[],
                    visible_actions=[],
                ),
            }

        if env.status == "error":
            return {"session_key": session_key, "status": "failed", "error": env.error}

        apply_result = env.data or {}

        if apply_result.get("is_external_portal"):
            return {
                "session_key": session_key,
                "status": "paused",
                "pause_reason": "external_portal",
                "current_step": StepInfo(
                    page_url=apply_result.get("apply_url", ""),
                    page_type="external_redirect",
                    is_external_portal=True,
                    portal_type=apply_result.get("portal_type"),
                    fields=[],
                    visible_actions=[],
                ),
            }

        return {"session_key": session_key}

    # ── inspect ────────────────────────────────────────────────────────────
    async def node_inspect(state: ApplyState) -> dict[str, Any]:
        if state.status in ("failed", "aborted", "completed", "paused"):
            return {}

        try:
            step, env = await inspect_apply_step(tool_client, state.session_key)
        except (BrowserToolError, ToolServiceError) as exc:
            return {"status": "failed", "error": str(exc)}

        if step is None:
            return {
                "status": "paused",
                "pause_reason": "drift",
                "current_step": StepInfo(
                    page_url="",
                    page_type="unknown",
                    fields=[],
                    visible_actions=[],
                ),
            }

        if step.page_type == "confirmation":
            return {"current_step": step, "status": "completed"}

        if step.page_type == "external_redirect":
            return {"current_step": step, "status": "paused", "pause_reason": "external_portal"}

        return {"current_step": step}

    # ── propose ────────────────────────────────────────────────────────────
    async def node_propose(state: ApplyState) -> dict[str, Any]:
        if state.status in ("failed", "aborted", "completed", "paused"):
            return {}
        if state.current_step is None or not state.current_step.fields:
            return {"proposed_values": {}}

        drafts = await draft_repo.list_for_application(state.application_id)
        cover_letter = next(
            (d.content for d in drafts if d.draft_type == "cover_letter"), ""
        )

        proposed, low_conf_ids = await propose_field_values(
            fields=state.current_step.fields,
            profile=profile,
            cover_letter=cover_letter,
            settings=settings,
            db_conn=db_conn,
        )

        return {"proposed_values": proposed, "low_confidence_ids": low_conf_ids}

    # ── gate ───────────────────────────────────────────────────────────────
    # With interrupt_before=["gate"], this node runs only on RESUME.
    # The portal-approved values are already merged into state via update_state().
    # This node is a validation pass-through; routing handles abort.
    async def node_gate(state: ApplyState) -> dict[str, Any]:
        return {}

    # ── fill ───────────────────────────────────────────────────────────────
    async def node_fill(state: ApplyState) -> dict[str, Any]:
        if state.status in ("failed", "aborted", "completed", "paused"):
            return {}

        try:
            next_step, env = await fill_and_continue(
                tool_client,
                state.session_key,
                fields=state.proposed_values,
                action_label=state.action_label,
            )
        except (BrowserToolError, ToolServiceError) as exc:
            return {"status": "failed", "error": str(exc)}

        history_entry = {
            "step": state.current_step.model_dump() if state.current_step else {},
            "filled_values": state.proposed_values,
        }
        new_history = list(state.step_history) + [history_entry]

        if next_step is None:
            if env.status == "error":
                return {"status": "failed", "error": env.error, "step_history": new_history}
            return {
                "status": "paused",
                "pause_reason": "drift",
                "current_step": StepInfo(
                    page_url="",
                    page_type="unknown",
                    fields=[],
                    visible_actions=[],
                ),
                "step_history": new_history,
            }

        if next_step.page_type == "confirmation":
            return {
                "current_step": next_step,
                "status": "completed",
                "step_history": new_history,
            }

        return {
            "current_step": next_step,
            "proposed_values": {},
            "action_label": "Continue",
            "step_history": new_history,
        }

    # ── finish ─────────────────────────────────────────────────────────────
    async def node_finish(state: ApplyState) -> dict[str, Any]:
        if state.session_key:
            await close_session(tool_client, state.session_key)
            await session_repo.close(state.session_key)

        target_app_state = {
            "completed": "applied",
            "failed": "failed",
            "aborted": "approved",  # back to queue
            "paused": "paused",
        }.get(state.status, state.status)

        await app_repo.update_state(state.application_id, target_app_state)
        await run_repo.finish(state.workflow_run_id, state.status)

        return {}

    # ── routing ────────────────────────────────────────────────────────────
    def _route_after_launch(state: ApplyState) -> Literal["inspect", "finish"]:
        if state.status in ("failed", "paused"):
            return "finish"
        return "inspect"

    def _route_after_inspect(state: ApplyState) -> Literal["propose", "finish"]:
        if state.status in ("failed", "completed", "paused"):
            return "finish"
        return "propose"

    def _route_after_gate(state: ApplyState) -> Literal["fill", "finish"]:
        if state.status == "aborted":
            return "finish"
        return "fill"

    def _route_after_propose(state: ApplyState) -> Literal["gate", "fill"]:
        """Skip the HITL gate when all fields were resolved with high confidence."""
        if state.status in ("failed", "completed", "aborted", "paused"):
            return "fill"  # fill will short-circuit due to status
        if state.low_confidence_ids:
            return "gate"   # human review needed
        return "fill"       # auto-proceed

    def _route_after_fill(state: ApplyState) -> Literal["propose", "finish"]:
        if state.status in ("failed", "completed", "aborted", "paused"):
            return "finish"
        return "propose"

    # ── assemble graph ─────────────────────────────────────────────────────
    graph = StateGraph(ApplyState)
    graph.add_node("launch", node_launch)
    graph.add_node("inspect", node_inspect)
    graph.add_node("propose", node_propose)
    graph.add_node("gate", node_gate)
    graph.add_node("fill", node_fill)
    graph.add_node("finish", node_finish)

    graph.set_entry_point("launch")
    graph.add_conditional_edges("launch", _route_after_launch)
    graph.add_conditional_edges("inspect", _route_after_inspect)
    graph.add_conditional_edges("propose", _route_after_propose)
    graph.add_conditional_edges("gate", _route_after_gate)
    graph.add_conditional_edges("fill", _route_after_fill)
    graph.add_edge("finish", END)

    return graph


def _make_compiled(graph_builder, checkpointer):
    return graph_builder.compile(
        checkpointer=checkpointer,
        interrupt_before=["gate"],
    )


async def run_apply(
    settings: Settings,
    tool_client: ToolClient,
    app_repo: SqliteApplicationRepository,
    draft_repo: SqliteDraftRepository,
    run_repo: SqliteWorkflowRunRepository,
    session_repo: SqliteBrowserSessionRepository,
    db_conn: aiosqlite.Connection,
    *,
    application_id: str,
    workflow_run_id: str,
) -> ApplyState:
    """Start a new apply workflow run. Runs until first interrupt (gate) or terminal state."""
    graph_builder = build_apply_graph(
        settings, tool_client, app_repo, draft_repo, run_repo, session_repo, db_conn
    )
    checkpointer = AsyncSqliteSaver(db_conn)
    graph = _make_compiled(graph_builder, checkpointer)

    config = {"configurable": {"thread_id": workflow_run_id}}
    initial = ApplyState(
        application_id=application_id,
        workflow_run_id=workflow_run_id,
    )
    result = await graph.ainvoke(initial.model_dump(), config)
    return ApplyState.model_validate(result)


async def resume_apply(
    settings: Settings,
    tool_client: ToolClient,
    app_repo: SqliteApplicationRepository,
    draft_repo: SqliteDraftRepository,
    run_repo: SqliteWorkflowRunRepository,
    session_repo: SqliteBrowserSessionRepository,
    db_conn: aiosqlite.Connection,
    *,
    workflow_run_id: str,
    approved_values: dict[str, str],
    action_label: str = "Continue",
    action: str = "continue",  # "continue" | "abort"
) -> ApplyState:
    """Resume a paused workflow run with user-approved values."""
    graph_builder = build_apply_graph(
        settings, tool_client, app_repo, draft_repo, run_repo, session_repo, db_conn
    )
    checkpointer = AsyncSqliteSaver(db_conn)
    graph = _make_compiled(graph_builder, checkpointer)

    config = {"configurable": {"thread_id": workflow_run_id}}

    # Merge user edits into checkpointed state before resuming
    state_update: dict[str, Any] = {
        "proposed_values": approved_values,
        "action_label": action_label,
    }
    if action == "abort":
        state_update["status"] = "aborted"

    await graph.aupdate_state(config, state_update)
    result = await graph.ainvoke(None, config)
    return ApplyState.model_validate(result)
