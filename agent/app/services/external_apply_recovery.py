"""Recovery helpers for external apply browser sessions."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Protocol

from app.state.apply import ApplyState
from app.state.external_apply import PageObservation
from app.tools.browser_client import (
    BrowserToolError,
    NeedsHumanError,
    close_session,
    launch_session,
    observe_external_apply,
    open_url,
    start_apply,
)
from app.tools.client import ToolClient, ToolServiceError

log = logging.getLogger("external_apply_recovery")


class ApplicationRepository(Protocol):
    async def get(self, app_id: str) -> Any | None:
        ...


class BrowserSessionRepository(Protocol):
    async def create(self, *, provider: str, session_key: str, application_id: str) -> Any:
        ...


LaunchSessionFn = Callable[[ToolClient, str], Awaitable[str]]
OpenUrlFn = Callable[[ToolClient, str, str], Awaitable[str]]
ObserveFn = Callable[[ToolClient, str], Awaitable[PageObservation]]
StartApplyFn = Callable[[ToolClient, str, str, str], Awaitable[dict[str, Any]]]
CloseSessionFn = Callable[[ToolClient, str], Awaitable[None]]


@dataclass(slots=True)
class RecoveredExternalSession:
    session_key: str
    observation: PageObservation


def is_session_lost_browser_error(exc: Exception) -> bool:
    if isinstance(exc, BrowserToolError) and exc.error_type == "session_not_found":
        return True
    return "session_not_found" in str(exc).lower()


def candidate_resume_urls(state: ApplyState, application: Any) -> list[str]:
    candidates = [
        state.external_apply.current_url if state.external_apply is not None else None,
        state.current_step.page_url if state.current_step is not None else None,
        getattr(application, "target_application_url", None),
        state.external_start_url,
    ]
    seen: set[str] = set()
    ordered: list[str] = []
    for candidate in candidates:
        if not isinstance(candidate, str):
            continue
        url = candidate.strip()
        if not url or url in seen:
            continue
        seen.add(url)
        ordered.append(url)
    return ordered


async def recover_external_session(
    tool_client: ToolClient,
    *,
    state: ApplyState,
    app_repo: ApplicationRepository,
    session_repo: BrowserSessionRepository,
    launch_fn: LaunchSessionFn = launch_session,
    open_url_fn: OpenUrlFn = open_url,
    observe_fn: ObserveFn = observe_external_apply,
    start_apply_fn: StartApplyFn = start_apply,
    close_session_fn: CloseSessionFn = close_session,
) -> RecoveredExternalSession | None:
    application = await app_repo.get(state.application_id)
    if application is None:
        log.warning("[recover_external] application not found: %s", state.application_id)
        return None

    provider = getattr(application, "source_provider", None) or "seek"
    source_url = str(getattr(application, "source_url", "") or "").strip()

    try:
        session_key = await launch_fn(tool_client, provider)
        await session_repo.create(
            provider=provider,
            session_key=session_key,
            application_id=state.application_id,
        )
    except (BrowserToolError, ToolServiceError) as exc:
        log.warning("[recover_external] launch failed: %s", exc)
        return None

    async def _observe_after_open() -> RecoveredExternalSession | None:
        try:
            observation = await observe_fn(tool_client, session_key)
            return RecoveredExternalSession(session_key=session_key, observation=observation)
        except (BrowserToolError, ToolServiceError) as exc:
            log.warning("[recover_external] observe failed after open: %s", exc)
            return None

    for url in candidate_resume_urls(state, application):
        try:
            final_url = await open_url_fn(tool_client, session_key, url)
            log.info("[recover_external] opened resume url=%s final=%s", url, final_url)
        except (BrowserToolError, ToolServiceError) as exc:
            log.warning("[recover_external] open_url failed for %s: %s", url, exc)
            continue

        recovered = await _observe_after_open()
        if recovered is not None:
            return recovered

    if source_url:
        try:
            result = await start_apply_fn(tool_client, session_key, provider, source_url)
            if result.get("is_external_portal"):
                recovered = await _observe_after_open()
                if recovered is not None:
                    return recovered
        except NeedsHumanError as exc:
            log.warning("[recover_external] start_apply needs human auth: %s", exc.reason)
        except (BrowserToolError, ToolServiceError) as exc:
            log.warning("[recover_external] start_apply failed: %s", exc)

    try:
        await close_session_fn(tool_client, session_key)
    except Exception:
        pass
    return None
