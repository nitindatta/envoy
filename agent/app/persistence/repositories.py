"""Abstract repository interfaces.

Domain code depends on these interfaces, not on SQLite implementations.
Concrete SQLite implementations live in app.persistence.sqlite.*.

These are stubs for phase 0. Each will be fleshed out in the phase that
first needs it (search → JobRepository, prepare → DraftRepository, etc.).
"""

from abc import ABC, abstractmethod
from typing import Any


class JobRepository(ABC):
    @abstractmethod
    async def upsert_by_canonical_key(self, job: dict[str, Any]) -> str: ...

    @abstractmethod
    async def get(self, job_id: str) -> dict[str, Any] | None: ...

    @abstractmethod
    async def list_by_filter(self, provider: str, label: str | None) -> list[dict[str, Any]]: ...


class JobLabelRepository(ABC):
    @abstractmethod
    async def add(self, job_id: str, label: str, reason: str, actor: str) -> None: ...

    @abstractmethod
    async def latest_for_job(self, job_id: str) -> dict[str, Any] | None: ...


class ApplicationRepository(ABC):
    @abstractmethod
    async def create(self, application: dict[str, Any]) -> str: ...

    @abstractmethod
    async def get(self, application_id: str) -> dict[str, Any] | None: ...

    @abstractmethod
    async def transition_state(
        self,
        application_id: str,
        from_state: str,
        to_state: str,
        actor: str,
        reason: str,
    ) -> None: ...


class ApplicationEventRepository(ABC):
    @abstractmethod
    async def append(
        self,
        application_id: str,
        event_type: str,
        from_state: str | None,
        to_state: str | None,
        payload: dict[str, Any],
    ) -> None: ...

    @abstractmethod
    async def list_for_application(self, application_id: str) -> list[dict[str, Any]]: ...


class DraftRepository(ABC):
    @abstractmethod
    async def save(self, draft: dict[str, Any]) -> str: ...

    @abstractmethod
    async def list_for_application(self, application_id: str) -> list[dict[str, Any]]: ...


class QuestionAnswerRepository(ABC):
    @abstractmethod
    async def save(self, answer: dict[str, Any]) -> str: ...

    @abstractmethod
    async def lookup_by_fingerprint(self, fingerprint: str) -> dict[str, Any] | None: ...


class WorkflowRunRepository(ABC):
    @abstractmethod
    async def create(self, run: dict[str, Any]) -> str: ...

    @abstractmethod
    async def update_status(self, run_id: str, status: str, current_node: str) -> None: ...

    @abstractmethod
    async def get(self, run_id: str) -> dict[str, Any] | None: ...


class BrowserSessionRepository(ABC):
    @abstractmethod
    async def upsert(self, session: dict[str, Any]) -> str: ...

    @abstractmethod
    async def get_by_provider(self, provider: str) -> dict[str, Any] | None: ...


class MemoryRepository(ABC):
    @abstractmethod
    async def save(self, entry: dict[str, Any]) -> str: ...

    @abstractmethod
    async def list_by_type(self, memory_type: str, scope: str | None = None) -> list[dict[str, Any]]: ...


class ArtifactRepository(ABC):
    @abstractmethod
    async def record(self, artifact: dict[str, Any]) -> str: ...

    @abstractmethod
    async def list_for_owner(self, owner_type: str, owner_id: str) -> list[dict[str, Any]]: ...


class SettingsRepository(ABC):
    @abstractmethod
    async def get(self, scope: str, key: str) -> dict[str, Any] | None: ...

    @abstractmethod
    async def set(self, scope: str, key: str, value: dict[str, Any]) -> None: ...


class DriftSignalRepository(ABC):
    @abstractmethod
    async def record(self, signal: dict[str, Any]) -> str: ...

    @abstractmethod
    async def list_unresolved(self) -> list[dict[str, Any]]: ...

    @abstractmethod
    async def mark_resolved(self, signal_id: str) -> None: ...
