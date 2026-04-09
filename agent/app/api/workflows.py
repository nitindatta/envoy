import uuid

from fastapi import APIRouter, HTTPException, Request

from app.state.apply import ApplyRequest, ApplyResumeRequest, ApplyStepResponse
from app.state.jobs import SearchRequest, SearchResponse
from app.state.prepare import PrepareRequest, PrepareResponse
from app.tools.seek import SeekDriftError, SeekToolError
from app.tools.seek_detail import SeekDetailDriftError, SeekDetailError
from app.workflows.apply import resume_apply, run_apply
from app.workflows.prepare import run_prepare
from app.workflows.search import run_search

router = APIRouter()


@router.post("/workflows/prepare", response_model=PrepareResponse)
async def start_prepare(request: Request, body: PrepareRequest) -> PrepareResponse:
    try:
        state = await run_prepare(
            request.app.state.settings,
            request.app.state.tool_client,
            request.app.state.job_repository,
            request.app.state.application_repository,
            request.app.state.draft_repository,
            job_id=body.job_id,
        )
    except SeekDetailDriftError as exc:
        raise HTTPException(status_code=503, detail=f"seek detail drift: {exc.reason}")
    except SeekDetailError as exc:
        raise HTTPException(status_code=502, detail=f"seek detail error: {exc.error.type}")

    if state.error:
        raise HTTPException(status_code=422, detail=state.error)

    return PrepareResponse(
        application_id=state.application_id,
        cover_letter=state.cover_letter,
        questions=state.questions,
        is_suitable=state.is_suitable,
        gaps=state.gaps,
    )


@router.post("/workflows/apply", response_model=ApplyStepResponse)
async def start_apply(request: Request, body: ApplyRequest) -> ApplyStepResponse:
    run_repo = request.app.state.workflow_run_repository
    run_id = await run_repo.create(application_id=body.application_id, workflow_type="apply")

    state = await run_apply(
        request.app.state.settings,
        request.app.state.tool_client,
        request.app.state.application_repository,
        request.app.state.draft_repository,
        run_repo,
        request.app.state.browser_session_repository,
        request.app.state.database.connection,
        application_id=body.application_id,
        workflow_run_id=run_id,
    )

    return ApplyStepResponse(
        workflow_run_id=state.workflow_run_id,
        status=state.status,
        step=state.current_step,
        proposed_values=state.proposed_values,
        low_confidence_ids=state.low_confidence_ids,
    )


@router.post("/workflows/apply/{run_id}/resume", response_model=ApplyStepResponse)
async def resume_apply_run(run_id: str, request: Request, body: ApplyResumeRequest) -> ApplyStepResponse:
    state = await resume_apply(
        request.app.state.settings,
        request.app.state.tool_client,
        request.app.state.application_repository,
        request.app.state.draft_repository,
        request.app.state.workflow_run_repository,
        request.app.state.browser_session_repository,
        request.app.state.database.connection,
        workflow_run_id=run_id,
        approved_values=body.approved_values,
        action_label=body.action_label,
        action=body.action,
    )

    return ApplyStepResponse(
        workflow_run_id=state.workflow_run_id,
        status=state.status,
        step=state.current_step,
        proposed_values=state.proposed_values,
        low_confidence_ids=state.low_confidence_ids,
    )


@router.post("/workflows/search", response_model=SearchResponse)
async def start_search(request: Request, body: SearchRequest) -> SearchResponse:
    if body.provider != "seek":
        raise HTTPException(status_code=400, detail=f"unsupported provider: {body.provider}")
    try:
        state = await run_search(
            request.app.state.tool_client,
            request.app.state.job_repository,
            keywords=body.keywords,
            location=body.location,
            max_pages=body.max_pages,
        )
    except SeekDriftError as exc:
        raise HTTPException(status_code=503, detail=f"seek parser drift: {exc.drift.parser_id}")
    except SeekToolError as exc:
        raise HTTPException(status_code=502, detail=f"seek tool error: {exc.error.type}")

    return SearchResponse(
        discovered=len(state.discovered) + len(state.blocked),
        blocked=len(state.blocked),
        persisted=len(state.persisted_job_ids),
        job_ids=state.persisted_job_ids,
    )
