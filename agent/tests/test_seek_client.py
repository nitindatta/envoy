import httpx
import pytest
import respx

from app.settings import Settings
from app.tools.client import ToolClient
from app.tools.seek import SeekDriftError, SeekToolError, search_seek


def _settings() -> Settings:
    return Settings(internal_auth_secret="test-secret")  # type: ignore[call-arg]


def _client() -> ToolClient:
    settings = _settings()
    return ToolClient(
        settings,
        client=httpx.AsyncClient(
            base_url=settings.tools_base_url,
            headers={"X-Internal-Auth": settings.internal_auth_secret},
        ),
    )


@respx.mock
async def test_search_seek_returns_jobs() -> None:
    respx.post("http://127.0.0.1:4320/tools/providers/seek/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "status": "ok",
                "data": {
                    "jobs": [
                        {
                            "provider_job_id": "1",
                            "title": "Python Engineer",
                            "company": "Acme",
                            "location": "Adelaide",
                            "url": "https://www.seek.com.au/job/1",
                        }
                    ]
                },
            },
        )
    )
    jobs = await search_seek(_client(), keywords="python")
    assert len(jobs) == 1
    assert jobs[0].title == "Python Engineer"


@respx.mock
async def test_search_seek_raises_on_drift() -> None:
    respx.post("http://127.0.0.1:4320/tools/providers/seek/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "status": "drift",
                "drift": {
                    "parser_id": "seek_listing_v1",
                    "expected": "10 cards",
                    "observed": "0 matches",
                },
            },
        )
    )
    with pytest.raises(SeekDriftError) as exc:
        await search_seek(_client(), keywords="python")
    assert exc.value.drift.parser_id == "seek_listing_v1"


@respx.mock
async def test_search_seek_raises_on_error() -> None:
    respx.post("http://127.0.0.1:4320/tools/providers/seek/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "status": "error",
                "error": {"type": "browser_unavailable", "message": "no chrome"},
            },
        )
    )
    with pytest.raises(SeekToolError) as exc:
        await search_seek(_client(), keywords="python")
    assert exc.value.error.type == "browser_unavailable"
