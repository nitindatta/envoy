import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.main import create_app
from app.persistence.sqlite.connection import Database
from app.persistence.sqlite.jobs import SqliteJobRepository
from app.settings import Settings
from app.tools.client import ToolClient


@pytest.fixture()
async def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("INTERNAL_AUTH_SECRET", "test-secret")
    # Reset cached settings so the env var is picked up.
    import app.settings as settings_module

    settings_module._settings = None

    app = create_app()
    settings: Settings = app.state.settings
    db = await Database.in_memory()
    app.state.database = db
    app.state.job_repository = SqliteJobRepository(db.connection)
    app.state.tool_client = ToolClient(
        settings,
        client=httpx.AsyncClient(
            base_url=settings.tools_base_url,
            headers={"X-Internal-Auth": settings.internal_auth_secret},
        ),
    )

    # Bypass lifespan (we wired state manually).
    with TestClient(app) as tc:
        yield tc

    await app.state.tool_client.aclose()
    await db.close()


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
