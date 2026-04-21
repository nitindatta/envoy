from app.services.external_apply_policy import validate_external_apply_action
from app.state.external_apply import ObservedAction, ObservedField, PageObservation, ProposedAction


def test_policy_allows_safe_profile_backed_fill() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        fields=[ObservedField(element_id="field_email", label="Email", field_type="email")],
    )
    action = ProposedAction(
        action_type="fill_text",
        element_id="field_email",
        value="nitin@example.com",
        confidence=0.94,
        risk="low",
        reason="Email comes from profile.",
        source="profile",
    )

    decision = validate_external_apply_action(observation=observation, proposed_action=action)

    assert decision.decision == "allowed"


def test_policy_pauses_low_confidence_action() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        fields=[ObservedField(element_id="field_name", label="Name", field_type="text")],
    )
    action = ProposedAction(
        action_type="fill_text",
        element_id="field_name",
        value="Nitin Datta",
        confidence=0.6,
        risk="low",
        reason="Maybe this is the name field.",
        source="profile",
    )

    decision = validate_external_apply_action(observation=observation, proposed_action=action)

    assert decision.decision == "paused"
    assert decision.pause_reason == "low_confidence"


def test_policy_pauses_sensitive_salary_field_even_with_profile_source() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        fields=[ObservedField(element_id="field_salary", label="Expected salary", field_type="text")],
    )
    action = ProposedAction(
        action_type="fill_text",
        element_id="field_salary",
        value="150000",
        confidence=0.95,
        risk="low",
        reason="Salary matched memory.",
        source="memory",
    )

    decision = validate_external_apply_action(observation=observation, proposed_action=action)

    assert decision.decision == "paused"
    assert decision.pause_reason == "sensitive"
    assert "salary" in decision.risk_flags


def test_policy_pauses_final_submit_click() -> None:
    observation = PageObservation(
        url="https://ats.example/review",
        buttons=[ObservedAction(element_id="button_submit", label="Submit application", kind="submit")],
    )
    action = ProposedAction(
        action_type="click",
        element_id="button_submit",
        confidence=0.96,
        risk="low",
        reason="Ready to submit.",
        source="page",
    )

    decision = validate_external_apply_action(observation=observation, proposed_action=action)

    assert decision.decision == "paused"
    assert decision.pause_reason == "final_submit"


def test_policy_rejects_unknown_element() -> None:
    observation = PageObservation(url="https://ats.example/apply")
    action = ProposedAction(
        action_type="click",
        element_id="button_missing",
        confidence=0.96,
        risk="low",
        reason="Click it.",
        source="page",
    )

    decision = validate_external_apply_action(observation=observation, proposed_action=action)

    assert decision.decision == "rejected"
    assert "unknown_element" in decision.risk_flags


def test_policy_pauses_planner_user_request() -> None:
    observation = PageObservation(url="https://ats.example/apply")
    action = ProposedAction(
        action_type="ask_user",
        question="How should I answer?",
        confidence=0.9,
        risk="medium",
        reason="User judgement required.",
        source="page",
    )

    decision = validate_external_apply_action(observation=observation, proposed_action=action)

    assert decision.decision == "paused"
    assert decision.pause_reason == "needs_user_input"
