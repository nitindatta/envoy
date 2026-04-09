"""SQLite repository for workflow_runs and browser_sessions."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

import aiosqlite


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SqliteWorkflowRunRepository:
    def __init__(self, connection: aiosqlite.Connection) -> None:
        self._conn = connection

    async def create(
        self,
        *,
        application_id: str,
        workflow_type: str,
    ) -> str:
        run_id = str(uuid.uuid4())
        now = _now()
        await self._conn.execute(
            """
            INSERT INTO workflow_runs
                (id, application_id, workflow_type, status, started_at, updated_at)
            VALUES (?, ?, ?, 'running', ?, ?)
            """,
            (run_id, application_id, workflow_type, now, now),
        )
        await self._conn.commit()
        return run_id

    async def update_status(
        self, run_id: str, status: str, current_node: str | None = None
    ) -> None:
        await self._conn.execute(
            "UPDATE workflow_runs SET status = ?, current_node = ?, updated_at = ? WHERE id = ?",
            (status, current_node, _now(), run_id),
        )
        await self._conn.commit()

    async def finish(self, run_id: str, status: str) -> None:
        now = _now()
        await self._conn.execute(
            "UPDATE workflow_runs SET status = ?, updated_at = ?, finished_at = ? WHERE id = ?",
            (status, now, now, run_id),
        )
        await self._conn.commit()


class SqliteBrowserSessionRepository:
    def __init__(self, connection: aiosqlite.Connection) -> None:
        self._conn = connection

    async def create(
        self,
        *,
        provider: str,
        session_key: str,
        application_id: str,
    ) -> str:
        session_id = str(uuid.uuid4())
        now = _now()
        await self._conn.execute(
            """
            INSERT INTO browser_sessions
                (id, provider, session_key, status, metadata_json, created_at, last_used_at)
            VALUES (?, ?, ?, 'open', ?, ?, ?)
            """,
            (session_id, provider, session_key, json.dumps({"application_id": application_id}), now, now),
        )
        await self._conn.commit()
        return session_id

    async def close(self, session_key: str) -> None:
        await self._conn.execute(
            "UPDATE browser_sessions SET status = 'closed', last_used_at = ? WHERE session_key = ?",
            (_now(), session_key),
        )
        await self._conn.commit()

    async def mark_stale(self, session_key: str) -> None:
        await self._conn.execute(
            "UPDATE browser_sessions SET status = 'stale', last_used_at = ? WHERE session_key = ?",
            (_now(), session_key),
        )
        await self._conn.commit()
