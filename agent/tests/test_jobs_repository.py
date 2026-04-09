import pytest

from app.persistence.sqlite.connection import Database
from app.persistence.sqlite.jobs import SqliteJobRepository


@pytest.fixture()
async def repo() -> SqliteJobRepository:
    db = await Database.in_memory()
    return SqliteJobRepository(db.connection)


async def test_upsert_inserts_new_job(repo: SqliteJobRepository) -> None:
    job_id = await repo.upsert(
        provider="seek",
        source_url="https://www.seek.com.au/job/12345",
        canonical_key="seek:12345",
        title="Senior Python Engineer",
        company="Acme",
        location="Adelaide",
        summary="Build cool stuff",
        payload={"raw": "ok"},
    )
    fetched = await repo.get(job_id)
    assert fetched is not None
    assert fetched.title == "Senior Python Engineer"
    assert fetched.payload == {"raw": "ok"}


async def test_upsert_updates_existing_job(repo: SqliteJobRepository) -> None:
    first = await repo.upsert(
        provider="seek",
        source_url="https://www.seek.com.au/job/12345",
        canonical_key="seek:12345",
        title="Old title",
        company="Acme",
        location=None,
        summary=None,
        payload={"v": 1},
    )
    second = await repo.upsert(
        provider="seek",
        source_url="https://www.seek.com.au/job/12345",
        canonical_key="seek:12345",
        title="New title",
        company="Acme",
        location="Adelaide",
        summary="Updated",
        payload={"v": 2},
    )
    assert first == second
    fetched = await repo.get(first)
    assert fetched is not None
    assert fetched.title == "New title"
    assert fetched.location == "Adelaide"
    assert fetched.payload == {"v": 2}


async def test_list_by_provider_returns_inserted_jobs(repo: SqliteJobRepository) -> None:
    await repo.upsert(
        provider="seek",
        source_url="https://www.seek.com.au/job/1",
        canonical_key="seek:1",
        title="Job 1",
        company="A",
        location=None,
        summary=None,
        payload={},
    )
    await repo.upsert(
        provider="seek",
        source_url="https://www.seek.com.au/job/2",
        canonical_key="seek:2",
        title="Job 2",
        company="B",
        location=None,
        summary=None,
        payload={},
    )
    jobs = await repo.list_by_provider("seek")
    assert len(jobs) == 2
    titles = {j.title for j in jobs}
    assert titles == {"Job 1", "Job 2"}
