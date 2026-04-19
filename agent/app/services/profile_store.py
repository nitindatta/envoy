"""Helpers for loading and synchronizing the canonical profile."""

from __future__ import annotations

import json
from pathlib import Path

from app.services.profile_ingest import load_raw_profile
from app.services.profile_target import (
    build_canonical_profile,
    build_canonical_profile_from_raw_profile,
)
from app.settings import Settings
from app.state.canonical_profile import CanonicalProfile
from app.state.profile_interview import ProfileInterviewState


def current_source_profile_path(settings: Settings) -> str:
    return str(
        settings.resolved_raw_profile_path
        if settings.resolved_raw_profile_path.exists()
        else settings.resolved_profile_path
    )


def load_or_build_target_profile(settings: Settings) -> CanonicalProfile | None:
    source_path = settings.resolved_profile_path
    target_path = settings.resolved_target_profile_path
    raw_profile = load_raw_profile(settings)

    if raw_profile is None and not source_path.exists():
        return None

    if target_path.exists():
        return CanonicalProfile.model_validate_json(target_path.read_text(encoding="utf-8"))

    if raw_profile is not None:
        return build_canonical_profile_from_raw_profile(raw_profile)

    legacy_profile = json.loads(source_path.read_text(encoding="utf-8"))
    return build_canonical_profile(legacy_profile)


def apply_canonical_profile_to_interview_state(
    state: ProfileInterviewState,
    *,
    canonical_profile: CanonicalProfile,
    source_profile_path: str,
    target_profile_path: str,
) -> bool:
    before = state.model_dump(mode="json")

    state.canonical_profile = canonical_profile.model_copy(deep=True)
    state.source_profile_path = source_profile_path
    state.target_profile_path = target_profile_path

    active_item_id = state.selected_item_id or state.current_item_id
    if active_item_id and not (state.status == "awaiting_confirmation" and state.pending_item is not None):
        state.draft_item = next(
            (
                item.model_copy(deep=True)
                for item in canonical_profile.evidence_items
                if item.id == active_item_id
            ),
            None,
        )
    elif not active_item_id:
        state.draft_item = None

    return state.model_dump(mode="json") != before


def mirror_target_profile(target_path: Path, profile: CanonicalProfile) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(profile.model_dump_json(indent=2), encoding="utf-8")
