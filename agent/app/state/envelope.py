from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ToolError(BaseModel):
    type: str
    message: str


class ToolDrift(BaseModel):
    parser_id: str
    expected: str
    observed: str
    page_snapshot: str | None = None


class ToolArtifact(BaseModel):
    type: str
    path: str


ToolStatus = Literal["ok", "error", "drift", "needs_human"]


class ToolEnvelope(BaseModel, Generic[T]):
    """Mirror of the tool response envelope defined in tools/src/envelope.ts.

    Every tools/ response is validated into this model before being handled by
    the agent. HTTP 5xx from tools/ is treated as a transport failure. Tool-level
    failures come through as status="error" | "drift" | "needs_human".
    """

    status: ToolStatus
    data: Any = None
    error: ToolError | None = None
    drift: ToolDrift | None = None
    artifacts: list[ToolArtifact] | None = None
