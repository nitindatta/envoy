"""Runtime profile facts used by prepare/apply workflows."""

from __future__ import annotations

import json
from typing import Any

from app.services.profile_ingest import load_raw_profile
from app.settings import Settings


def load_runtime_profile(settings: Settings) -> dict[str, Any]:
    profile: dict[str, Any] = {}

    source_path = settings.resolved_profile_path
    if source_path.exists():
        profile = json.loads(source_path.read_text(encoding="utf-8"))

    raw_profile = load_raw_profile(settings)
    if raw_profile is not None:
        profile = _deep_merge_non_empty(profile, _raw_profile_facts(raw_profile.model_dump(mode="json")))

    target_path = settings.resolved_target_profile_path
    if target_path.exists():
        canonical = json.loads(target_path.read_text(encoding="utf-8"))
        profile = _deep_merge_non_empty(profile, canonical)

    external_accounts_path = settings.resolved_external_accounts_path
    if external_accounts_path.exists():
        external_accounts = json.loads(external_accounts_path.read_text(encoding="utf-8"))
        if isinstance(external_accounts, dict):
            profile["external_accounts"] = external_accounts
            employment_history = external_accounts.get("employment_history")
            if isinstance(employment_history, dict):
                profile["employment_history"] = employment_history

    resume_path = settings.resolved_resume_path
    if resume_path is not None:
        profile["resume_path"] = str(resume_path)

    return profile


def _raw_profile_facts(raw_profile: dict[str, Any]) -> dict[str, Any]:
    identity = raw_profile.get("identity", {}) if isinstance(raw_profile.get("identity"), dict) else {}

    facts: dict[str, Any] = {
        "name": str(identity.get("name", "")).strip(),
        "headline": str(identity.get("headline", "")).strip(),
        "email": str(identity.get("email", "")).strip(),
        "phone": str(identity.get("phone", "")).strip(),
        "location": str(identity.get("location", "")).strip(),
        "contact": {
            "email": str(identity.get("email", "")).strip(),
            "phone": str(identity.get("phone", "")).strip(),
        },
    }
    return _prune_empty(facts)


def _deep_merge_non_empty(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in overlay.items():
        if value is None or value == "" or value == [] or value == {}:
            continue
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge_non_empty(merged[key], value)
        else:
            merged[key] = value
    return merged


def _prune_empty(value: Any) -> Any:
    if isinstance(value, dict):
        cleaned = {
            key: _prune_empty(item)
            for key, item in value.items()
            if item not in (None, "", [], {})
        }
        return {key: item for key, item in cleaned.items() if item not in (None, "", [], {})}
    if isinstance(value, list):
        cleaned = [_prune_empty(item) for item in value]
        return [item for item in cleaned if item not in (None, "", [], {})]
    return value
