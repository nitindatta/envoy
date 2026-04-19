import json as _json
import logging
import re

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from openai import AsyncOpenAI

from app.persistence.sqlite.job_analysis import SqliteJobAnalysisRepository
from app.persistence.sqlite.jobs import SqliteJobRepository
from app.state.jobs import Job

router = APIRouter()
log = logging.getLogger("jobs")

_VALID_STATES = {"discovered", "in_review", "ignored"}


@router.get("/jobs/search-tags")
async def list_search_tags(request: Request) -> dict[str, list[str]]:
    """Return all distinct search keywords that have been used to find jobs."""
    repo: SqliteJobRepository = request.app.state.job_repository
    tags = await repo.list_search_tags()
    return {"tags": tags}


@router.get("/jobs")
async def list_jobs(
    request: Request,
    provider: str | None = None,
    state: str | None = None,
    exclude: str | None = None,
    keyword: str | None = None,
    limit: int = 50,
) -> dict[str, list[Job]]:
    repo: SqliteJobRepository = request.app.state.job_repository
    exclude_states = [s.strip() for s in exclude.split(",") if s.strip()] if exclude else None
    jobs = (
        await repo.list_by_provider(provider, limit=limit, state=state, exclude_states=exclude_states, keyword=keyword)
        if provider
        else await repo.list_all(limit=limit, state=state, exclude_states=exclude_states, keyword=keyword)
    )
    return {"jobs": jobs}


@router.post("/jobs/{job_id}/queue")
async def queue_job(job_id: str, request: Request, background_tasks: BackgroundTasks) -> dict:
    job_repo: SqliteJobRepository = request.app.state.job_repository
    app_repo = request.app.state.application_repository
    queue_repo = request.app.state.queue_repository

    job = await job_repo.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")

    # Check if already in review (idempotent)
    existing = await app_repo.get_active_by_job_id(job_id)
    if existing:
        app_id = existing[0]
    else:
        # Move job to in_review
        await job_repo.update_state(job_id, "in_review")
        # Create application placeholder immediately so portal can show it
        app_id = await app_repo.create_preparing(
            job_id=job_id,
            source_provider=job.provider,
            source_url=job.source_url,
        )
        # Enqueue prepare
        await queue_repo.enqueue("prepare", app_id)
        # Also kick off JD analysis immediately (pre-warms the cache for prepare)
        background_tasks.add_task(
            _analyse_job,
            settings=request.app.state.settings,
            tool_client=request.app.state.tool_client,
            analysis_repo=request.app.state.job_analysis_repository,
            job=job,
        )

    return {"job_id": job_id, "application_id": app_id, "state": "preparing"}


@router.post("/jobs/{job_id}/ignore")
async def ignore_job(job_id: str, request: Request) -> dict:
    repo: SqliteJobRepository = request.app.state.job_repository
    job = await repo.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    await repo.update_state(job_id, "ignored")
    return {"job_id": job_id, "state": "ignored"}


async def _analyse_job(settings, tool_client, analysis_repo: SqliteJobAnalysisRepository, job: Job) -> None:
    """Background task: fetch SEEK detail + parse JD into structured cache."""
    from app.providers import registry

    log.info("[analyse_job] start job_id=%s provider=%s title=%s", job.id, job.provider, job.title)
    try:
        provider_job_id = str(job.payload.get("provider_job_id", ""))
        if not provider_job_id:
            log.warning("[analyse_job] no provider_job_id for job_id=%s", job.id)
            return

        adapter = registry.get(job.provider)
        detail = await adapter.fetch_detail(tool_client, provider_job_id)
        log.info("[analyse_job] fetched detail job_id=%s desc_len=%d", job.id, len(detail.description))

        client = AsyncOpenAI(base_url=settings.openai_base_url, api_key=settings.openai_api_key)
        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Parse a job description into structured data.\n"
                        "Return JSON with exactly these keys:\n"
                        '{"must_have": ["..."], "duties": ["..."], "nice_to_have": ["..."], "contact_name": "..."}\n'
                        "must_have: skills, experience, qualifications the candidate must bring. "
                        "duties: what the person will actually do day-to-day. "
                        "nice_to_have: bonus or optional items explicitly marked as such. "
                        'contact_name: ONLY a real person\'s name (e.g. "Jane Smith" or "Jane") if explicitly named in the JD. '
                        'If only a job title, team name, or email is given, use "". '
                        "Return ONLY the JSON object."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Job: {detail.title} at {detail.company}\n\n{detail.description[:3000]}",
                },
            ],
            temperature=0.1,
            max_tokens=600,
        )

        raw = (response.choices[0].message.content or "{}").strip()
        raw = re.sub(r"```[a-z]*\n?", "", raw).strip()
        parsed = _json.loads(raw)

        await analysis_repo.save(
            job_id=job.id,
            description=detail.description,
            must_have=parsed.get("must_have", []),
            duties=parsed.get("duties", []),
            nice_to_have=parsed.get("nice_to_have", []),
            contact_name=parsed.get("contact_name", ""),
        )
        log.info("[analyse_job] saved job_id=%s must_have=%d duties=%d",
                 job.id, len(parsed.get("must_have", [])), len(parsed.get("duties", [])))

    except Exception as exc:
        log.warning("[analyse_job] failed job_id=%s provider=%s error=%s", job.id, job.provider, exc)
