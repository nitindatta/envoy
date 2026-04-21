from typing import Any

from app.services.external_apply_harness import plan_external_apply_step, run_external_apply_step
from app.state.external_apply import (
    ActionResult,
    ObservedAction,
    ObservedField,
    PageObservation,
    PolicyDecision,
    ProposedAction,
)


class DummySettings:
    pass


class DummyToolClient:
    pass


async def test_plan_external_apply_step_returns_running_for_browser_action() -> None:
    async def observe(_client: Any, _session_key: str) -> PageObservation:
        return PageObservation(
            url="https://ats.example/apply",
            page_type="form",
            fields=[ObservedField(element_id="field_1", label="Full name", field_type="text")],
        )

    async def planner(_settings: Any, **_kwargs: Any) -> ProposedAction:
        return ProposedAction(
            action_type="fill_text",
            element_id="field_1",
            value="Nitin Datta",
            confidence=0.95,
            risk="low",
            reason="Full name comes from profile.",
            source="profile",
        )

    state = await plan_external_apply_step(
        DummySettings(),  # type: ignore[arg-type]
        DummyToolClient(),  # type: ignore[arg-type]
        session_key="session-1",
        application_id="app-1",
        profile_facts={"name": "Nitin Datta"},
        observe_fn=observe,
        planner_fn=planner,
    )

    assert state.status == "running"
    assert state.current_url == "https://ats.example/apply"
    assert state.page_type == "form"
    assert state.proposed_action is not None
    assert state.proposed_action.action_type == "fill_text"


async def test_plan_external_apply_step_pauses_for_user_question() -> None:
    async def observe(_client: Any, _session_key: str) -> PageObservation:
        return PageObservation(
            url="https://ats.example/apply",
            page_type="form",
            fields=[ObservedField(element_id="field_salary", label="Expected salary", field_type="text")],
        )

    async def planner(_settings: Any, **_kwargs: Any) -> ProposedAction:
        return ProposedAction(
            action_type="ask_user",
            element_id="field_salary",
            question="What salary should I enter?",
            confidence=0.9,
            risk="medium",
            reason="Salary needs user confirmation.",
            source="page",
        )

    state = await plan_external_apply_step(
        DummySettings(),  # type: ignore[arg-type]
        DummyToolClient(),  # type: ignore[arg-type]
        session_key="session-1",
        application_id="app-1",
        profile_facts={},
        observe_fn=observe,
        planner_fn=planner,
    )

    assert state.status == "paused_for_user"
    assert state.pending_user_question is not None
    assert state.pending_user_question.question == "What salary should I enter?"
    assert state.pending_user_question.target_element_id == "field_salary"


async def test_plan_external_apply_step_marks_ready_to_submit() -> None:
    async def observe(_client: Any, _session_key: str) -> PageObservation:
        return PageObservation(
            url="https://ats.example/review",
            page_type="review",
            buttons=[ObservedAction(element_id="button_submit", label="Submit application", kind="submit")],
        )

    async def planner(_settings: Any, **_kwargs: Any) -> ProposedAction:
        return ProposedAction(
            action_type="stop_ready_to_submit",
            element_id="button_submit",
            confidence=0.94,
            risk="high",
            reason="Final submission needs human approval.",
            source="page",
        )

    state = await plan_external_apply_step(
        DummySettings(),  # type: ignore[arg-type]
        DummyToolClient(),  # type: ignore[arg-type]
        session_key="session-1",
        application_id="app-1",
        profile_facts={},
        observe_fn=observe,
        planner_fn=planner,
    )

    assert state.status == "ready_to_submit"
    assert state.submit_ready is True


