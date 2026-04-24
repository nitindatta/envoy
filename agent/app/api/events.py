"""SSE endpoint — streams run events to the portal debug log panel."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.services.run_events import RunEvent, bus

router = APIRouter()


@router.get("/api/events/stream")
async def stream_events(request: Request) -> StreamingResponse:
    async def generator():
        q = await bus.subscribe()
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event: RunEvent = await asyncio.wait_for(q.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield "data: {\"type\":\"ping\"}\n\n"
                    continue
                payload = {
                    "type": event.type,
                    "run_id": event.run_id,
                    "label": event.label,
                    "ts": event.ts,
                    "data": event.data,
                }
                yield f"data: {json.dumps(payload)}\n\n"
        finally:
            bus.unsubscribe(q)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
