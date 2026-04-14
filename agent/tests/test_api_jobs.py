import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings
from app.tools.client import ToolClient


@pytest.fixture()
async def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("INTERNAL_AUTH_SECRET", "test-secret")
    monkeypatch.setenv("SQLITE_PATH", ":memory:")
    # Reset cached settings so the env vars are picked up.
    import app.settings as settings_module

    settings_module._settings = None

    app_instance = create_app()
    settings: Settings = app_instance.state.settings
    tool_client = ToolClient(
        settings,
        client=httpx.AsyncClient(
            base_url=settings.tools_base_url,
            headers={"X-Internal-Auth": settings.internal_auth_secret},
        ),
    )
    # Stash so lifespan (which creates its own ToolClient) is replaced after startup.
    app_instance.state._test_tool_client = tool_client

    with TestClient(app_instance) as tc:
        # Replace the tool client with our mocked one after lifespan wired the real one.
        app_instance.state.tool_client = tool_client
        yield tc

    await tool_client.aclose()
    settings_module._settings = None


async def test_list_jobs_empty(client: TestClient) -> None:
    response = client.get("/api/jobs")
    assert response.status_code == 200
    assert response.json() == {"jobs": []}


@respx.mock
async def test_search_then_list(client: TestClient) -> None:
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
    response = client.post(
        "/api/workflows/search",
        json={"provider": "seek", "keywords": "python"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["persisted"] == 1
    assert body["blocked"] == 0

    listing = client.get("/api/jobs")
    assert listing.status_code == 200
    jobs = listing.json()["jobs"]
    assert len(jobs) == 1
    assert jobs[0]["title"] == "Python Engineer"
