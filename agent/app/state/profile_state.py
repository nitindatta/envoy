"""Persisted canonical profile snapshot stored in SQLite.

This is the DB-backed source of truth for the current canonical profile.
JSON files are treated as mirrors/exports so the user can inspect them, but
setup and interview flows should read from this snapshot first.
"""

from __future__ import annotations

from pydantic import BaseModel

from app.state.canonical_profile import CanonicalProfile


class ProfileStateSnapshot(BaseModel):
    source_profile_path: str
    target_profile_path: str
    canonical_profile: CanonicalProfile
    updated_at: str = ""
