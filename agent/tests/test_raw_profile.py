from app.services.profile_ingest import (
    build_raw_profile_from_legacy_json,
    build_raw_profile_from_markdown,
)
from app.state.raw_profile import SourceDocument


def test_build_raw_profile_from_legacy_json_maps_existing_profile_shape() -> None:
    source = SourceDocument(
        id="upload-1",
        filename="profile.json",
        mime_type="application/json",
        saved_path="C:/tmp/profile.json",
        sha256="abc123",
    )
    legacy = {
        "name": "Nitin Datta",
        "headline": "AI & Data Systems Engineer",
        "contact": {
            "email": "nitin.datta@outlook.com",
            "phone": "+61 0414911261",
        },
        "summary": "Hands-on data engineer.",
        "core_strengths": ["Databricks", "FastAPI"],
        "writing_samples": ["I tend to work best when I own the problem end-to-end."],
        "experience": [
            {
                "title": "Data Engineer",
                "company": "Department for Education",
                "period": "2025-Present",
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
                "summary": "Autonomous job application agent with FastAPI and Playwright.",
            }
        ],
        "education": ["Bachelor of Science, University of Delhi"],
        "certifications": ["AWS Solutions Architect Associate"],
    }

    raw = build_raw_profile_from_legacy_json(legacy, source)

    assert raw.identity.name == "Nitin Datta"
    assert raw.identity.email == "nitin.datta@outlook.com"
    assert raw.skills == ["Databricks", "FastAPI"]
    assert len(raw.experience) == 1
    assert raw.experience[0].company == "Department for Education"
    assert len(raw.experience[0].bullets) == 2
    assert raw.experience[0].metrics == ["reduced source onboarding time"]
    assert len(raw.projects) == 1
    assert raw.projects[0].name == "Envoy"
    assert raw.source_documents[0].filename == "profile.json"


def test_build_raw_profile_from_markdown_extracts_core_sections() -> None:
    source = SourceDocument(
        id="upload-2",
        filename="resume.pdf",
        mime_type="application/pdf",
        saved_path="C:/tmp/resume.pdf",
        sha256="def456",
        extracted_text_path="C:/tmp/resume.md",
    )
    markdown = """
Nitin Datta
AI & Data Systems Engineer
nitin.datta@outlook.com | +61 0414911261 | Adelaide

# Summary
Hands-on data engineer focused on practical AI and data systems.

# Experience
## Data Engineer at Department for Education
- Built a Databricks based modern data platform.
- Designed a student mastering and entity resolution system.
- Reduced source onboarding time.

# Projects
## Envoy
- Autonomous job application agent with FastAPI, LangGraph, and Playwright.

# Skills
Databricks, FastAPI, Playwright, Python

# Education
Bachelor of Science, University of Delhi
""".strip()

    raw = build_raw_profile_from_markdown(markdown, source)

    assert raw.identity.name == "Nitin Datta"
    assert raw.identity.email == "nitin.datta@outlook.com"
    assert raw.identity.phone == "+61 0414911261"
    assert raw.summary == "Hands-on data engineer focused on practical AI and data systems."
    assert len(raw.experience) == 1
    assert raw.experience[0].title == "Data Engineer"
    assert raw.experience[0].company == "Department for Education"
    assert raw.experience[0].metrics == ["Reduced source onboarding time."]
    assert raw.projects[0].name == "Envoy"
    assert raw.skills == ["Databricks", "FastAPI", "Playwright", "Python"]


