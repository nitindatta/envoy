"""Lightweight in-process event bus for streaming agent run events to the portal."""

from __future__ import annotations

import asyncio
from collections import deque
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

_current_run_id: ContextVar[str | None] = ContextVar("current_run_id", default=None)
_MAX_HISTORY = 200


@dataclass
class RunEvent:
    type: str
    run_id: str
    label: str
    data: dict[str, Any]
    ts: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class EventBus:
    def __init__(self) -> None:
        self._history: deque[RunEvent] = deque(maxlen=_MAX_HISTORY)
        self._queues: list[asyncio.Queue[RunEvent]] = []

    def emit(self, event: RunEvent) -> None:
        self._history.append(event)
        for q in list(self._queues):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass

    async def subscribe(self) -> asyncio.Queue[RunEvent]:
        q: asyncio.Queue[RunEvent] = asyncio.Queue(maxsize=500)
        for ev in list(self._history):
            await q.put(ev)
        self._queues.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[RunEvent]) -> None:
        try:
            self._queues.remove(q)
        except ValueError:
            pass


bus = EventBus()


def set_run_id(run_id: str) -> None:
    """Bind run_id to this async context so all emit() calls here tag events with it."""
    _current_run_id.set(run_id)


def emit(event_type: str, label: str, data: dict[str, Any], *, run_id: str | None = None) -> None:
    rid = run_id or _current_run_id.get() or "unknown"
    bus.emit(RunEvent(type=event_type, run_id=rid, label=label, data=data))
