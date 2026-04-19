"""SQLite repository for applications and drafts."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import aiosqlite

from app.state.prepare import Application, Draft


def _now() -> str:
    return datetime.now(UTC).isoformat()


class SqliteApplicationRepository:
    def __init__(self, connection: aiosqlite.Connection) -> None:
        self._conn = connection

    async def create(
        self,
        *,
        job_id: str,
        source_provider: str,
        source_url: str,
        is_suitable: bool = True,
        gaps: list[str] | None = None,
        fit_score: float | None = None,
    ) -> str:
        app_id = str(uuid.uuid4())
        now = _now()
        await self._conn.execute(
            """
            INSERT INTO applications
                (id, job_id, source_provider, source_url, state,
                 approval_required, is_suitable, gaps_json, fit_score, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'prepared', 1, ?, ?, ?, ?, ?)
            """,
            (app_id, job_id, source_provider, source_url,
             1 if is_suitable else 0, json.dumps(gaps or []), fit_score, now, now),
        )
        await self._conn.commit()
        return app_id

    async def create_preparing(
        self,
        *,
        job_id: str,
        source_provider: str,
        source_url: str,
    ) -> str:
        """Create a placeholder application in 'preparing' state for async queue."""
        app_id = str(uuid.uuid4())
        now = _now()
        await self._conn.execute(
            "INSERT INTO applications "
            "(id, job_id, source_provider, source_url, state, approval_required, is_suitable, gaps_json, fit_score, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 'preparing', 1, 1, '[]', NULL, ?, ?)",
            (app_id, job_id, source_provider, source_url, now, now),
        )
        await self._conn.commit()
        return app_id

    async def update_after_prepare(
        self,
        app_id: str,
        *,
        is_suitable: bool,
        gaps: list[str],
        fit_score: float | None = None,
        new_state: str = "prepared",
    ) -> None:
        await self._conn.execute(
            "UPDATE applications SET is_suitable=?, gaps_json=?, fit_score=?, state=?, updated_at=? WHERE id=?",
            (1 if is_suitable else 0, json.dumps(gaps), fit_score, new_state, _now(), app_id),
        )
        await self._conn.commit()

    async def update_apply_step(self, app_id: str, step_json: str) -> None:
        await self._conn.execute(
            "UPDATE applications SET last_apply_step_json=?, updated_at=? WHERE id=?",
            (step_json, _now(), app_id),
        )
        await self._conn.commit()

    async def update_state(self, app_id: str, state: str) -> None:
        await self._conn.execute(
            "UPDATE applications SET state = ?, updated_at = ? WHERE id = ?",
            (state, _now(), app_id),
        )
        await self._conn.commit()

    async def get(self, app_id: str) -> Application | None:
        async with self._conn.execute(
            "SELECT id, job_id, source_provider, source_url, state, created_at, updated_at, last_apply_step_json, "
            "is_suitable, gaps_json, fit_score "
            "FROM applications WHERE id = ?",
            (app_id,),
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return None
        return Application(
            id=row[0],
            job_id=row[1],
            source_provider=row[2],
            source_url=row[3],
            state=row[4],
            created_at=datetime.fromisoformat(row[5]),
            updated_at=datetime.fromisoformat(row[6]),
            last_apply_step_json=row[7],
            is_suitable=bool(row[8]),
            gaps_json=row[9] or "[]",
            fit_score=row[10],
        )

    async def get_active_by_job_id(self, job_id: str) -> tuple[str, bool, list[str], float | None] | None:
        """Return (application_id, is_suitable, gaps, fit_score) for the latest non-discarded,
        non-preparing application, or None."""
        async with self._conn.execute(
            "SELECT id, is_suitable, gaps_json, fit_score FROM applications "
            "WHERE job_id = ? AND state NOT IN ('discarded', 'preparing') "
            "ORDER BY created_at DESC LIMIT 1",
            (job_id,),
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return None
        return row[0], bool(row[1]), json.loads(row[2]), row[3]

    async def list_all(
        self,
        limit: int = 50,
        state: str | None = None,
        exclude_discarded: bool = False,
    ) -> list[Application]:
        base_select = (
            "SELECT id, job_id, source_provider, source_url, state, created_at, updated_at, last_apply_step_json, "
            "is_suitable, gaps_json, fit_score "
            "FROM applications"
        )
        if state:
            sql = f"{base_select} WHERE state = ? ORDER BY created_at DESC LIMIT ?"
            args: tuple = (state, limit)
        elif exclude_discarded:
            sql = f"{base_select} WHERE state != 'discarded' ORDER BY created_at DESC LIMIT ?"
            args = (limit,)
        else:
            sql = f"{base_select} ORDER BY created_at DESC LIMIT ?"
            args = (limit,)

        async with self._conn.execute(sql, args) as cur:
            rows = await cur.fetchall()

        return [
            Application(
                id=r[0],
                job_id=r[1],
                source_provider=r[2],
                source_url=r[3],
                state=r[4],
                created_at=datetime.fromisoformat(r[5]),
                updated_at=datetime.fromisoformat(r[6]),
                last_apply_step_json=r[7],
                is_suitable=bool(r[8]),
                gaps_json=r[9] or "[]",
                fit_score=r[10],
            )
            for r in rows
        ]


class SqliteDraftRepository:
    def __init__(self, connection: aiosqlite.Connection) -> None:
        self._conn = connection

    async def create(
        self,
        *,
        application_id: str,
        draft_type: str,
        generator: str,
        content: str,
        question_fingerprint: str | None = None,
    ) -> str:
        draft_id = str(uuid.uuid4())
        now = _now()
        await self._conn.execute(
            """
            INSERT INTO drafts
                (id, application_id, draft_type, question_fingerprint,
                 generator, content, version, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?)
            """,
            (draft_id, application_id, draft_type, question_fingerprint, generator, content, now),
        )
        await self._conn.commit()
        return draft_id

    async def update_content(self, draft_id: str, content: str) -> None:
        await self._conn.execute(
            "UPDATE drafts SET content = ?, version = version + 1 WHERE id = ?",
            (content, draft_id),
        )
        await self._conn.commit()

    async def get_cover_letter(self, application_id: str) -> str:
        """Return the latest cover letter content for an application, or empty string."""
        async with self._conn.execute(
            "SELECT content FROM drafts WHERE application_id = ? AND draft_type = 'cover_letter' "
            "ORDER BY created_at DESC LIMIT 1",
            (application_id,),
        ) as cur:
            row = await cur.fetchone()
        return row[0] if row else ""

    async def get_match_evidence(self, application_id: str) -> str:
        """Return the match evidence text for an application, or empty string."""
        async with self._conn.execute(
            "SELECT content FROM drafts WHERE application_id = ? AND draft_type = 'match_evidence' "
            "ORDER BY created_at DESC LIMIT 1",
            (application_id,),
        ) as cur:
            row = await cur.fetchone()
        return row[0] if row else ""

    async def list_for_application(self, application_id: str) -> list[Draft]:
        async with self._conn.execute(
            "SELECT id, application_id, draft_type, question_fingerprint, "
            "generator, content, version, created_at "
            "FROM drafts WHERE application_id = ? ORDER BY created_at",
            (application_id,),
        ) as cur:
            rows = await cur.fetchall()
        return [
            Draft(
                id=r[0],
                application_id=r[1],
                draft_type=r[2],
                question_fingerprint=r[3],
                generator=r[4],
                content=r[5],
                version=r[6],
                created_at=datetime.fromisoformat(r[7]),
            )
            for r in rows
        ]
