import pytest
from pydantic import ValidationError

from app.state.external_apply import ActionResult, ExternalApplyState, PageObservation, ProposedAction
from app.tools.browser_client import BrowserToolError, execute_external_apply_action


def test_page_observation_defaults_are_harness_friendly() -> None:
    observation = PageObservation(url="https://ats.example/apply")

    assert observation.page_type == "unknown"
    assert observation.fields == []
    assert observation.buttons == []
    assert observation.links == []
    assert observation.uploads == []
    assert observation.errors == []


def test_proposed_action_confidence_is_bounded() -> None:
    with pytest.raises(ValidationError):
        ProposedAction(
            action_type="click",
            element_id="button_1",
            confidence=1.2,
            risk="low",
            reason="Too confident.",
        )


def test_external_apply_state_tracks_one_loop_boundary() -> None:
    state = ExternalApplyState(
        application_id="app-1",
        observation=PageObservation(url="https://ats.example/apply", page_type="form"),
        proposed_action=ProposedAction(
            action_type="fill_text",
            element_id="field_1",
            value="Nitin Datta",
            confidence=0.96,
            risk="low",
            reason="The label asks for full name and the value is approved profile data.",
            source="profile",
        ),
    )

    assert state.status == "running"
    assert state.page_type == "unknown"
    assert state.observation is not None
    assert state.proposed_action is not None


def test_action_result_matches_tools_executor_contract() -> None:
    result = ActionResult(
        ok=True,
        action_type="fill_text",
        element_id="field_1",
        message="action executed",
        value_after="Nitin Datta",
        navigated=False,
        new_url="https://ats.example/apply",
    )

    assert result.ok is True
    assert result.errors == []


async def test_browser_wrapper_rejects_non_browser_actions_before_tool_call() -> None:
    class FailingClient:
        async def call(self, *_args: object, **_kwargs: object) -> object:
            raise AssertionError("tool client should not be called")

    action = ProposedAction(
        action_type="ask_user",
        question="What salary should I enter?",
        confidence=0.9,
        risk="medium",
        reason="Salary answers need user confirmation.",
    )

    with pytest.raises(BrowserToolError):
        await execute_external_apply_action(FailingClient(), "session-1", action)  # type: ignore[arg-type]
