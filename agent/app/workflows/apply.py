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
import logging
from typing import Any, Literal

log = logging.getLogger("apply")

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
        log.info("[launch] application_id=%s", state.application_id)
        app = await app_repo.get(state.application_id)
        if app is None:
            log.warning("[launch] application not found: %s", state.application_id)
            return {"status": "failed", "error": f"application {state.application_id} not found"}

        try:
            session_key = await launch_session(tool_client, provider="seek")
            log.info("[launch] session_key=%s url=%s", session_key, app.source_url)
        except (BrowserToolError, ToolServiceError) as exc:
            log.error("[launch] launch_session failed: %s", exc)
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
            log.error("[launch] start_apply failed: %s", exc)
            return {"session_key": session_key, "status": "failed", "error": str(exc)}

        # Auth required — not logged in to SEEK
        if env.status == "needs_human":
            reason = (env.data or {}).get("reason", "auth_required")
            login_url = (env.data or {}).get("login_url", "")
            log.warning("[launch] auth required: reason=%s login_url=%s", reason, login_url)
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
            log.error("[launch] start_apply returned error: %s", env.error)
            return {"session_key": session_key, "status": "failed", "error": env.error}

        apply_result = env.data or {}

        if apply_result.get("is_external_portal"):
            log.info("[launch] external portal detected: portal_type=%s url=%s",
                     apply_result.get("portal_type"), apply_result.get("apply_url"))
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

        log.info("[launch] started successfully session_key=%s", session_key)
        return {"session_key": session_key}

    # ── inspect ────────────────────────────────────────────────────────────
    async def node_inspect(state: ApplyState) -> dict[str, Any]:
        if state.status in ("failed", "aborted", "completed", "paused"):
            log.debug("[inspect] skipping — status=%s", state.status)
            return {}

        log.info("[inspect] session_key=%s", state.session_key)
        try:
            step, env = await inspect_apply_step(tool_client, state.session_key)
        except (BrowserToolError, ToolServiceError) as exc:
            log.error("[inspect] failed: %s", exc)
            return {"status": "failed", "error": str(exc)}

        if step is None:
            log.warning("[inspect] drift — env.status=%s", env.status)
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

        log.info("[inspect] page_type=%s fields=%d actions=%s",
                 step.page_type, len(step.fields), step.visible_actions)

        if step.page_type == "confirmation":
            log.info("[inspect] confirmation page — marking completed")
            return {"current_step": step, "status": "completed"}

        if step.page_type == "external_redirect":
            log.info("[inspect] external redirect — pausing")
            return {"current_step": step, "status": "paused", "pause_reason": "external_portal"}

        return {"current_step": step}

    # ── propose ────────────────────────────────────────────────────────────
    async def node_propose(state: ApplyState) -> dict[str, Any]:
        if state.status in ("failed", "aborted", "completed", "paused"):
            log.debug("[propose] skipping — status=%s", state.status)
            return {}
        if state.current_step is None or not state.current_step.fields:
            log.debug("[propose] no fields to propose")
            return {"proposed_values": {}}

        log.info("[propose] application_id=%s fields=%d page_type=%s",
                 state.application_id, len(state.current_step.fields), state.current_step.page_type)

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

        log.info("[propose] done: proposed=%d low_confidence=%s", len(proposed), low_conf_ids)
        return {"proposed_values": proposed, "low_confidence_ids": low_conf_ids}

    # ── gate ───────────────────────────────────────────────────────────────
    # With interrupt_before=["gate"], this node runs only on RESUME.
    # The portal-approved values are already merged into state via update_state().
    # This node is a validation pass-through; routing handles abort.
    async def node_gate(state: ApplyState) -> dict[str, Any]:
        log.info("[gate] resumed: action=%s approved_fields=%d",
                 "abort" if state.status == "aborted" else "continue", len(state.proposed_values))
        return {}

    # ── submit_gate ────────────────────────────────────────────────────────
    # Mandatory HITL pause before the final submit click.
    # Runs only on RESUME — portal confirmed the user wants to submit to SEEK.
    async def node_submit_gate(state: ApplyState) -> dict[str, Any]:
        log.info("[submit_gate] user confirmed submit: action_label=%r", state.submit_action_label)
        return {"status": "running"}

    # ── submit ─────────────────────────────────────────────────────────────
    async def node_submit(state: ApplyState) -> dict[str, Any]:
        if state.status in ("failed", "aborted"):
            log.debug("[submit] skipping — status=%s", state.status)
            return {}

        log.info("[submit] clicking final submit: session=%s action=%r",
                 state.session_key, state.submit_action_label)
        try:
            next_step, env = await fill_and_continue(
                tool_client,
                state.session_key,
                fields={},
                action_label=state.submit_action_label,
            )
        except (BrowserToolError, ToolServiceError) as exc:
            log.error("[submit] fill_and_continue failed: %s", exc)
            return {"status": "failed", "error": str(exc)}

        if next_step is None:
            log.error("[submit] error or drift after submit: %s", env.status)
            return {"status": "failed", "error": env.error or "drift after submit"}

        if next_step.page_type == "confirmation":
            log.info("[submit] confirmed — application submitted")
            return {"current_step": next_step, "status": "completed"}

        log.warning("[submit] unexpected page after submit: page_type=%s", next_step.page_type)
        return {"current_step": next_step, "status": "completed"}

    # ── fill ───────────────────────────────────────────────────────────────
    async def node_fill(state: ApplyState) -> dict[str, Any]:
        if state.status in ("failed", "aborted", "completed", "paused"):
            log.debug("[fill] skipping — status=%s", state.status)
            return {}

        log.info("[fill] session_key=%s fields=%d action_label=%r",
                 state.session_key, len(state.proposed_values), state.action_label)

        try:
            next_step, env = await fill_and_continue(
                tool_client,
                state.session_key,
                fields=state.proposed_values,
                action_label=state.action_label,
            )
        except (BrowserToolError, ToolServiceError) as exc:
            log.error("[fill] fill_and_continue failed: %s", exc)
            return {"status": "failed", "error": str(exc)}

        history_entry = {
            "step": state.current_step.model_dump() if state.current_step else {},
            "filled_values": state.proposed_values,
        }
        new_history = list(state.step_history) + [history_entry]

        if next_step is None:
            if env.status == "error":
                log.error("[fill] error after fill: %s", env.error)
                return {"status": "failed", "error": env.error, "step_history": new_history}
            log.warning("[fill] drift after fill — env.status=%s", env.status)
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

        log.info("[fill] next page_type=%s fields=%d", next_step.page_type, len(next_step.fields))

        if next_step.page_type == "confirmation":
            log.info("[fill] application submitted — confirmation page")
            return {
                "current_step": next_step,
                "status": "completed",
                "step_history": new_history,
            }

        # 0-field form page = SEEK review/summary page. Pause for user to confirm submit.
        if next_step.page_type == "form" and len(next_step.fields) == 0:
            # Pick the real submit button — ignore noise like "Open app", "Back", "Cancel"
            _submit_keywords = ("submit", "continue", "apply", "send", "confirm", "next")
            _exclude_keywords = ("open app", "back", "cancel", "close", "sign", "log")
            submit_label = next(
                (a for a in next_step.visible_actions
                 if any(kw in a.lower() for kw in _submit_keywords)
                 and not any(ex in a.lower() for ex in _exclude_keywords)),
                next(
                    (a for a in next_step.visible_actions
                     if not any(ex in a.lower() for ex in _exclude_keywords)),
                    "Continue",
                ),
            )
            log.info("[fill] review page detected — pausing for submit confirmation (action=%r) all_actions=%s",
                     submit_label, next_step.visible_actions)
            return {
                "current_step": next_step,
                "status": "awaiting_submit",
                "submit_action_label": submit_label,
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
        log.info("[finish] application_id=%s workflow_run_id=%s final_status=%s",
                 state.application_id, state.workflow_run_id, state.status)

        if state.session_key:
            await close_session(tool_client, state.session_key)
            await session_repo.close(state.session_key)
            log.debug("[finish] closed session_key=%s", state.session_key)

        target_app_state = {
            "completed": "applied",
            "failed": "failed",
            "aborted": "approved",  # back to queue
            "paused": "paused",
        }.get(state.status, state.status)

        await app_repo.update_state(state.application_id, target_app_state)
        await run_repo.finish(state.workflow_run_id, state.status)
        log.info("[finish] app state → %s steps=%d", target_app_state, len(state.step_history))

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

    def _route_after_fill(state: ApplyState) -> Literal["propose", "submit_gate", "finish"]:
        if state.status in ("failed", "completed", "aborted", "paused"):
            return "finish"
        if state.status == "awaiting_submit":
            return "submit_gate"
        return "propose"

    def _route_after_submit_gate(state: ApplyState) -> Literal["submit", "finish"]:
        if state.status == "aborted":
            return "finish"
        return "submit"

    # ── assemble graph ─────────────────────────────────────────────────────
    graph = StateGraph(ApplyState)
    graph.add_node("launch", node_launch)
    graph.add_node("inspect", node_inspect)
    graph.add_node("propose", node_propose)
    graph.add_node("gate", node_gate)
    graph.add_node("fill", node_fill)
    graph.add_node("submit_gate", node_submit_gate)
    graph.add_node("submit", node_submit)
    graph.add_node("finish", node_finish)

    graph.set_entry_point("launch")
    graph.add_conditional_edges("launch", _route_after_launch)
    graph.add_conditional_edges("inspect", _route_after_inspect)
    graph.add_conditional_edges("propose", _route_after_propose)
    graph.add_conditional_edges("gate", _route_after_gate)
    graph.add_conditional_edges("fill", _route_after_fill)
    graph.add_conditional_edges("submit_gate", _route_after_submit_gate)
    graph.add_edge("submit", "finish")
    graph.add_edge("finish", END)

    return graph


def _make_compiled(graph_builder, checkpointer):
    return graph_builder.compile(
        checkpointer=checkpointer,
        interrupt_before=["gate", "submit_gate"],
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
