import pytest

from app.services.external_apply_ai import (
    build_external_apply_batch_planner_messages,
    build_external_apply_planner_messages,
    fallback_proposed_action,
    fallback_proposed_actions,
    parse_planner_batch_response,
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


def test_parse_planner_batch_response_accepts_multiple_known_fields() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        fields=[
            ObservedField(element_id="field_1", label="First name", field_type="text"),
            ObservedField(element_id="field_2", label="Last name", field_type="text"),
        ],
    )

    actions = parse_planner_batch_response(
        '{"actions":['
        '{"action_type":"fill_text","element_id":"field_1","value":"Nitin",'
        '"confidence":0.96,"risk":"low","reason":"First name field.","source":"profile"},'
        '{"action_type":"fill_text","element_id":"field_2","value":"Datta",'
        '"confidence":0.96,"risk":"low","reason":"Last name field.","source":"profile"}'
        "]}",
        observation,
    )

    assert [action.element_id for action in actions] == ["field_1", "field_2"]


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


def test_fallback_retries_invalid_field_even_when_it_has_a_value() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        fields=[
            ObservedField(
                element_id="field_postcode",
                label="Postcode",
                field_type="text",
                current_value="abc",
                invalid=True,
                validation_message="Enter a valid postcode.",
            )
        ],
    )

    action = fallback_proposed_action(
        observation,
        {"address": {"postcode": "2000"}},
        [],
    )

    assert action.action_type == "fill_text"
    assert action.element_id == "field_postcode"
    assert action.value == "2000"
    assert action.source == "profile"


def test_batch_fallback_retries_invalid_field_before_disabled_continue_pause() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        fields=[
            ObservedField(
                element_id="field_phone",
                label="Phone Number",
                field_type="phone",
                current_value="bad",
                invalid=True,
                validation_message="Enter a valid phone number.",
            )
        ],
        buttons=[ObservedAction(element_id="button_continue", label="Save and Continue", disabled=True)],
    )

    actions = fallback_proposed_actions(
        observation,
        {"phone": "0400000000"},
        [],
    )

    assert [action.action_type for action in actions] == ["fill_text"]
    assert actions[0].element_id == "field_phone"
    assert actions[0].value == "0400000000"


def test_fallback_fills_email_from_external_accounts_default() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        fields=[ObservedField(element_id="field_1", label="Email address", field_type="email")],
    )

    action = fallback_proposed_action(
        observation,
        {"external_accounts": {"default": {"email": "nitin@example.com"}}},
        [],
    )

    assert action.action_type == "fill_text"
    assert action.element_id == "field_1"
    assert action.value == "nitin@example.com"
    assert action.source == "profile"


def test_fallback_fills_password_from_external_accounts_default() -> None:
    observation = PageObservation(
        url="https://ats.example/login",
        fields=[ObservedField(element_id="field_password", label="Password", field_type="text")],
    )

    action = fallback_proposed_action(
        observation,
        {"external_accounts": {"default": {"password": "Sunshine@123#5"}}},
        [],
    )

    assert action.action_type == "fill_text"
    assert action.element_id == "field_password"
    assert action.value == "Sunshine@123#5"
    assert action.source == "profile"


def test_fallback_answers_prior_employment_question_from_profile_employer_history() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        fields=[ObservedField(element_id="field_svha", label="Have you previously worked at St Vincent's Health Australia (SVHA)?", field_type="radio")],
    )

    action = fallback_proposed_action(
        observation,
        {"employment_history": {"employers": ["AWS", "Department for Education, South Australia"]}},
        [],
    )

    assert action.action_type == "set_radio"
    assert action.element_id == "field_svha"
    assert action.value == "No"
    assert action.source == "profile"


def test_fallback_fills_salutation_from_external_accounts_default() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        fields=[ObservedField(element_id="field_salutation", label="What salutation should be selected?", field_type="select")],
    )

    action = fallback_proposed_action(
        observation,
        {"external_accounts": {"default": {"salutation": "Mr"}}},
        [],
    )

    assert action.action_type == "select_option"
    assert action.element_id == "field_salutation"
    assert action.value == "Mr"
    assert action.source == "profile"


