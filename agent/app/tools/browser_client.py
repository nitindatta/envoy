"""Typed wrappers for the tools/ browser routes.

All functions take a ToolClient and return typed results.
Raises ToolServiceError on transport failure.
Raises BrowserToolError on tool-level errors (status="error").
Drift is returned as-is so callers can escalate.
"""

from __future__ import annotations

from app.state.apply import StepInfo
from app.tools.client import ToolClient, ToolServiceError


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
    env = await client.call("/tools/browser/launch_session", {"provider": provider})
    data = _require_ok(env, "launch_session")
    return data["session_key"]


async def open_url(client: ToolClient, session_key: str, url: str) -> str:
    """Navigate to url. Returns final page_url."""
    env = await client.call(
        "/tools/browser/open_url", {"session_key": session_key, "url": url}
    )
    data = _require_ok(env, "open_url")
    return data["page_url"]


async def inspect_apply_step(client: ToolClient, session_key: str):
    """Inspect current page. Returns (StepInfo, envelope) — envelope may be drift."""
    env = await client.call(
        "/tools/browser/inspect_apply_step", {"session_key": session_key}
    )
    if env.status in ("drift", "needs_human"):
        return None, env
    data = _require_ok(env, "inspect_apply_step")
    return StepInfo.model_validate(data), env


async def fill_and_continue(
    client: ToolClient,
    session_key: str,
    fields: dict[str, str],
    action_label: str = "Continue",
):
    """Fill fields + click action + inspect next step. Returns (StepInfo | None, envelope)."""
    # Route expects [{id, value}] array format
    fields_array = [{"id": k, "value": v} for k, v in fields.items()]
    env = await client.call(
        "/tools/apply/fill_and_continue",
        {
            "session_key": session_key,
            "fields": fields_array,
            "action_label": action_label,
        },
    )
    if env.status in ("drift", "needs_human", "error"):
        return None, env
    data = env.data or {}
    step_data = data.get("new_page_state")  # route returns new_page_state, not next_step
    step = StepInfo.model_validate(step_data) if step_data else None
    return step, env


async def click_action(
    client: ToolClient, session_key: str, action_label: str
) -> None:
    """Click a visible action button (no fill)."""
    env = await client.call(
        "/tools/browser/click_action",
        {"session_key": session_key, "action_label": action_label},
    )
    _require_ok(env, "click_action")


async def close_session(client: ToolClient, session_key: str) -> None:
    """Close browser session and release resources."""
    env = await client.call(
        "/tools/browser/close_session", {"session_key": session_key}
    )
    if env.status == "error":
        # Log but don't raise — cleanup should be best-effort
        pass


async def start_apply(
    client: ToolClient, session_key: str, provider: str, job_url: str
) -> dict:
    """Navigate to job page, click Apply, detect external redirect.

    Returns dict with keys: apply_url, is_external_portal, portal_type.
    """
    env = await client.call(
        "/tools/providers/start_apply",
        {"session_key": session_key, "provider": provider, "job_url": job_url},
    )
    data = _require_ok(env, "start_apply")
    return data
