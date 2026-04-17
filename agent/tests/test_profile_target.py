from app.services.profile_target import (
    apply_profile_answers,
    build_canonical_profile,
    build_canonical_profile_from_raw_profile,
    build_profile_enrichment_questions,
)
from app.state.canonical_profile import CanonicalEvidenceItem, CanonicalProfile, ProfileAnswer
from app.state.raw_profile import (
    RawProfile,
    RawProfileBullet,
    RawProfileExperience,
    RawProfileIdentity,
)


def test_build_canonical_profile_maps_existing_profile_shape() -> None:
    raw_profile = {
        "name": "Nitin Datta",
        "headline": "AI & Data Systems Engineer",
        "summary": "Hands-on data engineer building practical systems.",
        "location": "Adelaide",
        "work_rights": "Permanent resident",
        "salary_expectation": "$180,000 - $200,000",
        "core_strengths": ["Databricks", "embeddings", "entity resolution", "FastAPI"],
        "writing_samples": ["I tend to work best when I own the problem end-to-end."],
        "narrative_strengths": [
            (
                "At the Department for Education in South Australia I built a "
                "metadata-driven ingestion and transformation framework on Databricks."
            )
        ],
        "experience": [
            {
                "title": "Data Engineer",
                "company": "Department for Education",
                "highlights": [
                    "Built a Databricks based modern data platform.",
                    "Designed a student mastering and entity resolution system.",
                ],
                "metrics": ["reduced source onboarding time"],
            }
        ],
        "selected_projects": [
            {
                "name": "Envoy",
                "summary": "Autonomous job application agent with FastAPI, LangGraph, and Playwright.",
            }
        ],
    }

    draft = build_canonical_profile(raw_profile)

    assert draft.name == "Nitin Datta"
    assert draft.headline == "AI & Data Systems Engineer"
    assert draft.voice_samples == ["I tend to work best when I own the problem end-to-end."]
    assert len(draft.evidence_items) == 2

    experience_item = draft.evidence_items[0]
    assert experience_item.source == "Department for Education"
    assert experience_item.role_title == "Data Engineer"
    assert experience_item.metrics == ["reduced source onboarding time"]
    assert "Databricks" in experience_item.skills
    assert "education" in experience_item.domain
    assert experience_item.action
    assert experience_item.proof_points

    project_item = draft.evidence_items[1]
    assert project_item.source == "Envoy"
    assert project_item.role_title == "Project"
    assert "FastAPI" in project_item.skills


def test_build_profile_enrichment_questions_targets_star_gaps() -> None:
    profile = CanonicalProfile(
        name="Nitin Datta",
        voice_samples=["I tend to work best when I own the problem end-to-end."],
        evidence_items=[
            CanonicalEvidenceItem(
                id="dfe_entity_resolution",
                source="Department for Education",
                role_title="Data Engineer",
                action="Built a metadata-driven ingestion and entity resolution framework.",
                proof_points=["Built a metadata-driven ingestion and entity resolution framework."],
            )
        ],
    )

    questions = build_profile_enrichment_questions(profile, limit=10)
    target_fields = {question.target_field for question in questions}

    assert "voice_samples" in target_fields
    assert "evidence_items[dfe_entity_resolution].situation" in target_fields
    assert "evidence_items[dfe_entity_resolution].task" in target_fields
    assert "evidence_items[dfe_entity_resolution].outcome" in target_fields
    assert "evidence_items[dfe_entity_resolution].metrics" in target_fields
    voice_question = next(question for question in questions if question.target_field == "voice_samples")
    assert voice_question.current_value == "I tend to work best when I own the problem end-to-end."


def test_build_canonical_profile_from_raw_profile_uses_experience_and_projects() -> None:
    raw_profile = RawProfile(
        identity=RawProfileIdentity(
            name="Nitin Datta",
            headline="AI & Data Systems Engineer",
            location="Adelaide",
        ),
        summary="Hands-on data engineer.",
        skills=["Databricks", "FastAPI"],
        experience=[
            RawProfileExperience(
                id="dfe_data_engineer",
                title="Data Engineer",
                company="Department for Education",
                bullets=[
                    RawProfileBullet(text="Built a Databricks based modern data platform."),
                    RawProfileBullet(text="Reduced source onboarding time."),
                ],
                metrics=["Reduced source onboarding time."],
                technologies=["Databricks"],
            )
        ],
    )

    canonical = build_canonical_profile_from_raw_profile(raw_profile)

    assert canonical.name == "Nitin Datta"
    assert canonical.core_strengths == ["Databricks", "FastAPI"]
    assert len(canonical.evidence_items) == 1
    assert canonical.evidence_items[0].source == "Department for Education"
    assert canonical.evidence_items[0].metrics == ["Reduced source onboarding time."]


def test_apply_profile_answers_updates_top_level_and_evidence_fields() -> None:
    profile = CanonicalProfile(
        name="Nitin Datta",
        voice_samples=["I like to stay close to the delivery details."],
        evidence_items=[
            CanonicalEvidenceItem(
                id="dfe_entity_resolution",
                source="Department for Education",
                role_title="Data Engineer",
                action="Built a metadata-driven ingestion and entity resolution framework.",
            )
        ],
    )

    updated = apply_profile_answers(
        profile,
        [
            ProfileAnswer(
                target_field="summary",
                value="Data engineer focused on AI-enabled data platforms.",
            ),
            ProfileAnswer(
                target_field="voice_samples",
                value="I prefer to own the problem end-to-end.\nI try to keep solutions practical.",
            ),
            ProfileAnswer(
                target_field="evidence_items[dfe_entity_resolution].situation",
                value="The department needed a scalable way to master student records.",
            ),
            ProfileAnswer(
                target_field="evidence_items[dfe_entity_resolution].metrics",
                value="Reduced onboarding time\nImproved matching reliability",
            ),
        ],
    )

    assert updated.summary == "Data engineer focused on AI-enabled data platforms."
    assert updated.voice_samples == [
        "I prefer to own the problem end-to-end.",
        "I try to keep solutions practical.",
    ]
    assert updated.evidence_items[0].situation == "The department needed a scalable way to master student records."
    assert updated.evidence_items[0].metrics == [
        "Reduced onboarding time",
        "Improved matching reliability",
    ]