def test_fallback_fills_home_address_from_canonical_profile() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        fields=[ObservedField(element_id="field_address", label="Home address", field_type="text", required=True)],
    )

    action = fallback_proposed_action(
        observation,
        {"address": {"street": "123 Example Street", "suburb": "Sampleville", "postcode": "2000"}},
        [],
    )

    assert action.action_type == "fill_text"
    assert action.element_id == "field_address"
    assert action.value == "123 Example Street"
    assert action.source == "profile"


def test_fallback_uploads_resume_from_profile_facts() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        fields=[ObservedField(element_id="field_resume", label="Resume", field_type="file", required=True)],
    )

    action = fallback_proposed_action(
        observation,
        {"resume_path": "C:/workspace/profile/example_resume.docx"},
        [],
    )

    assert action.action_type == "upload_file"
    assert action.element_id == "field_resume"
    assert action.value == "C:/workspace/profile/example_resume.docx"
    assert action.source == "profile"


def test_fallback_asks_user_on_job_search_page() -> None:
    observation = PageObservation(
        url="https://hk.jobsdb.com/",
        title="Jobsdb",
        visible_text="Perform a job search What Suggestions will appear below the field as you type",
        fields=[ObservedField(element_id="field_1", label="What", field_type="text")],
    )

    action = fallback_proposed_action(observation, {"headline": "AI Engineer"}, [])

    assert action.action_type == "ask_user"
    assert "job-search page" in (action.question or "")


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


def test_fallback_clicks_apply_on_sparse_unknown_page() -> None:
    observation = PageObservation(
        url="https://ats.example/jobs/123",
        page_type="unknown",
        buttons=[
            ObservedAction(element_id="button_signin", label="Sign In", kind="submit"),
            ObservedAction(element_id="button_home", label="Home", kind="submit"),
            ObservedAction(element_id="button_apply", label="Apply", kind="button"),
            ObservedAction(element_id="button_readmore", label="Read More", kind="button"),
        ],
    )

    action = fallback_proposed_action(observation, {}, [])

    assert action.action_type == "click"
    assert action.element_id == "button_apply"
    assert action.source == "page"


def test_fallback_clicks_create_account_link_when_it_is_the_best_cta() -> None:
    observation = PageObservation(
        url="https://ats.example/jobs/123/apply",
        page_type="unknown",
        links=[
            ObservedAction(element_id="link_help", label="Forgot your password?", kind="link"),
            ObservedAction(element_id="link_create", label="Create Account", kind="link"),
        ],
    )

    action = fallback_proposed_action(observation, {}, [])

    assert action.action_type == "click"
    assert action.element_id == "link_create"
    assert action.source == "page"


def test_fallback_treats_apply_now_as_navigation_on_non_submit_page() -> None:
    observation = PageObservation(
        url="https://ats.example/jobs/123",
        page_type="unknown",
        buttons=[ObservedAction(element_id="button_apply_now", label="Apply Now", kind="button")],
    )

    action = fallback_proposed_action(observation, {}, [])

    assert action.action_type == "click"
    assert action.element_id == "button_apply_now"


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


def test_batch_prompt_asks_for_multiple_safe_field_actions() -> None:
    observation = PageObservation(
        url="https://ats.example/apply",
        title="Apply",
        fields=[
            ObservedField(element_id="field_1", label="First name", field_type="text"),
            ObservedField(element_id="field_2", label="Last name", field_type="text"),
        ],
    )

    system, user = build_external_apply_batch_planner_messages(
        observation=observation,
        profile_facts={"first_name": "Nitin", "last_name": "Datta"},
        approved_memory=[],
        recent_actions=[],
    )

    assert "propose a page plan" in system
    assert "\"actions\"" in system
    assert "field_1" in user
