import json
import shutil
import uuid
from pathlib import Path

from app.settings import Settings
from app.workflows.cover_letter import (
    RequirementItem,
    _build_evidence_catalog,
    _fallback_plan_letter,
    _fallback_select_evidence,
    _format_experience,
    _format_narrative_strengths,
    _format_projects,
)
from app.workflows.prepare import _load_profile


def test_prepare_load_profile_prefers_canonical() -> None:
    temp_root = Path.cwd() / "test-output" / f"cover-letter-{uuid.uuid4().hex}"
    profile_dir = temp_root / "profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    try:
        legacy_path = profile_dir / "profile.json"
        canonical_path = profile_dir / "profile.canonical.json"

        legacy_path.write_text(json.dumps({"name": "Legacy Profile"}), encoding="utf-8")
        canonical_path.write_text(json.dumps({"name": "Canonical Profile"}), encoding="utf-8")

        settings = Settings(  # type: ignore[call-arg]
            internal_auth_secret="test-secret",
            repo_root=temp_root,
            profile_path=Path("profile/profile.json"),
        )

        loaded = _load_profile(settings)

        assert loaded["name"] == "Canonical Profile"
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


def test_cover_letter_formatters_use_canonical_evidence_items() -> None:
    profile = {
        "core_strengths": ["Databricks", "LangGraph"],
        "evidence_items": [
            {
                "id": "dfe",
                "source": "Department for Education",
                "role_title": "Data Engineer",
                "situation": "Needed a simpler way to onboard data sources.",
                "task": "Own the metadata-driven platform design.",
                "action": "Built a Databricks-native metadata framework.",
                "outcome": "Reduced manual effort and simplified new pipeline setup.",
                "metrics": ["Reduced source onboarding time"],
                "proof_points": ["Designed student mastering and entity resolution"],
                "confidence": "approved",
            },
            {
                "id": "envoy",
                "source": "Envoy",
                "role_title": "Project",
                "action": "Built an agentic job application workflow.",
                "outcome": "Kept a human in the loop while improving automation reliability.",
                "metrics": [],
                "proof_points": ["FastAPI, LangGraph, Playwright, React"],
                "confidence": "draft",
            },
        ],
    }

    experience_text = _format_experience(profile)
    projects_text = _format_projects(profile)
    narrative_text = _format_narrative_strengths(profile)

    assert "Department for Education" in experience_text
    assert "Data Engineer" in experience_text
    assert "[approved]" in experience_text
    assert "Outcome: Reduced manual effort and simplified new pipeline setup." in experience_text
    assert "Reduced source onboarding time" in experience_text
    assert (
        "- Envoy: Built an agentic job application workflow. "
        "Kept a human in the loop while improving automation reliability."
    ) in projects_text
    assert (
        "- Department for Education: Built a Databricks-native metadata framework. "
        "Reduced manual effort and simplified new pipeline setup. Metrics: Reduced source onboarding time"
    ) in narrative_text


def test_build_evidence_catalog_prefers_structured_canonical_items() -> None:
    profile = {
        "evidence_items": [
            {
                "id": "dfe",
                "source": "Department for Education",
                "role_title": "Data Engineer",
                "skills": ["Databricks", "Python"],
                "domain": ["education", "data platform"],
                "situation": "Source onboarding was fragmented across separate notebooks.",
                "task": "Own a simpler metadata-driven ingestion approach.",
                "action": "Built a Databricks-native metadata framework.",
                "outcome": "Centralised ingestion and reduced onboarding effort.",
                "metrics": ["Reduced source onboarding time"],
                "proof_points": ["Entity resolution and student mastering"],
                "confidence": "approved",
            }
        ]
    }

    catalog = _build_evidence_catalog(profile)

    assert len(catalog) == 1
    card = catalog[0]
    assert card.id == "dfe"
    assert card.confidence == "approved"
    assert "Databricks" in card.tags
    assert "Built a Databricks-native metadata framework." in card.allowed_claim_seed
    assert "Centralised ingestion and reduced onboarding effort." in card.allowed_claim_seed
    assert "Reduced source onboarding time" in card.allowed_claim_seed


def test_fallback_selection_and_plan_use_best_structured_evidence() -> None:
    requirements = [
        RequirementItem(
            id="req-1",
            requirement="Build scalable data pipelines on Databricks",
            priority="high",
        ),
        RequirementItem(
            id="req-2",
            requirement="Communicate outcomes and delivery impact",
            priority="medium",
        ),
    ]
    profile = {
        "evidence_items": [
            {
                "id": "approved-dbx",
                "source": "Department for Education",
                "role_title": "Data Engineer",
                "skills": ["Databricks", "Python"],
                "domain": ["education"],
                "task": "Own the platform design.",
                "action": "Built a Databricks-native ingestion framework.",
                "outcome": "Reduced onboarding effort for new data sources.",
                "metrics": ["Reduced source onboarding time"],
                "proof_points": ["Metadata-driven ingestion"],
                "confidence": "approved",
            },
            {
                "id": "draft-alt",
                "source": "Side Project",
                "role_title": "Project",
                "skills": ["Databricks"],
                "action": "Experimented with ETL automation.",
                "outcome": "",
                "metrics": [],
                "proof_points": [],
                "confidence": "draft",
            },
        ]
    }

    catalog = _build_evidence_catalog(profile)
    selected = _fallback_select_evidence(requirements, catalog)
    plan = _fallback_plan_letter(requirements, selected)

    assert selected[0].matched_evidence_ids == ["approved-dbx"]
    assert selected[0].support_level in {"strong", "moderate"}
    assert any("Reduced source onboarding time" in claim for claim in selected[0].allowed_claims)
    assert plan.paragraph_plan[0].evidence_ids == ["approved-dbx"]
    assert "specific result" in " ".join(plan.must_include).lower()
