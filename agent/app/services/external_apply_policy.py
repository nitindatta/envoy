"""Deterministic policy gate for external apply actions."""

from __future__ import annotations

import re

from app.state.external_apply import PageObservation, PolicyDecision, ProposedAction

_EXECUTABLE_ACTIONS = {
    "fill_text",
    "select_option",
    "set_checkbox",
    "set_radio",
    "upload_file",
    "click",
}
_SENSITIVE_PATTERNS = [
    ("salary", r"\bsalary\b"),
    ("compensation", r"\bcompensation\b"),
    ("visa", r"\bvisa\b"),
    ("sponsorship", r"\bsponsor"),
    ("right_to_work", r"\bright to work\b"),
    ("work_rights", r"\bwork rights\b"),
    ("disability", r"\bdisability\b"),
    ("veteran", r"\bveteran\b"),
    ("gender", r"\bgender\b"),
    ("ethnicity", r"\bethnicity\b"),
    ("criminal", r"\bcriminal\b"),
    ("background_check", r"\bbackground check\b"),
    ("declaration", r"\bdeclaration\b"),
]


def validate_external_apply_action(
    *,
    observation: PageObservation,
    proposed_action: ProposedAction,
) -> PolicyDecision:
    """Return allowed/paused/rejected for a planned action.

    The policy is intentionally conservative. It never tries to improve the
    planner's action; it only gates whether the proposed action may proceed.
    """

    action_type = proposed_action.action_type

    if action_type == "ask_user":
        return PolicyDecision(
            decision="paused",
            reason=proposed_action.reason or "Planner requested user input.",
            pause_reason="needs_user_input",
            risk_flags=["user_input_required"],
        )

    if action_type == "stop_ready_to_submit":
        return PolicyDecision(
            decision="paused",
            reason="Final submit requires explicit user approval.",
            pause_reason="final_submit",
            risk_flags=["final_submit_gate"],
        )

    if action_type == "stop_failed":
        return PolicyDecision(
            decision="rejected",
            reason=proposed_action.reason or "Planner indicated the flow cannot continue safely.",
            risk_flags=["planner_stop_failed"],
        )

    if action_type not in _EXECUTABLE_ACTIONS:
        return PolicyDecision(
            decision="rejected",
            reason=f"Unsupported action type: {action_type}",
            risk_flags=["unsupported_action"],
        )

    if not proposed_action.element_id:
        return PolicyDecision(
            decision="rejected",
            reason=f"{action_type} requires an element_id.",
            risk_flags=["missing_element_id"],
        )

    target_text = _target_text(observation, proposed_action.element_id)
    if target_text is None:
        return PolicyDecision(
            decision="rejected",
            reason=f"Target element was not present in the latest observation: {proposed_action.element_id}",
            risk_flags=["unknown_element"],
        )

    if proposed_action.confidence < 0.85:
        return PolicyDecision(
            decision="paused",
            reason=f"Planner confidence {proposed_action.confidence:.2f} is below the auto-action threshold.",
            pause_reason="low_confidence",
            risk_flags=["low_confidence"],
        )

    if proposed_action.risk == "high":
        return PolicyDecision(
            decision="paused",
            reason="High-risk actions require user approval.",
            pause_reason="needs_approval",
            risk_flags=["high_risk"],
        )

    sensitive_hits = _sensitive_hits(target_text)
    if sensitive_hits:
        return PolicyDecision(
            decision="paused",
            reason="The target appears to ask for sensitive or judgement-based information.",
            pause_reason="sensitive",
            risk_flags=sensitive_hits,
        )

    if action_type in {"fill_text", "select_option", "set_checkbox", "set_radio", "upload_file"}:
        if proposed_action.source not in {"profile", "memory", "user"}:
            return PolicyDecision(
                decision="paused",
                reason="Auto-fill requires an approved profile, memory, or user-provided source.",
                pause_reason="needs_approval",
                risk_flags=["unapproved_value_source"],
            )
        if proposed_action.value is None or proposed_action.value == "":
            return PolicyDecision(
                decision="rejected",
                reason=f"{action_type} requires a non-empty value.",
                risk_flags=["missing_value"],
            )

    if action_type == "click":
        if _looks_like_submit(target_text):
            return PolicyDecision(
                decision="paused",
                reason="Click target looks like final submission.",
                pause_reason="final_submit",
                risk_flags=["final_submit_gate"],
            )
        if proposed_action.risk != "low":
            return PolicyDecision(
                decision="paused",
                reason="Medium-risk clicks require user approval.",
                pause_reason="needs_approval",
                risk_flags=["click_needs_approval"],
            )

    return PolicyDecision(
        decision="allowed",
        reason="Action passed deterministic policy checks.",
        risk_flags=[],
    )


def _target_text(observation: PageObservation, element_id: str) -> str | None:
    for field in observation.fields:
        if field.element_id == element_id:
            return " ".join([field.label, field.field_type, field.nearby_text])
    for button in observation.buttons:
        if button.element_id == element_id:
            return " ".join([button.label, button.kind, button.nearby_text])
    for link in observation.links:
        if link.element_id == element_id:
            return " ".join([link.label, link.kind, link.nearby_text])
    return None


def _sensitive_hits(text: str) -> list[str]:
    lowered = text.lower()
    return [
        label
        for label, pattern in _SENSITIVE_PATTERNS
        if re.search(pattern, lowered)
    ]


def _looks_like_submit(text: str) -> bool:
    return bool(re.search(r"\b(submit|send application|apply now|finish application)\b", text.lower()))
