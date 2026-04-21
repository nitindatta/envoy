"""Tests for persisted application fit metadata."""

from __future__ import annotations

import json

import pytest

from app.persistence.sqlite.applications import SqliteApplicationRepository
from app.persistence.sqlite.connection import Database
from app.persistence.sqlite.jobs import SqliteJobRepository


@pytest.fixture()
async def repos() -> tuple[SqliteApplicationRepository, SqliteJobRepository]:
    db = await Database.in_memory()
    yield SqliteApplicationRepository(db.connection), SqliteJobRepository(db.connection)
    await db.close()


async def test_fit_metadata_survives_create_get_and_list(
    repos: tuple[SqliteApplicationRepository, SqliteJobRepository],
) -> None:
    repo, job_repo = repos
    job_id, _ = await job_repo.upsert(
        provider="seek",
        source_url="https://example.test/job/1",
        canonical_key="seek:1",
        title="Senior AI Engineer",
        company="Example Co",
        location="Sydney",
        summary="Build AI products",
        payload={},
    )
    app_id = await repo.create(
        job_id=job_id,
        source_provider="seek",
        source_url="https://example.test/job/1",
        is_suitable=False,
        gaps=["5+ years ML", "computer vision"],
        fit_score=0.43,
    )

    fetched = await repo.get(app_id)
    assert fetched is not None
    assert fetched.is_suitable is False
    assert json.loads(fetched.gaps_json) == ["5+ years ML", "computer vision"]
    assert fetched.fit_score == 0.43

    listed = await repo.list_all()
    assert len(listed) == 1
    assert listed[0].is_suitable is False
    assert json.loads(listed[0].gaps_json) == ["5+ years ML", "computer vision"]
    assert listed[0].fit_score == 0.43

    active = await repo.get_active_by_job_id(job_id)
    assert active == (app_id, False, ["5+ years ML", "computer vision"], 0.43)


async def test_update_after_prepare_persists_fit_metadata(
    repos: tuple[SqliteApplicationRepository, SqliteJobRepository],
) -> None:
    repo, job_repo = repos
    job_id, _ = await job_repo.upsert(
        provider="seek",
        source_url="https://example.test/job/2",
        canonical_key="seek:2",
        title="Machine Learning Engineer",
        company="Example Co",
        location="Castle Hill",
        summary="Deploy ML systems",
        payload={},
    )
    app_id = await repo.create_preparing(
        job_id=job_id,
        source_provider="seek",
        source_url="https://example.test/job/2",
    )

    await repo.update_after_prepare(
        app_id,
        is_suitable=False,
        gaps=["missing production AI evidence"],
        fit_score=0.38,
        new_state="unsuitable",
    )

    fetched = await repo.get(app_id)
    assert fetched is not None
    assert fetched.state == "unsuitable"
    assert fetched.is_suitable is False
    assert json.loads(fetched.gaps_json) == ["missing production AI evidence"]
    assert fetched.fit_score == 0.38


async def test_update_target_application_persists_external_portal_url(
    repos: tuple[SqliteApplicationRepository, SqliteJobRepository],
) -> None:
    repo, job_repo = repos
    job_id, _ = await job_repo.upsert(
        provider="linkedin",
        source_url="https://linkedin.test/jobs/view/1",
        canonical_key="linkedin:1",
        title="AI Engineer",
        company="Example Co",
        location="Sydney",
        summary="Build agents",
        payload={},
    )
    app_id = await repo.create(
        job_id=job_id,
        source_provider="linkedin",
        source_url="https://linkedin.test/jobs/view/1",
    )

    await repo.update_target_application(
        app_id,
        target_application_url="https://ats.example/apply/1",
        target_portal="greenhouse",
    )

    fetched = await repo.get(app_id)
    assert fetched is not None
    assert fetched.target_application_url == "https://ats.example/apply/1"
    assert fetched.target_portal == "greenhouse"

    listed = await repo.list_all()
    assert listed[0].target_application_url == "https://ats.example/apply/1"
    assert listed[0].target_portal == "greenhouse"


async def test_reset_apply_progress_returns_application_to_approved(
    repos: tuple[SqliteApplicationRepository, SqliteJobRepository],
) -> None:
    repo, job_repo = repos
    job_id, _ = await job_repo.upsert(
        provider="seek",
        source_url="https://example.test/job/3",
        canonical_key="seek:3",
        title="Senior Data Engineer",
        company="Example Co",
        location="Brisbane",
        summary="Build data platforms",
        payload={},
    )
    app_id = await repo.create(
        job_id=job_id,
        source_provider="seek",
        source_url="https://example.test/job/3",
    )
    await repo.update_target_application(
        app_id,
        target_application_url="https://ats.example/apply/3",
        target_portal="pageup",
    )
    await repo.update_apply_step(app_id, '{"status":"paused"}')
    await repo.update_state(app_id, "paused")

    await repo.reset_apply_progress(app_id)

    fetched = await repo.get(app_id)
    assert fetched is not None
    assert fetched.state == "approved"
    assert fetched.target_application_url is None
    assert fetched.target_portal is None
    assert fetched.last_apply_step_json is None
