"""SQLite connection helper.

Owns the single shared aiosqlite connection used by all repositories. Runs
migrations on first connect. Tests use `Database.in_memory()` for an isolated
in-memory database.
"""

from __future__ import annotations

from pathlib import Path

import aiosqlite

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


class Database:
    def __init__(self, connection: aiosqlite.Connection) -> None:
        self.connection = connection

    @classmethod
    async def open(cls, sqlite_path: Path) -> Database:
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        connection = await aiosqlite.connect(str(sqlite_path))
        connection.row_factory = aiosqlite.Row
        await _apply_migrations(connection)
        return cls(connection)

    @classmethod
    async def in_memory(cls) -> Database:
        connection = await aiosqlite.connect(":memory:")
        connection.row_factory = aiosqlite.Row
        await _apply_migrations(connection)
        return cls(connection)

    async def close(self) -> None:
        await self.connection.close()


async def _apply_migrations(connection: aiosqlite.Connection) -> None:
    await connection.executescript(
        "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);"
    )
    await connection.commit()

    applied_cursor = await connection.execute("SELECT name FROM _migrations")
    applied = {row[0] for row in await applied_cursor.fetchall()}
    await applied_cursor.close()

    for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if migration.name in applied:
            continue
        sql = migration.read_text(encoding="utf-8")
        await connection.executescript(sql)
        await connection.execute(
            "INSERT INTO _migrations (name, applied_at) VALUES (?, datetime('now'))",
            (migration.name,),
        )
        await connection.commit()
