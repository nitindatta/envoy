from app.policy.seek import is_blocked
from app.state.jobs import SeekJob


def _job(**overrides: object) -> SeekJob:
    base = {
        "provider_job_id": "1",
        "title": "Senior Python Engineer",
        "company": "Acme",
        "location": "Adelaide",
        "url": "https://www.seek.com.au/job/1",
    }
    base.update(overrides)
    return SeekJob.model_validate(base)


def test_passing_job_returns_none() -> None:
    assert is_blocked(_job()) is None


def test_blocks_internship_in_title() -> None:
    reason = is_blocked(_job(title="Software Engineering Intern"))
    assert reason is not None
    assert reason.rule == "title_keyword"
    assert reason.detail == "intern"


def test_blocks_graduate_program_in_title() -> None:
    reason = is_blocked(_job(title="2026 Graduate Program — Engineering"))
    assert reason is not None
    assert reason.rule == "title_keyword"
