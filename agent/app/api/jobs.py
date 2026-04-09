from fastapi import APIRouter, Request

from app.persistence.sqlite.jobs import SqliteJobRepository
from app.state.jobs import Job

router = APIRouter()


@router.get("/jobs")
async def list_jobs(request: Request, provider: str | None = None, limit: int = 50) -> dict[str, list[Job]]:
    repo: SqliteJobRepository = request.app.state.job_repository
    jobs = (
        await repo.list_by_provider(provider, limit=limit)
        if provider
        else await repo.list_all(limit=limit)
    )
    return {"jobs": jobs}
