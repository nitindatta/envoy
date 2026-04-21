"""Typed wrappers for the tools/ browser routes.

All functions take a ToolClient and return typed results.
Raises ToolServiceError on transport failure.
Raises BrowserToolError on tool-level errors (status="error").
Drift is returned as-is so callers can escalate.
"""

from __future__ import annotations

import logging

from app.state.apply import StepInfo
from app.state.external_apply import ActionResult, PageObservation, ProposedAction
from app.tools.client import ToolClient, ToolServiceError

log = logging.getLogger("browser_client")


class BrowserToolError(Exception):
    """Raised when tools/ returns status='error' for a browser operation."""


def _require_ok(env, operation: str) -> dict:
    """Unwrap envelope.data or raise BrowserToolError."""
    if env.status == "error":
        raise BrowserToolError(f"{operation} failed: {env.error}")
    if env.data is None:
        raise BrowserToolError(f"{operation} returned no data")
    return env.data  # type: ignore[return-value]


async def launch_session(client: ToolClient, provider: str) -> str:
    """Mint a new browser session. Returns session_key."""
    log.debug("[launch_session] provider=%s", provider)
    env = await client.call("/tools/browser/launch_session", {"provider": provider})
    data = _require_ok(env, "launch_session")
    log.info("[launch_session] session_key=%s", data["session_key"])
    return data["session_key"]


async def open_url(client: ToolClient, session_key: str, url: str) -> str:
    """Navigate to url. Returns final page_url."""
    log.debug("[open_url] session=%s url=%s", session_key, url)
    env = await client.call(
        "/tools/browser/open_url", {"session_key": session_key, "url": url}
    )
    data = _require_ok(env, "open_url")
    log.debug("[open_url] final_url=%s", data["page_url"])
    return data["page_url"]


async def inspect_apply_step(client: ToolClient, session_key: str):
    """Inspect current page. Returns (StepInfo, envelope) — envelope may be drift."""
    log.debug("[inspect_apply_step] session=%s", session_key)
    env = await client.call(
        "/tools/browser/inspect_apply_step", {"session_key": session_key}
    )
    if env.status == "drift":
        log.warning("[inspect_apply_step] drift: %s", env.status)
        return None, env
    data = _require_ok(env, "inspect_apply_step")
    step = StepInfo.model_validate(data)
    log.debug("[inspect_apply_step] page_type=%s fields=%d", step.page_type, len(step.fields))
    return step, env


async def observe_external_apply(client: ToolClient, session_key: str) -> PageObservation:
    """Observe the current page for the external apply harness."""
    log.debug("[observe_external_apply] session=%s", session_key)
    env = await client.call(
        "/tools/browser/observe_external_apply", {"session_key": session_key}
    )
    data = _require_ok(env, "observe_external_apply")
    observation = PageObservation.model_validate(data)
    log.debug(
        "[observe_external_apply] page_type=%s fields=%d buttons=%d",
        observation.page_type,
        len(observation.fields),
        len(observation.buttons),
    )
    return observation


async def execute_external_apply_action(
    client: ToolClient,
    session_key: str,
    action: ProposedAction,
) -> ActionResult:
    """Execute one narrow browser action proposed by the external apply harness."""
    browser_actions = {
        "fill_text",
        "select_option",
        "set_checkbox",
        "set_radio",
        "upload_file",
        "click",
    }
    if action.action_type not in browser_actions:
        raise BrowserToolError(f"action_type {action.action_type!r} is not browser-executable")
    if not action.element_id:
        raise BrowserToolError(f"action_type {action.action_type!r} requires element_id")

    log.info(
        "[execute_external_apply_action] session=%s action=%s element=%s",
        session_key,
        action.action_type,
        action.element_id,
    )
    env = await client.call(
        "/tools/browser/execute_external_apply_action",
        {
            "session_key": session_key,
            "action": action.model_dump(
                mode="json",
                include={"action_type", "element_id", "value"},
                exclude_none=True,
            ),
        },
    )
    data = _require_ok(env, "execute_external_apply_action")
    result = ActionResult.model_validate(data)
    log.debug(
        "[execute_external_apply_action] ok=%s navigated=%s errors=%d",
        result.ok,
        result.navigated,
        len(result.errors),
    )
    return result


async def fill_and_continue(
    client: ToolClient,
    session_key: str,
    fields: dict[str, str],
    action_label: str = "Continue",
):
    """Fill fields + click action + inspect next step. Returns (StepInfo | None, envelope)."""
    # Route expects [{id, value}] array format
    fields_array = [{"id": k, "value": v} for k, v in fields.items()]
    log.info("[fill_and_continue] session=%s fields=%d action=%r", session_key, len(fields_array), action_label)
    log.debug("[fill_and_continue] field_ids=%s", [f["id"] for f in fields_array])
    env = await client.call(
        "/tools/apply/fill_and_continue",
        {
            "session_key": session_key,
            "fields": fields_array,
            "action_label": action_label,
        },
    )
    if env.status in ("drift", "needs_human", "error"):
        log.warning("[fill_and_continue] status=%s error=%s", env.status, env.error)
        return None, env
    data = env.data or {}
    step_data = data.get("new_page_state")  # route returns new_page_state, not next_step
    step = StepInfo.model_validate(step_data) if step_data else None
    if step:
        log.debug("[fill_and_continue] next page_type=%s fields=%d", step.page_type, len(step.fields))
    return step, env


async def click_action(
    client: ToolClient, session_key: str, action_label: str
) -> None:
    """Click a visible action button (no fill)."""
    log.debug("[click_action] session=%s action=%r", session_key, action_label)
    env = await client.call(
        "/tools/browser/click_action",
        {"session_key": session_key, "action_label": action_label},
    )
    _require_ok(env, "click_action")


async def close_session(client: ToolClient, session_key: str) -> None:
    """Close browser session and release resources."""
    log.debug("[close_session] session=%s", session_key)
    env = await client.call(
        "/tools/browser/close_session", {"session_key": session_key}
    )
    if env.status == "error":
        log.warning("[close_session] cleanup error (ignored): %s", env.error)


class NeedsHumanError(Exception):
    """Raised when tools/ returns status='needs_human' (e.g. auth required)."""
    def __init__(self, reason: str, login_url: str) -> None:
        super().__init__(reason)
        self.reason = reason
        self.login_url = login_url


async def start_apply(
    client: ToolClient, session_key: str, provider: str, job_url: str
) -> dict:
    """Navigate to job page, click Apply, detect external redirect.

    Returns dict with keys: apply_url, is_external_portal, portal_type.
    Raises NeedsHumanError if auth is required.
    Raises BrowserToolError on other errors.
    """
    log.info("[start_apply] session=%s provider=%s url=%s", session_key, provider, job_url)
    env = await client.call(
        "/tools/providers/start_apply",
        {"session_key": session_key, "provider": provider, "job_url": job_url},
    )
    if env.status == "needs_human":
        data = env.data or {}
        raise NeedsHumanError(
            reason=data.get("reason", "auth_required"),
            login_url=data.get("login_url", ""),
        )
    data = _require_ok(env, "start_apply")
    log.info("[start_apply] result: is_external=%s portal_type=%s",
             data.get("is_external_portal"), data.get("portal_type"))
    return data
