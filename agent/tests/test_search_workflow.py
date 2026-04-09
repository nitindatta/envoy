import httpx
import respx

from app.persistence.sqlite.connection import Database
from app.persistence.sqlite.jobs import SqliteJobRepository
from app.settings import Settings
from app.tools.client import ToolClient
from app.workflows.search import run_search


def _client() -> ToolClient:
    settings = Settings(internal_auth_secret="test-secret")  # type: ignore[call-arg]
    return ToolClient(
        settings,
        client=httpx.AsyncClient(
            base_url=settings.tools_base_url,
            headers={"X-Internal-Auth": settings.internal_auth_secret},
        ),
    )


@respx.mock
async def test_run_search_persists_unblocked_jobs() -> None:
    respx.post("http://127.0.0.1:4320/tools/providers/seek/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "status": "ok",
                "data": {
                    "jobs": [
                        {
                            "provider_job_id": "1",
                            "title": "Senior Python Engineer",
                            "company": "Acme",
                            "location": "Adelaide",
                            "url": "https://www.seek.com.au/job/1",
                        },
                        {
                            "provider_job_id": "2",
                            "title": "Software Engineering Intern",
                            "company": "Acme",
                            "location": "Adelaide",
                            "url": "https://www.seek.com.au/job/2",
                        },
                    ]
                },
            },
        )
    )
    db = await Database.in_memory()
    repo = SqliteJobRepository(db.connection)
    state = await run_search(
        _client(), repo, keywords="python", location=None, max_pages=1
    )
    assert len(state.persisted_job_ids) == 1
    assert len(state.blocked) == 1
    assert state.blocked[0].rule == "title_keyword"
    persisted = await repo.list_by_provider("seek")
    assert len(persisted) == 1
    assert persisted[0].title == "Senior Python Engineer"
