"""SQLite-backed work queue repository."""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import aiosqlite

log = logging.getLogger("queue_repo")


@dataclass
class WorkQueueItem:
    id: str
    queue_type: str
    entity_id: str
    payload: dict
    status: str
    created_at: str


class SqliteQueueRepository:
    def __init__(self, connection: aiosqlite.Connection) -> None:
        self._conn = connection

    async def enqueue(
        self,
        queue_type: str,
        entity_id: str,
        payload: dict | None = None,
    ) -> str:
        """Insert a pending work item.

        Idempotent: skips if the entity already has a pending/processing item
        of the same type. Returns the new item id, or "" if skipped.
        """
        async with self._conn.execute(
            "SELECT id FROM work_queue "
            "WHERE queue_type=? AND entity_id=? AND status IN ('pending','processing')",
            (queue_type, entity_id),
        ) as cur:
            if await cur.fetchone():
                log.debug("[enqueue] skipped duplicate queue_type=%s entity_id=%s", queue_type, entity_id)
                return ""

        item_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        await self._conn.execute(
            "INSERT INTO work_queue (id, queue_type, entity_id, payload_json, status, created_at) "
            "VALUES (?, ?, ?, ?, 'pending', ?)",
            (item_id, queue_type, entity_id, json.dumps(payload or {}), now),
        )
        await self._conn.commit()
        log.debug("[enqueue] enqueued id=%s queue_type=%s entity_id=%s", item_id, queue_type, entity_id)
        return item_id

    async def claim_next(self) -> WorkQueueItem | None:
        """Atomically claim the oldest pending item. Returns None if queue empty."""
        async with self._conn.execute(
            "SELECT id, queue_type, entity_id, payload_json, status, created_at "
            "FROM work_queue WHERE status='pending' ORDER BY created_at ASC LIMIT 1",
        ) as cur:
            row = await cur.fetchone()

        if row is None:
            return None

        now = datetime.now(UTC).isoformat()
        await self._conn.execute(
            "UPDATE work_queue SET status='processing', started_at=? WHERE id=? AND status='pending'",
            (now, row[0]),
        )
        await self._conn.commit()

        return WorkQueueItem(
            id=row[0],
            queue_type=row[1],
            entity_id=row[2],
            payload=json.loads(row[3]),
            status="processing",
            created_at=row[5],
        )

    async def mark_done(self, item_id: str) -> None:
        now = datetime.now(UTC).isoformat()
        await self._conn.execute(
            "UPDATE work_queue SET status='done', finished_at=? WHERE id=?",
            (now, item_id),
        )
        await self._conn.commit()

    async def mark_failed(self, item_id: str, error: str) -> None:
        now = datetime.now(UTC).isoformat()
        await self._conn.execute(
            "UPDATE work_queue SET status='failed', finished_at=?, error=? WHERE id=?",
            (now, error[:1000], item_id),
        )
        await self._conn.commit()
