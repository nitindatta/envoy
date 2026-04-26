import json
from pathlib import Path

from app.services.runtime_profile import load_runtime_profile
from app.settings import Settings


def _write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def test_load_runtime_profile_merges_raw_identity_without_inferred_employment_history(tmp_path: Path) -> None:
    repo_root = tmp_path
    _write_json(
        repo_root / "profile" / "raw_profile.json",
        {
            "identity": {
                "name": "Nitin Datta",
                "email": "nitin.datta@outlook.com",
                "phone": "+61 0414911261",
                "location": "Adelaide, South Australia",
            },
            "experience": [
                {"id": "aws", "company": "AWS", "title": "Solution Architect", "period_raw": "", "bullets": [], "metrics": [], "technologies": []},
                {"id": "svha", "company": "St Vincent's Health Australia", "title": "Data Engineer", "period_raw": "", "bullets": [], "metrics": [], "technologies": []},
                {"id": "aws-2", "company": "AWS", "title": "Solution Architect", "period_raw": "", "bullets": [], "metrics": [], "technologies": []},
            ],
        },
    )

    settings = Settings(
        _env_file=None,
        internal_auth_secret="test-secret",
        repo_root=repo_root,
        sqlite_path=Path("automation/agent.db"),
        profile_path=Path("profile/profile.json"),
        resume_path=Path("profile/resume.docx"),
        raw_profile_path=Path("profile/raw_profile.json"),
        profile_answers_path=Path("profile/profile_answers.json"),
        external_accounts_path=Path("profile/external_accounts.json"),
        profile_upload_dir=Path("automation/profile_uploads"),
    )

    profile = load_runtime_profile(settings)

    assert profile["email"] == "nitin.datta@outlook.com"
    assert profile["phone"] == "+61 0414911261"
    assert profile["contact"]["phone"] == "+61 0414911261"
    assert "employment_history" not in profile


def test_load_runtime_profile_merges_external_accounts_and_resume(tmp_path: Path) -> None:
    repo_root = tmp_path
    resume_path = repo_root / "profile" / "resume.docx"
    resume_path.parent.mkdir(parents=True, exist_ok=True)
    resume_path.write_bytes(b"docx")
    _write_json(
        repo_root / "profile" / "external_accounts.json",
        {
            "default": {"email": "nitin.datta@outlook.com"},
            "employment_history": {"employers": ["AWS", "St Vincent's Health Australia"]},
            "always_accept_consents": True,
        },
    )

    settings = Settings(
        _env_file=None,
        internal_auth_secret="test-secret",
        repo_root=repo_root,
        sqlite_path=Path("automation/agent.db"),
        profile_path=Path("profile/profile.json"),
        resume_path=Path("profile/resume.docx"),
        raw_profile_path=Path("profile/raw_profile.json"),
        profile_answers_path=Path("profile/profile_answers.json"),
        external_accounts_path=Path("profile/external_accounts.json"),
        profile_upload_dir=Path("automation/profile_uploads"),
    )

    profile = load_runtime_profile(settings)

    assert profile["external_accounts"]["always_accept_consents"] is True
    assert profile["employment_history"]["employers"] == ["AWS", "St Vincent's Health Australia"]
    assert profile["resume_path"] == str(resume_path)