def test_build_raw_profile_from_docling_markdown_extracts_resume_sections() -> None:
    source = SourceDocument(
        id="upload-3",
        filename="resume.docx",
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        saved_path="C:/tmp/resume.docx",
        sha256="ghi789",
        extracted_text_path="C:/tmp/resume.md",
    )
    markdown = """
# Nitin Datta

AI &amp; Data Systems Engineer | LLM Systems | Distributed Platforms

Adelaide, South Australia | Open to relocate

nitin.datta@outlook.com | +61 0414911261 | GitHub: github.com/nitindatta

## Summary

I\u00e2\u20ac\u2122m a hands-on engineer with a background across data engineering and distributed architecture.

## Key Skills

AI/ML Systems: LLM pipelines, RAG, embeddings, agent-based architectures, semantic search
Data Engineering: Databricks, Spark (PySpark), Delta Lake, dbt, Dagster, Airflow
Languages: Python, Go, C# (.NET)

## Selected Projects

AI Decision Engine \u00e2\u20ac\u201c Agent-based workflow system using LLMs for dynamic decisioning

Metabricks \u00e2\u20ac\u201c Metadata-driven data + AI platform on Databricks supporting scalable ingestion and AI integration

## Professional Experience

Data Engineer \u00e2\u20ac\u201d Department for Education, South Australia (2025\u00e2\u20ac\u201cPresent)
\u00e2\u20ac\u00a2 Built Databricks-based modern data platform
\u00e2\u20ac\u00a2 Developed metadata-driven ingestion and transformation framework
\u00e2\u20ac\u00a2 Designed student mastering (entity resolution) system

Independent Consultant (2020\u00e2\u20ac\u201cPresent)
\u00e2\u20ac\u00a2 Delivered cloud-native and distributed architectures for startups

## Education

Bachelor of Science \u00e2\u20ac\u201d University of Delhi

## Certifications

AWS Solutions Architect Associate
""".strip()

    raw = build_raw_profile_from_markdown(markdown, source)

    assert raw.identity.name == "Nitin Datta"
    assert raw.identity.headline == "AI & Data Systems Engineer | LLM Systems | Distributed Platforms"
    assert raw.identity.location == "Adelaide, South Australia | Open to relocate"
    assert raw.summary.startswith("I'm a hands-on engineer")
    assert raw.skills[:5] == [
        "LLM pipelines",
        "RAG",
        "embeddings",
        "agent-based architectures",
        "semantic search",
    ]
    assert len(raw.projects) == 2
    assert raw.projects[0].name == "AI Decision Engine"
    assert raw.projects[0].summary == "Agent-based workflow system using LLMs for dynamic decisioning"
    assert len(raw.experience) == 2
    assert raw.experience[0].title == "Data Engineer"
    assert raw.experience[0].company == "Department for Education, South Australia"
    assert raw.experience[0].period_raw == "2025-Present"
    assert "Databricks" in raw.experience[0].technologies
    assert raw.education == ["Bachelor of Science - University of Delhi"]
    assert raw.certifications == ["AWS Solutions Architect Associate"]
    assert raw.parse_notes == []


def test_build_raw_profile_from_linkedin_markdown_recognizes_top_skills() -> None:
    source = SourceDocument(
        id="upload-4",
        filename="profile.pdf",
        mime_type="application/pdf",
        saved_path="C:/tmp/profile.pdf",
        sha256="jkl012",
        extracted_text_path="C:/tmp/profile.md",
    )
    markdown = """
Contact nitin.datta@gmail.com www.linkedin.com/in/nitindatta (LinkedIn)

## Top Skills

Data Architects Databricks SQL Server Integration Services

(SSIS)

## Summary

Hands-on Data Engineer and Architect focused on building scalable data systems.

## Nitin Datta

Engineering Australia

## Experience

Department for Education, South Australia Data Engineer July 2025 - Present (10 months)

VERTS Chief Technology Officer

June 2022 - Present (3 years 11 months)
""".strip()

    raw = build_raw_profile_from_markdown(markdown, source)

    assert raw.identity.name == "Nitin Datta"
    assert raw.identity.phone == ""
    assert raw.skills == [
        "Data Architects Databricks SQL Server Integration Services",
        "(SSIS)",
    ]
    assert raw.experience[0].title == "Data Engineer"
    assert raw.experience[0].company == "Department for Education, South Australia"
    assert raw.experience[0].period_raw == "July 2025 - Present (10 months)"
    assert raw.experience[1].title == "Chief Technology Officer"
    assert raw.experience[1].company == "VERTS"
    assert raw.experience[1].period_raw == "June 2022 - Present (3 years 11 months)"
    assert "Could not confidently extract a skills section from extracted document." not in raw.parse_notes
