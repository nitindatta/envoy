import pytest

from app.services.external_apply_ai import (
    build_external_apply_planner_messages,
    fallback_proposed_action,
    parse_planner_response,
)
from app.state.external_apply import ObservedAction, ObservedField, PageObservation


def test_parse_planner_response_accepts_known_observed_element() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        fields=[ObservedField(element_id="field_1", label="Full name", field_type="text")],
    )

    action = parse_planner_response(
        '{"action_type":"fill_text","element_id":"field_1","value":"Nitin Datta",'
        '"confidence":0.93,"risk":"low","reason":"Full name field.","source":"profile"}',
        observation,
    )

    assert action.action_type == "fill_text"
    assert action.element_id == "field_1"
    assert action.value == "Nitin Datta"


def test_parse_planner_response_rejects_unknown_element_id() -> None:
    observation = PageObservation(url="https://ats.example/apply")

    with pytest.raises(ValueError):
        parse_planner_response(
            '{"action_type":"click","element_id":"button_missing","confidence":0.9,'
            '"risk":"low","reason":"Click it.","source":"page"}',
            observation,
        )


def test_fallback_fills_safe_profile_field() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        fields=[ObservedField(element_id="field_1", label="Email address", field_type="email")],
    )

    action = fallback_proposed_action(observation, {"email": "nitin@example.com"}, [])

    assert action.action_type == "fill_text"
    assert action.element_id == "field_1"
    assert action.value == "nitin@example.com"
    assert action.source == "profile"


def test_fallback_asks_user_for_sensitive_field() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        fields=[ObservedField(element_id="field_salary", label="Expected salary", field_type="text")],
    )

    action = fallback_proposed_action(observation, {}, [])

    assert action.action_type == "ask_user"
    assert action.element_id == "field_salary"
    assert action.risk == "medium"


def test_fallback_stops_at_submit_button() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        buttons=[ObservedAction(element_id="button_submit", label="Submit application", kind="submit")],
    )

    action = fallback_proposed_action(observation, {}, [])

    assert action.action_type == "stop_ready_to_submit"
    assert action.element_id == "button_submit"
    assert action.risk == "high"


def test_prompt_includes_allowed_actions_and_observation() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        title="Apply",
        fields=[ObservedField(element_id="field_1", label="Full name", field_type="text")],
    )

    system, user = build_external_apply_planner_messages(
        observation=observation,
        profile_facts={"name": "Nitin Datta"},
        approved_memory=[],
        recent_actions=[],
    )

    assert "propose exactly one next action" in system
    assert "fill_text" in user
    assert "field_1" in user
