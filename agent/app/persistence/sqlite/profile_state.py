"""SQLite repository for the canonical profile snapshot."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import aiosqlite

from app.state.profile_state import ProfileStateSnapshot


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SqliteProfileStateRepository:
    def __init__(self, connection: aiosqlite.Connection) -> None:
        self._conn = connection

    async def get(self) -> ProfileStateSnapshot | None:
        cursor = await self._conn.execute(
            """
            SELECT source_profile_path, target_profile_path, canonical_profile_json, updated_at
            FROM profile_state
            WHERE id = 1
            """
        )
        row = await cursor.fetchone()
        await cursor.close()
        if row is None:
            return None
        return ProfileStateSnapshot.model_validate(
            {
                "source_profile_path": row["source_profile_path"],
                "target_profile_path": row["target_profile_path"],
                "canonical_profile": json.loads(row["canonical_profile_json"]),
                "updated_at": row["updated_at"],
            }
        )

    async def save(self, snapshot: ProfileStateSnapshot) -> None:
        await self._conn.execute(
            """
            INSERT INTO profile_state
                (id, source_profile_path, target_profile_path, canonical_profile_json, updated_at)
            VALUES (1, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                source_profile_path = excluded.source_profile_path,
                target_profile_path = excluded.target_profile_path,
                canonical_profile_json = excluded.canonical_profile_json,
                updated_at = excluded.updated_at
            """,
            (
                snapshot.source_profile_path,
                snapshot.target_profile_path,
                snapshot.canonical_profile.model_dump_json(),
                _now(),
            ),
        )
        await self._conn.commit()
