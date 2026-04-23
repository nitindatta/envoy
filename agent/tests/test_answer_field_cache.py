from __future__ import annotations

import pytest

from app.persistence.sqlite.connection import Database
from app.persistence.sqlite.question_cache import SqliteQuestionCacheRepository
from app.services import answer_field
from app.settings import Settings
from app.state.apply import FieldInfo


def _settings() -> Settings:
    return Settings(internal_auth_secret="test-secret")  # type: ignore[call-arg]


class FakeQuestionCache:
    def __init__(self, found: str | None = None) -> None:
        self.found = found
        self.saved: list[tuple[str, str, str | None, str]] = []

    async def find(self, question_raw: str) -> str | None:
        return self.found

    async def save(
        self,
        question_raw: str,
        answer: str,
        field_type: str | None = None,
        source: str = "human",
    ) -> str:
        self.saved.append((question_raw, answer, field_type, source))
        return "cache-id"


async def test_propose_field_values_persists_high_confidence_llm_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_llm(*args: object, **kwargs: object) -> tuple[str, float]:
        return "SEEK", 0.95

    monkeypatch.setattr(answer_field, "_resolve_via_llm", fake_llm)
    cache = FakeQuestionCache()
    field = FieldInfo(
        id="source",
        label="How did you hear about this position?",
        field_type="text",
        required=False,
    )

    proposed, low_confidence = await answer_field.propose_field_values(
        fields=[field],
        profile={},
        cover_letter="",
        settings=_settings(),
        question_cache=cache,  # type: ignore[arg-type]
    )

    assert proposed == {"source": "SEEK"}
    assert low_confidence == []
    assert cache.saved == [("How did you hear about this position?", "SEEK", "text", "llm")]


async def test_propose_field_values_treats_blank_cache_answer_as_hit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fail_llm(*args: object, **kwargs: object) -> tuple[str, float]:
        raise AssertionError("LLM should not be called when cache has an answer")

    monkeypatch.setattr(answer_field, "_resolve_via_llm", fail_llm)
    cache = FakeQuestionCache(found="")
    field = FieldInfo(
        id="current-position",
        label="If you are a current employee, please specify the current position",
        field_type="text",
        required=False,
    )

    proposed, low_confidence = await answer_field.propose_field_values(
        fields=[field],
        profile={},
        cover_letter="",
        settings=_settings(),
        question_cache=cache,  # type: ignore[arg-type]
    )

    assert proposed == {"current-position": ""}
    assert low_confidence == []
    assert cache.saved == []


async def test_question_cache_records_source_and_returns_blank_answers() -> None:
    db = await Database.in_memory()
    try:
        repo = SqliteQuestionCacheRepository(db.connection)
        await repo.save("Optional detail", "", field_type="text", source="llm")

        assert await repo.find("Optional detail") == ""
        entries = await repo.list_all()
        assert entries[0]["answer"] == ""
        assert entries[0]["source"] == "llm"
    finally:
        await db.close()
