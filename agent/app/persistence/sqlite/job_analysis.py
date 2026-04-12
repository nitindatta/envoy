from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone

import aiosqlite


@dataclass
class JobAnalysis:
    job_id: str
    description: str
    must_have: list[str]
    duties: list[str]
    nice_to_have: list[str]
    contact_name: str
    analysed_at: str


class SqliteJobAnalysisRepository:
    def __init__(self, connection: aiosqlite.Connection) -> None:
        self._db = connection

    async def get(self, job_id: str) -> JobAnalysis | None:
        cursor = await self._db.execute(
            "SELECT * FROM job_analysis WHERE job_id = ?", (job_id,)
        )
        row = await cursor.fetchone()
        await cursor.close()
        if row is None:
            return None
        return JobAnalysis(
            job_id=row["job_id"],
            description=row["description"],
            must_have=json.loads(row["must_have_json"]),
            duties=json.loads(row["duties_json"]),
            nice_to_have=json.loads(row["nice_to_have_json"]),
            contact_name=row["contact_name"],
            analysed_at=row["analysed_at"],
        )

    async def save(
        self,
        job_id: str,
        description: str,
        must_have: list[str],
        duties: list[str],
        nice_to_have: list[str],
        contact_name: str,
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        await self._db.execute(
            """
            INSERT INTO job_analysis
                (job_id, description, must_have_json, duties_json, nice_to_have_json, contact_name, analysed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(job_id) DO UPDATE SET
                description     = excluded.description,
                must_have_json  = excluded.must_have_json,
                duties_json     = excluded.duties_json,
                nice_to_have_json = excluded.nice_to_have_json,
                contact_name    = excluded.contact_name,
                analysed_at     = excluded.analysed_at
            """,
            (job_id, description, json.dumps(must_have), json.dumps(duties),
             json.dumps(nice_to_have), contact_name, now),
        )
        await self._db.commit()
