"""Custom harness shell for external apply pages.

Phase 4B is intentionally non-mutating: observe the page, ask the planner for
one proposed action, and return state for review/policy. Execution happens in a
later phase after deterministic safety validation.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from app.services.external_apply_ai import propose_external_apply_action
from app.services.external_apply_policy import validate_external_apply_action
from app.settings import Settings
from app.state.external_apply import (
    ActionResult,
    ActionTrace,
    ExternalApplyState,
    HarnessStatus,
    PageObservation,
    PolicyDecision,
    ProposedAction,
    UserQuestion,
)
from app.tools.browser_client import execute_external_apply_action, observe_external_apply
from app.tools.client import ToolClient

ObserveFn = Callable[[ToolClient, str], Awaitable[PageObservation]]
PlanFn = Callable[..., Awaitable[ProposedAction]]
PolicyFn = Callable[..., PolicyDecision]
ExecuteFn = Callable[[ToolClient, str, ProposedAction], Awaitable[ActionResult]]


async def plan_external_apply_step(
    settings: Settings,
    tool_client: ToolClient,
    *,
    session_key: str,
    application_id: str,
    profile_facts: dict[str, Any],
    approved_memory: list[dict[str, Any]] | None = None,
    recent_actions: list[ActionTrace] | None = None,
    observe_fn: ObserveFn = observe_external_apply,
    planner_fn: PlanFn = propose_external_apply_action,
) -> ExternalApplyState:
    """Observe a page and propose one next action without executing it."""

    memory = approved_memory or []
    traces = recent_actions or []
    observation = await observe_fn(tool_client, session_key)
    proposed_action = await planner_fn(
        settings,
        observation=observation,
        profile_facts=profile_facts,
        approved_memory=memory,
        recent_actions=traces,
    )

    return ExternalApplyState(
        application_id=application_id,
        current_url=observation.url,
        page_type=observation.page_type,
        observation=observation,
        proposed_action=proposed_action,
        completed_actions=traces,
        status=_status_for_proposed_action(proposed_action),
        submit_ready=proposed_action.action_type == "stop_ready_to_submit",
        pending_user_question=_user_question_for_action(proposed_action),
    )


def _status_for_proposed_action(action: ProposedAction) -> HarnessStatus:
    if action.action_type == "ask_user":
        return "paused_for_user"
    if action.action_type == "stop_ready_to_submit":
        return "ready_to_submit"
    if action.action_type == "stop_failed":
        return "failed"
    return "running"


def _user_question_for_action(action: ProposedAction) -> UserQuestion | None:
    if action.action_type != "ask_user":
        return None

    return UserQuestion(
        question=action.question or "Envoy needs your input before continuing.",
        context=action.reason,
        target_element_id=action.element_id,
    )


async def run_external_apply_step(
    settings: Settings,
    tool_client: ToolClient,
    *,
    session_key: str,
    application_id: str,
    profile_facts: dict[str, Any],
    approved_memory: list[dict[str, Any]] | None = None,
    recent_actions: list[ActionTrace] | None = None,
    observe_fn: ObserveFn = observe_external_apply,
    planner_fn: PlanFn = propose_external_apply_action,
    policy_fn: PolicyFn = validate_external_apply_action,
    execute_fn: ExecuteFn = execute_external_apply_action,
) -> ExternalApplyState:
    """Run one observe-plan-policy-execute step.

    The action is executed only when the deterministic policy returns
    decision="allowed". Paused/rejected actions are returned as state for the
    portal or workflow to handle.
    """

    planned = await plan_external_apply_step(
        settings,
        tool_client,
        session_key=session_key,
        application_id=application_id,
        profile_facts=profile_facts,
        approved_memory=approved_memory,
        recent_actions=recent_actions,
        observe_fn=observe_fn,
        planner_fn=planner_fn,
    )
    if planned.observation is None or planned.proposed_action is None:
        return planned

    policy = policy_fn(
        observation=planned.observation,
        proposed_action=planned.proposed_action,
    )

    if policy.decision != "allowed":
        trace = ActionTrace(
            observation=planned.observation,
            proposed_action=planned.proposed_action,
            policy_decision=policy.decision,
            result=None,
        )
        return planned.model_copy(
            update={
                "completed_actions": [*planned.completed_actions, trace],
                "risk_flags": policy.risk_flags,
                "status": _status_for_policy_pause(policy, planned.proposed_action),
                "pending_user_question": _user_question_for_policy(policy, planned.proposed_action),
                "submit_ready": policy.pause_reason == "final_submit",
                "error": policy.reason if policy.decision == "rejected" else None,
            }
        )

    result = await execute_fn(tool_client, session_key, planned.proposed_action)
    trace = ActionTrace(
        observation=planned.observation,
        proposed_action=planned.proposed_action,
        policy_decision="allowed",
        result=result,
    )
    return planned.model_copy(
        update={
            "completed_actions": [*planned.completed_actions, trace],
            "last_action_result": result,
            "current_url": result.new_url or planned.current_url,
            "status": "running" if result.ok else "failed",
            "error": None if result.ok else result.message,
            "risk_flags": result.errors,
        }
    )


def _status_for_policy_pause(policy: PolicyDecision, action: ProposedAction) -> HarnessStatus:
    if policy.decision == "rejected":
        return "failed"
    if policy.pause_reason == "final_submit" or action.action_type == "stop_ready_to_submit":
        return "ready_to_submit"
    if policy.pause_reason == "needs_approval":
        return "paused_for_approval"
    return "paused_for_user"


def _user_question_for_policy(policy: PolicyDecision, action: ProposedAction) -> UserQuestion | None:
    if policy.decision == "rejected" or policy.pause_reason == "final_submit":
        return None
    return UserQuestion(
        question=action.question or "Envoy needs your input or approval before continuing.",
        context=policy.reason,
        target_element_id=action.element_id,
    )
