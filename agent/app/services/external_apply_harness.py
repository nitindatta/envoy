"""Custom harness shell for external apply pages."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from app.services.external_apply_ai import propose_external_apply_action, propose_external_apply_actions
from app.services.external_apply_policy import (
    is_standard_privacy_consent_field,
    validate_external_apply_action,
)
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

EXTERNAL_USER_ANSWER_KEY = "__external_apply_user_answer"

ObserveFn = Callable[[ToolClient, str], Awaitable[PageObservation]]
PlanFn = Callable[..., Awaitable[ProposedAction]]
BatchPlanFn = Callable[..., Awaitable[list[ProposedAction]]]
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
    batch_planner_fn: BatchPlanFn | None = None,
    policy_fn: PolicyFn = validate_external_apply_action,
    execute_fn: ExecuteFn = execute_external_apply_action,
) -> ExternalApplyState:
    """Run one observe-plan-policy-execute step or one safe page-level batch.

    The action is executed only when the deterministic policy returns
    decision="allowed". Paused/rejected actions are returned as state for the
    portal or workflow to handle.
    """

    memory = approved_memory or []
    traces = list(recent_actions or [])
    observation = await observe_fn(tool_client, session_key)
    effective_batch_planner = batch_planner_fn
    if effective_batch_planner is None and planner_fn is propose_external_apply_action:
        effective_batch_planner = propose_external_apply_actions

    if effective_batch_planner is not None:
        actions = await effective_batch_planner(
            settings,
            observation=observation,
            profile_facts=profile_facts,
            approved_memory=memory,
            recent_actions=traces,
        )
    else:
        actions = [
            await planner_fn(
                settings,
                observation=observation,
                profile_facts=profile_facts,
                approved_memory=memory,
                recent_actions=traces,
            )
        ]

    if not actions:
        actions = [
            ProposedAction(
                action_type="ask_user",
                question="I could not determine a safe next action on this page. What should I do next?",
                confidence=0.75,
                risk="medium",
                reason="Planner returned no actions.",
                source="page",
            )
        ]

    completed_actions = traces
    current_url = observation.url
    last_result: ActionResult | None = None
    last_state: ExternalApplyState | None = None
    mutated_current_page = False

    for action in actions:
        if action.action_type == "click" and mutated_current_page and last_state is not None:
            return last_state

        planned = ExternalApplyState(
            application_id=application_id,
            current_url=current_url,
            page_type=observation.page_type,
            observation=observation,
            proposed_action=action,
            completed_actions=completed_actions,
            status=_status_for_proposed_action(action),
            submit_ready=action.action_type == "stop_ready_to_submit",
            pending_user_question=_user_question_for_action(action),
            last_action_result=last_result,
        )
        planned = _apply_default_safe_action(planned)
        if planned.proposed_action is None:
            return planned

        policy = policy_fn(
            observation=observation,
            proposed_action=planned.proposed_action,
            profile_facts=profile_facts,
        )

        if policy.decision != "allowed":
            trace = ActionTrace(
                observation=observation,
                proposed_action=planned.proposed_action,
                policy_decision=policy.decision,
                result=None,
            )
            return planned.model_copy(
                update={
                    "completed_actions": [*completed_actions, trace],
                    "risk_flags": policy.risk_flags,
                    "status": _status_for_policy_pause(policy, planned.proposed_action),
                    "pending_user_question": _user_question_for_policy(policy, planned.proposed_action),
                    "submit_ready": policy.pause_reason == "final_submit",
                    "error": policy.reason if policy.decision == "rejected" else None,
                }
            )

        result = await execute_fn(tool_client, session_key, planned.proposed_action)
        trace = ActionTrace(
            observation=observation,
            proposed_action=planned.proposed_action,
            policy_decision="allowed",
            result=result,
        )
        completed_actions = [*completed_actions, trace]
        current_url = result.new_url or current_url
        last_result = result
        last_state = planned.model_copy(
            update={
                "completed_actions": completed_actions,
                "last_action_result": result,
                "current_url": current_url,
                "status": "running" if result.ok else "failed",
                "error": None if result.ok else result.message,
                "risk_flags": result.errors,
                "pending_user_question": None,
                "submit_ready": False,
            }
        )
        if not result.ok:
            return last_state

        if planned.proposed_action.action_type in {"fill_text", "select_option", "set_checkbox", "set_radio", "upload_file"}:
            mutated_current_page = True

        if planned.proposed_action.action_type == "click":
            return last_state

    if last_state is not None:
        return last_state

    first_action = actions[0]
    return ExternalApplyState(
        application_id=application_id,
        current_url=current_url,
        page_type=observation.page_type,
        observation=observation,
        proposed_action=first_action,
        completed_actions=completed_actions,
        status=_status_for_proposed_action(first_action),
        submit_ready=first_action.action_type == "stop_ready_to_submit",
        pending_user_question=_user_question_for_action(first_action),
    )


async def apply_external_user_answer(
    tool_client: ToolClient,
    *,
    session_key: str,
    external_state: ExternalApplyState,
    answer: str,
    execute_fn: ExecuteFn = execute_external_apply_action,
) -> ExternalApplyState:
    """Apply an explicit user answer to the paused external page.

    This is used for questions like privacy consent where the planner correctly
    paused for human confirmation. The answer is treated as user-sourced and
    still recorded as an auditable action trace.
    """

    observation = external_state.observation
    target_id = external_state.pending_user_question.target_element_id if external_state.pending_user_question else None
    if observation is None or not target_id:
        return external_state.model_copy(
            update={
                "status": "paused_for_user",
                "error": "No paused external question target was available.",
                "risk_flags": [*external_state.risk_flags, "missing_user_answer_target"],
            }
        )

    target_field = next((field for field in observation.fields if field.element_id == target_id), None)
    target_button = None
    if target_field is None:
        target_button = next(
            (btn for btn in (*observation.buttons, *observation.links) if btn.element_id == target_id),
            None,
        )
    if target_field is None and target_button is None:
        return external_state.model_copy(
            update={
                "status": "failed",
                "error": f"User-approved target element was not present: {target_id}",
                "risk_flags": [*external_state.risk_flags, "missing_user_answer_target"],
            }
        )

    if target_field is not None:
        action = _action_from_user_answer(target_field.element_id, target_field.field_type, answer)
    else:
        action = _action_from_user_answer_for_button(target_button.element_id, answer)
        if action is None:
            return external_state.model_copy(
                update={
                    "status": "running",
                    "pending_user_question": None,
                    "proposed_action": None,
                    "risk_flags": [*external_state.risk_flags, "user_declined_button"],
                }
            )
    result = await execute_fn(tool_client, session_key, action)
    trace = ActionTrace(
        observation=observation,
        proposed_action=action,
        policy_decision="allowed",
        result=result,
    )
    return external_state.model_copy(
        update={
            "completed_actions": [*external_state.completed_actions, trace],
            "last_action_result": result,
            "current_url": result.new_url or external_state.current_url,
            "status": "running" if result.ok else "failed",
            "pending_user_question": None if result.ok else external_state.pending_user_question,
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


def _apply_default_safe_action(state: ExternalApplyState) -> ExternalApplyState:
    observation = state.observation
    action = state.proposed_action
    if observation is None or action is None or not action.element_id:
        return state

    target_field = next((field for field in observation.fields if field.element_id == action.element_id), None)
    if target_field is None or not is_standard_privacy_consent_field(observation, target_field):
        return state

    if action.action_type not in {"ask_user", "set_checkbox"}:
        return state

    default_action = ProposedAction(
        action_type="set_checkbox",
        element_id=target_field.element_id,
        value="true",
        confidence=1.0,
        risk="low",
        reason="Standard required application privacy/data handling consent is configured as a default-safe action.",
        source="user",
    )
    return state.model_copy(
        update={
            "proposed_action": default_action,
            "status": "running",
            "pending_user_question": None,
        }
    )


def _action_from_user_answer(element_id: str, field_type: str, answer: str) -> ProposedAction:
    if field_type == "checkbox":
        action_type = "set_checkbox"
        value = "true" if _truthy_answer(answer) else "false"
    elif field_type == "radio":
        action_type = "set_radio"
        value = answer
    elif field_type == "select":
        action_type = "select_option"
        value = answer
    elif field_type == "file":
        action_type = "upload_file"
        value = answer
    else:
        action_type = "fill_text"
        value = answer

    return ProposedAction(
        action_type=action_type,  # type: ignore[arg-type]
        element_id=element_id,
        value=value,
        confidence=1.0,
        risk="medium",
        reason="User explicitly answered the paused external-apply question.",
        source="user",
    )


def _action_from_user_answer_for_button(element_id: str, answer: str) -> ProposedAction | None:
    if not _truthy_answer(answer):
        return None
    return ProposedAction(
        action_type="click",
        element_id=element_id,
        confidence=1.0,
        risk="medium",
        reason="User approved clicking the paused external-apply button.",
        source="user",
    )


def _truthy_answer(answer: str) -> bool:
    return answer.strip().lower() in {"1", "true", "yes", "y", "checked", "consent", "confirmed", "approve", "approved"}