async def test_run_external_apply_step_executes_when_policy_allows() -> None:
    async def observe(_client: Any, _session_key: str) -> PageObservation:
        return PageObservation(
            url="https://ats.example/apply",
            page_type="form",
            fields=[ObservedField(element_id="field_1", label="Full name", field_type="text")],
        )

    async def planner(_settings: Any, **_kwargs: Any) -> ProposedAction:
        return ProposedAction(
            action_type="fill_text",
            element_id="field_1",
            value="Nitin Datta",
            confidence=0.95,
            risk="low",
            reason="Full name comes from profile.",
            source="profile",
        )

    def policy(**_kwargs: Any) -> PolicyDecision:
        return PolicyDecision(decision="allowed", reason="safe")

    async def execute(_client: Any, _session_key: str, action: ProposedAction) -> ActionResult:
        return ActionResult(
            ok=True,
            action_type=action.action_type,
            element_id=action.element_id,
            message="action executed",
            value_after=action.value,
            new_url="https://ats.example/apply",
        )

    state = await run_external_apply_step(
        DummySettings(),  # type: ignore[arg-type]
        DummyToolClient(),  # type: ignore[arg-type]
        session_key="session-1",
        application_id="app-1",
        profile_facts={"name": "Nitin Datta"},
        observe_fn=observe,
        planner_fn=planner,
        policy_fn=policy,
        execute_fn=execute,
    )

    assert state.status == "running"
    assert state.last_action_result is not None
    assert state.last_action_result.ok is True
    assert len(state.completed_actions) == 1
    assert state.completed_actions[0].policy_decision == "allowed"


async def test_run_external_apply_step_does_not_execute_when_policy_pauses() -> None:
    async def observe(_client: Any, _session_key: str) -> PageObservation:
        return PageObservation(
            url="https://ats.example/apply",
            page_type="form",
            fields=[ObservedField(element_id="field_salary", label="Expected salary", field_type="text")],
        )

    async def planner(_settings: Any, **_kwargs: Any) -> ProposedAction:
        return ProposedAction(
            action_type="fill_text",
            element_id="field_salary",
            value="150000",
            confidence=0.95,
            risk="low",
            reason="Salary matched memory.",
            source="memory",
        )

    def policy(**_kwargs: Any) -> PolicyDecision:
        return PolicyDecision(
            decision="paused",
            reason="Sensitive field.",
            pause_reason="sensitive",
            risk_flags=["salary"],
        )

    async def execute(_client: Any, _session_key: str, _action: ProposedAction) -> ActionResult:
        raise AssertionError("execute should not be called")

    state = await run_external_apply_step(
        DummySettings(),  # type: ignore[arg-type]
        DummyToolClient(),  # type: ignore[arg-type]
        session_key="session-1",
        application_id="app-1",
        profile_facts={},
        observe_fn=observe,
        planner_fn=planner,
        policy_fn=policy,
        execute_fn=execute,
    )

    assert state.status == "paused_for_user"
    assert state.pending_user_question is not None
    assert state.risk_flags == ["salary"]
    assert state.completed_actions[0].policy_decision == "paused"
    assert state.completed_actions[0].result is None


async def test_run_external_apply_step_marks_reject_as_failed_without_execute() -> None:
    async def observe(_client: Any, _session_key: str) -> PageObservation:
        return PageObservation(url="https://ats.example/apply")

    async def planner(_settings: Any, **_kwargs: Any) -> ProposedAction:
        return ProposedAction(
            action_type="click",
            element_id="button_missing",
            confidence=0.95,
            risk="low",
            reason="Click missing button.",
            source="page",
        )

    def policy(**_kwargs: Any) -> PolicyDecision:
        return PolicyDecision(
            decision="rejected",
            reason="Unknown element.",
            risk_flags=["unknown_element"],
        )

    async def execute(_client: Any, _session_key: str, _action: ProposedAction) -> ActionResult:
        raise AssertionError("execute should not be called")

    state = await run_external_apply_step(
        DummySettings(),  # type: ignore[arg-type]
        DummyToolClient(),  # type: ignore[arg-type]
        session_key="session-1",
        application_id="app-1",
        profile_facts={},
        observe_fn=observe,
        planner_fn=planner,
        policy_fn=policy,
        execute_fn=execute,
    )

    assert state.status == "failed"
    assert state.error == "Unknown element."
    assert state.completed_actions[0].policy_decision == "rejected"
