from datetime import UTC, datetime
from typing import Any

from app.services.external_apply_recovery import (
    candidate_resume_urls,
    is_session_lost_browser_error,
    recover_external_session,
)
from app.state.apply import ApplyState, StepInfo
from app.state.external_apply import ExternalApplyState, PageObservation
from app.state.prepare import Application
from app.tools.browser_client import BrowserToolError


class DummyToolClient:
    pass


class FakeAppRepo:
    def __init__(self, application: Application | None) -> None:
        self.application = application

    async def get(self, _app_id: str) -> Application | None:
        return self.application


class FakeSessionRepo:
    def __init__(self) -> None:
        self.created: list[dict[str, str]] = []

    async def create(self, *, provider: str, session_key: str, application_id: str) -> None:
        self.created.append(
            {
                "provider": provider,
                "session_key": session_key,
                "application_id": application_id,
            }
        )


def _application() -> Application:
    now = datetime.now(UTC)
    return Application(
        id="app-1",
        job_id="job-1",
        source_provider="seek",
        source_url="https://www.seek.com.au/job/123",
        target_portal="workday",
        target_application_url="https://example.workday.com/apply/start",
        state="applying",
        created_at=now,
        updated_at=now,
    )


def test_candidate_resume_urls_prefers_current_external_url() -> None:
    application = _application()
    state = ApplyState(
        application_id="app-1",
        workflow_run_id="run-1",
        session_key="session-old",
        current_step=StepInfo(
            page_url="https://example.workday.com/apply/current",
            page_type="external_redirect",
            is_external_portal=True,
            fields=[],
            visible_actions=[],
        ),
        external_start_url="https://example.workday.com/apply/start",
        external_apply=ExternalApplyState(
            application_id="app-1",
            current_url="https://example.workday.com/apply/profile",
        ),
    )

    assert candidate_resume_urls(state, application) == [
        "https://example.workday.com/apply/profile",
        "https://example.workday.com/apply/current",
        "https://example.workday.com/apply/start",
    ]


def test_is_session_lost_browser_error_uses_error_type() -> None:
    exc = BrowserToolError("observe failed", error_type="session_not_found")

    assert is_session_lost_browser_error(exc) is True


async def test_recover_external_session_reopens_current_external_url() -> None:
    state = ApplyState(
        application_id="app-1",
        workflow_run_id="run-1",
        session_key="session-old",
        current_step=StepInfo(
            page_url="https://example.workday.com/apply/current",
            page_type="external_redirect",
            is_external_portal=True,
            fields=[],
            visible_actions=[],
        ),
        external_apply=ExternalApplyState(
            application_id="app-1",
            current_url="https://example.workday.com/apply/profile",
        ),
    )
    app_repo = FakeAppRepo(_application())
    session_repo = FakeSessionRepo()
    opened_urls: list[str] = []

    async def launch(_client: Any, provider: str) -> str:
        assert provider == "seek"
        return "session-new"

    async def open_page(_client: Any, session_key: str, url: str) -> str:
        assert session_key == "session-new"
        opened_urls.append(url)
        return url

    async def observe(_client: Any, session_key: str) -> PageObservation:
        assert session_key == "session-new"
        return PageObservation(url="https://example.workday.com/apply/profile", page_type="form")

    async def start_apply_call(_client: Any, _session_key: str, _provider: str, _source_url: str) -> dict[str, Any]:
        raise AssertionError("start_apply should not be needed when a resume URL works")

    recovery = await recover_external_session(
        DummyToolClient(),  # type: ignore[arg-type]
        state=state,
        app_repo=app_repo,
        session_repo=session_repo,
        launch_fn=launch,
        open_url_fn=open_page,
        observe_fn=observe,
        start_apply_fn=start_apply_call,
    )

    assert recovery is not None
    assert recovery.session_key == "session-new"
    assert recovery.observation.page_type == "form"
    assert opened_urls == ["https://example.workday.com/apply/profile"]
    assert session_repo.created == [
        {
            "provider": "seek",
            "session_key": "session-new",
            "application_id": "app-1",
        }
    ]


async def test_recover_external_session_falls_back_to_start_apply() -> None:
    state = ApplyState(
        application_id="app-1",
        workflow_run_id="run-1",
        session_key="session-old",
    )
    app_repo = FakeAppRepo(_application())
    session_repo = FakeSessionRepo()
    start_apply_calls: list[tuple[str, str, str]] = []

    async def launch(_client: Any, _provider: str) -> str:
        return "session-new"

    async def open_page(_client: Any, _session_key: str, url: str) -> str:
        raise BrowserToolError(f"could not open {url}")

    async def observe(_client: Any, session_key: str) -> PageObservation:
        assert session_key == "session-new"
        return PageObservation(url="https://example.workday.com/apply/login", page_type="login")

    async def start_apply_call(_client: Any, session_key: str, provider: str, source_url: str) -> dict[str, Any]:
        start_apply_calls.append((session_key, provider, source_url))
        return {"is_external_portal": True, "portal_type": "workday"}

    recovery = await recover_external_session(
        DummyToolClient(),  # type: ignore[arg-type]
        state=state,
        app_repo=app_repo,
        session_repo=session_repo,
        launch_fn=launch,
        open_url_fn=open_page,
        observe_fn=observe,
        start_apply_fn=start_apply_call,
    )

    assert recovery is not None
    assert recovery.observation.page_type == "login"
    assert start_apply_calls == [("session-new", "seek", "https://www.seek.com.au/job/123")]
