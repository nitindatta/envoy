"""Tests for SqliteQueueRepository."""

from __future__ import annotations

import pytest

from app.persistence.sqlite.connection import Database
from app.persistence.sqlite.queue import SqliteQueueRepository


@pytest.fixture()
async def repo() -> SqliteQueueRepository:
    db = await Database.in_memory()
    yield SqliteQueueRepository(db.connection)
    await db.close()


async def test_enqueue_and_claim(repo: SqliteQueueRepository) -> None:
    item_id = await repo.enqueue("prepare", "app-1", {"key": "val"})
    assert item_id != ""

    item = await repo.claim_next()
    assert item is not None
    assert item.queue_type == "prepare"
    assert item.entity_id == "app-1"
    assert item.payload == {"key": "val"}
    assert item.status == "processing"


async def test_idempotent_enqueue(repo: SqliteQueueRepository) -> None:
    """Second enqueue for same type+entity while pending/processing should be a no-op."""
    id1 = await repo.enqueue("prepare", "app-1")
    id2 = await repo.enqueue("prepare", "app-1")
    assert id1 != ""
    assert id2 == ""  # skipped


async def test_claim_empty_queue(repo: SqliteQueueRepository) -> None:
    item = await repo.claim_next()
    assert item is None


async def test_mark_done(repo: SqliteQueueRepository) -> None:
    item_id = await repo.enqueue("prepare", "app-2")
    await repo.claim_next()
    await repo.mark_done(item_id)

    # After done, same entity can be re-enqueued
    new_id = await repo.enqueue("prepare", "app-2")
    assert new_id != ""


async def test_mark_failed(repo: SqliteQueueRepository) -> None:
    item_id = await repo.enqueue("apply", "app-3")
    await repo.claim_next()
    await repo.mark_failed(item_id, "something went wrong")

    # After failed, can re-enqueue
    new_id = await repo.enqueue("apply", "app-3")
    assert new_id != ""


async def test_fifo_ordering(repo: SqliteQueueRepository) -> None:
    """Items are claimed in FIFO order by created_at."""
    await repo.enqueue("prepare", "app-a")
    await repo.enqueue("prepare", "app-b")

    first = await repo.claim_next()
    assert first is not None
    assert first.entity_id == "app-a"

    # Mark done so app-b becomes claimable next
    await repo.mark_done(first.id)

    second = await repo.claim_next()
    assert second is not None
    assert second.entity_id == "app-b"


async def test_different_types_not_deduplicated(repo: SqliteQueueRepository) -> None:
    """Different queue_types for same entity are not deduplicated."""
    id1 = await repo.enqueue("prepare", "app-1")
    id2 = await repo.enqueue("apply", "app-1")
    assert id1 != ""
    assert id2 != ""
