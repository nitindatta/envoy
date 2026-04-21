"""LLM planner for Envoy's external apply harness.

The planner proposes exactly one next action from the current page observation.
It never executes browser actions; the harness policy and Playwright tools do
that later.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from openai import AsyncOpenAI

from app.settings import Settings
from app.state.external_apply import ActionTrace, PageObservation, ProposedAction

log = logging.getLogger("external_apply_ai")

_BROWSER_ACTIONS = {
    "fill_text",
    "select_option",
    "set_checkbox",
    "set_radio",
    "upload_file",
    "click",
}
_STOP_ACTIONS = {"ask_user", "stop_ready_to_submit", "stop_failed"}
_ALL_ACTIONS = _BROWSER_ACTIONS | _STOP_ACTIONS
_SENSITIVE_WORDS = {
    "salary",
    "compensation",
    "visa",
    "sponsorship",
    "work rights",
    "right to work",
    "disability",
    "veteran",
    "gender",
    "ethnicity",
    "criminal",
    "background check",
    "declaration",
}


def _build_client(settings: Settings) -> AsyncOpenAI:
    return AsyncOpenAI(
        base_url=settings.openai_base_url,
        api_key=settings.openai_api_key,
    )


async def propose_external_apply_action(
    settings: Settings,
    *,
    observation: PageObservation,
    profile_facts: dict[str, Any] | None = None,
    approved_memory: list[dict[str, Any]] | None = None,
    recent_actions: list[ActionTrace] | None = None,
) -> ProposedAction:
    """Return one proposed action for the current external apply page."""

    client = _build_client(settings)
    system, user = build_external_apply_planner_messages(
        observation=observation,
        profile_facts=profile_facts or {},
        approved_memory=approved_memory or [],
        recent_actions=recent_actions or [],
    )
    try:
        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.1,
            max_tokens=360,
        )
        raw = response.choices[0].message.content or "{}"
        return parse_planner_response(raw, observation)
    except Exception as exc:  # pragma: no cover - network/runtime dependent
        log.warning("[propose_external_apply_action] falling back: %s", exc)
        return fallback_proposed_action(observation, profile_facts or {}, approved_memory or [])


def build_external_apply_planner_messages(
    *,
    observation: PageObservation,
    profile_facts: dict[str, Any],
    approved_memory: list[dict[str, Any]],
    recent_actions: list[ActionTrace],
) -> tuple[str, str]:
    system = (
        "You are Envoy's external apply planning agent. "
        "You do not operate the browser. You propose exactly one next action as JSON. "
        "Use only observed element_id values from the page. "
        "Prefer safe, reversible actions using approved profile or memory facts. "
        "If the page asks for salary, visa/work-rights ambiguity, diversity, legal declarations, "
        "background checks, captcha, or anything uncertain, use ask_user. "
        "Never submit the final application; use stop_ready_to_submit when a final submit/apply button is reached. "
        "Return ONLY valid JSON with this shape: "
        "{\"action_type\":\"fill_text|select_option|set_checkbox|set_radio|upload_file|click|ask_user|stop_ready_to_submit|stop_failed\","
        "\"element_id\":\"... or null\",\"value\":\"... or null\",\"question\":\"... or null\","
        "\"confidence\":0.0,\"risk\":\"low|medium|high\",\"reason\":\"...\","
        "\"source\":\"profile|memory|user|inferred|page|none\"}."
    )
    payload = {
        "page": _observation_for_prompt(observation),
        "profile_facts": profile_facts,
        "approved_memory": approved_memory[:12],
        "recent_actions": [_trace_for_prompt(trace) for trace in recent_actions[-6:]],
        "allowed_actions": sorted(_ALL_ACTIONS),
    }
    user = json.dumps(payload, ensure_ascii=False, indent=2)
    return system, user


def parse_planner_response(raw: str, observation: PageObservation) -> ProposedAction:
    parsed = _parse_json_object(raw)
    if not isinstance(parsed, dict):
        raise ValueError("planner response was not a JSON object")

    action_type = str(parsed.get("action_type", "")).strip()
    if action_type not in _ALL_ACTIONS:
        raise ValueError(f"unsupported action_type: {action_type}")

    element_id = _optional_string(parsed.get("element_id"))
    if action_type in _BROWSER_ACTIONS:
        if not element_id:
            raise ValueError(f"{action_type} requires element_id")
        observed_ids = _observed_element_ids(observation)
        if element_id not in observed_ids:
            raise ValueError(f"unknown element_id: {element_id}")

    proposed = ProposedAction(
        action_type=action_type,  # type: ignore[arg-type]
        element_id=element_id,
        value=_optional_string(parsed.get("value")),
        question=_optional_string(parsed.get("question")),
        confidence=_coerce_confidence(parsed.get("confidence")),
        risk=_coerce_risk(parsed.get("risk")),
        reason=str(parsed.get("reason", "")).strip() or "Planner proposed the next action.",
        source=_coerce_source(parsed.get("source")),
    )
    return proposed


def fallback_proposed_action(
    observation: PageObservation,
    profile_facts: dict[str, Any],
    approved_memory: list[dict[str, Any]],
) -> ProposedAction:
    """Conservative deterministic fallback when the LLM fails or is unavailable."""

    if observation.page_type == "captcha":
        return ProposedAction(
            action_type="ask_user",
            question="This page appears to contain a captcha. Please complete it manually, then continue.",
            confidence=0.95,
            risk="high",
            reason="Captcha pages require human action.",
            source="page",
        )

    if observation.page_type == "confirmation":
        return ProposedAction(
            action_type="stop_failed",
            confidence=0.8,
            risk="low",
            reason="The page looks like an application confirmation page.",
            source="page",
        )

    for field in observation.fields:
        if field.disabled or field.current_value:
            continue
        label = field.label.lower()
        if _is_sensitive(label):
            return ProposedAction(
                action_type="ask_user",
                element_id=field.element_id,
                question=f"How should I answer: {field.label}?",
                confidence=0.9,
                risk="medium",
                reason="This field may require user judgement or confirmation.",
                source="page",
            )
        value, source = _lookup_safe_value(field.label, profile_facts, approved_memory)
        if value:
            return _action_for_field(field.element_id, field.field_type, value, source)

    for button in observation.buttons:
        label = button.label.lower()
        if button.disabled:
            continue
        if re.search(r"\b(submit|apply now|send application)\b", label):
            return ProposedAction(
                action_type="stop_ready_to_submit",
                element_id=button.element_id,
                confidence=0.9,
                risk="high",
                reason="Final submission must go through the portal approval gate.",
                source="page",
            )
        if re.search(r"\b(continue|next|save and continue)\b", label):
            return ProposedAction(
                action_type="click",
                element_id=button.element_id,
                confidence=0.65,
                risk="medium",
                reason="No safe fillable fields were found; this looks like a navigation button.",
                source="page",
            )

    return ProposedAction(
        action_type="ask_user",
        question="I could not confidently determine the next safe action on this page. What should I do next?",
        confidence=0.75,
        risk="medium",
        reason="No safe deterministic action was available.",
        source="page",
    )


def _observation_for_prompt(observation: PageObservation) -> dict[str, Any]:
    return {
        "url": observation.url,
        "title": observation.title,
        "page_type": observation.page_type,
        "visible_text_excerpt": observation.visible_text[:2500],
        "fields": [field.model_dump() for field in observation.fields[:30]],
        "buttons": [button.model_dump() for button in observation.buttons[:20]],
        "links": [link.model_dump() for link in observation.links[:12]],
        "errors": observation.errors[:10],
    }


def _trace_for_prompt(trace: ActionTrace) -> dict[str, Any]:
    return {
        "action": trace.proposed_action.model_dump(),
        "policy_decision": trace.policy_decision,
        "result": trace.result.model_dump() if trace.result else None,
    }


def _parse_json_object(raw: str) -> Any:
    text = raw.strip()
    text = re.sub(r"^```(?:json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()
    return json.loads(text)


def _optional_string(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _coerce_confidence(value: object) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        confidence = 0.0
    return max(0.0, min(1.0, confidence))


def _coerce_risk(value: object) -> str:
    risk = str(value or "").strip().lower()
    return risk if risk in {"low", "medium", "high"} else "medium"


def _coerce_source(value: object) -> str:
    source = str(value or "").strip().lower()
    allowed = {"profile", "memory", "user", "inferred", "page", "none"}
    return source if source in allowed else "none"


def _observed_element_ids(observation: PageObservation) -> set[str]:
    return {
        *(field.element_id for field in observation.fields),
        *(button.element_id for button in observation.buttons),
        *(link.element_id for link in observation.links),
    }


def _is_sensitive(label: str) -> bool:
    return any(word in label for word in _SENSITIVE_WORDS)


def _lookup_safe_value(
    label: str,
    profile_facts: dict[str, Any],
    approved_memory: list[dict[str, Any]],
) -> tuple[str | None, str]:
    label_lower = label.lower()
    mappings = [
        (("first name",), "first_name"),
        (("last name",), "last_name"),
        (("full name", "name"), "name"),
        (("email", "e-mail"), "email"),
        (("phone", "mobile", "telephone"), "phone"),
        (("city",), "city"),
        (("location", "suburb"), "location"),
        (("linkedin",), "linkedin_url"),
    ]
    for keys, profile_key in mappings:
        if any(key in label_lower for key in keys):
            value = profile_facts.get(profile_key)
            if value:
                return str(value), "profile"

    for item in approved_memory:
        question = str(item.get("question", item.get("label", ""))).lower()
        if question and (question in label_lower or label_lower in question):
            answer = item.get("answer") or item.get("value")
            if answer:
                return str(answer), "memory"
    return None, "none"


def _action_for_field(
    element_id: str,
    field_type: str,
    value: str,
    source: str,
) -> ProposedAction:
    if field_type == "select":
        action_type = "select_option"
    elif field_type == "checkbox":
        action_type = "set_checkbox"
    elif field_type == "radio":
        action_type = "set_radio"
    elif field_type == "file":
        action_type = "upload_file"
    else:
        action_type = "fill_text"
    return ProposedAction(
        action_type=action_type,  # type: ignore[arg-type]
        element_id=element_id,
        value=value,
        confidence=0.82,
        risk="low",
        reason="Deterministic fallback matched a safe field to approved profile or memory data.",
        source=source,  # type: ignore[arg-type]
    )
