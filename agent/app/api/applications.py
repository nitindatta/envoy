"""Application and draft API routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.persistence.sqlite.applications import SqliteApplicationRepository, SqliteDraftRepository

router = APIRouter()


@router.get("/applications", response_model=dict)
async def list_applications(request: Request, limit: int = 50, state: str | None = None):
    app_repo: SqliteApplicationRepository = request.app.state.application_repository
    job_repo = request.app.state.job_repository

    # Default: exclude discarded
    apps = await app_repo.list_all(limit=limit, state=state, exclude_discarded=True)

    results = []
    for a in apps:
        job = await job_repo.get(a.job_id)
        results.append({
            **a.model_dump(),
            "job_title": job.title if job else None,
            "job_company": job.company if job else None,
            "job_location": job.location if job else None,
            "job_source_url": job.source_url if job else None,
            "job_summary": job.summary if job else None,
            "job_payload": job.payload if job else {},
        })
    return {"applications": results}


@router.get("/applications/{app_id}", response_model=dict)
async def get_application(app_id: str, request: Request):
    app_repo: SqliteApplicationRepository = request.app.state.application_repository
    draft_repo: SqliteDraftRepository = request.app.state.draft_repository
    job_repo = request.app.state.job_repository

    app = await app_repo.get(app_id)
    if app is None:
        raise HTTPException(status_code=404, detail="application not found")

    job = await job_repo.get(app.job_id)
    drafts = await draft_repo.list_for_application(app_id)

    # Get cover letter and match evidence from drafts
    cover_letter = next((d.content for d in drafts if d.draft_type == "cover_letter"), "")
    match_evidence = next((d.content for d in drafts if d.draft_type == "match_evidence"), "")

    return {
        "application": app.model_dump(),
        "drafts": [d.model_dump() for d in drafts],
        "cover_letter": cover_letter,
        "match_evidence": match_evidence,
        "last_apply_step": app.last_apply_step_json,  # raw JSON string or None
        "job": {
            "title": job.title if job else None,
            "company": job.company if job else None,
            "location": job.location if job else None,
            "source_url": job.source_url if job else None,
            "summary": job.summary if job else None,
            "payload": job.payload if job else {},
        } if job else None,
    }


class ApproveRequest(BaseModel):
    cover_letter: str | None = None


@router.post("/applications/{app_id}/approve", response_model=dict)
async def approve_application(app_id: str, request: Request, body: ApproveRequest | None = None):
    if body is None:
        body = ApproveRequest()
    repo: SqliteApplicationRepository = request.app.state.application_repository
    draft_repo: SqliteDraftRepository = request.app.state.draft_repository
    app = await repo.get(app_id)
    if app is None:
        raise HTTPException(status_code=404, detail="application not found")
    approvable_states = {"prepared", "approved", "paused", "failed"}
    if app.state not in approvable_states:
        raise HTTPException(status_code=409, detail=f"cannot approve from state '{app.state}'")

    # Persist edited cover letter if provided
    if body.cover_letter is not None:
        drafts = await draft_repo.list_for_application(app_id)
        cl_draft = next((d for d in drafts if d.draft_type == "cover_letter"), None)
        if cl_draft:
            await draft_repo.update_content(cl_draft.id, body.cover_letter)

    await repo.update_state(app_id, "approved")
    return {"application_id": app_id, "state": "approved"}


@router.post("/applications/{app_id}/discard", response_model=dict)
async def discard_application(app_id: str, request: Request):
    repo: SqliteApplicationRepository = request.app.state.application_repository
    app = await repo.get(app_id)
    if app is None:
        raise HTTPException(status_code=404, detail="application not found")
    await repo.update_state(app_id, "discarded")
    return {"application_id": app_id, "state": "discarded"}


@router.post("/applications/{app_id}/mark_submitted", response_model=dict)
async def mark_submitted(app_id: str, request: Request):
    """Mark an application as submitted — used when the portal redirected to an external ATS."""
    repo: SqliteApplicationRepository = request.app.state.application_repository
    job_repo = request.app.state.job_repository
    app = await repo.get(app_id)
    if app is None:
        raise HTTPException(status_code=404, detail="application not found")
    await repo.update_state(app_id, "applied")
    # Move the job out of review so it doesn't show on the Review Desk
    await job_repo.update_state(app.job_id, "ignored")
    return {"application_id": app_id, "state": "applied"}


# ── Async queue endpoints ──────────────────────────────────────────────────────

@router.post("/applications/{app_id}/apply", response_model=dict)
async def enqueue_apply(app_id: str, request: Request):
    """Enqueue an apply workflow run for an approved application."""
    repo: SqliteApplicationRepository = request.app.state.application_repository
    queue_repo = request.app.state.queue_repository

    app = await repo.get(app_id)
    if app is None:
        raise HTTPException(status_code=404, detail="application not found")

    applyable_states = {"approved", "paused", "failed"}
    if app.state not in applyable_states:
        raise HTTPException(status_code=409, detail=f"cannot apply from state '{app.state}'")

    await repo.update_state(app_id, "applying")
    await queue_repo.enqueue("apply", app_id)
    return {"application_id": app_id, "state": "applying"}


class GateResumeRequest(BaseModel):
    run_id: str
    approved_values: dict[str, str]


@router.post("/applications/{app_id}/gate", response_model=dict)
async def enqueue_gate_resume(app_id: str, request: Request, body: GateResumeRequest):
    """Enqueue a resume after the HITL gate (user approved field values)."""
    repo: SqliteApplicationRepository = request.app.state.application_repository
    queue_repo = request.app.state.queue_repository

    app = await repo.get(app_id)
    if app is None:
        raise HTTPException(status_code=404, detail="application not found")

    await repo.update_state(app_id, "applying")
    await queue_repo.enqueue("resume", app_id, {
        "run_id": body.run_id,
        "approved_values": body.approved_values,
        "action_label": "Continue",
        "action": "continue",
    })
    return {"application_id": app_id, "state": "applying"}


class SubmitRequest(BaseModel):
    run_id: str
    label: str = "Continue"


@router.post("/applications/{app_id}/submit", response_model=dict)
async def enqueue_submit(app_id: str, request: Request, body: SubmitRequest):
    """Enqueue a final submit resume (user confirmed they want to submit to SEEK)."""
    repo: SqliteApplicationRepository = request.app.state.application_repository
    queue_repo = request.app.state.queue_repository

    app = await repo.get(app_id)
    if app is None:
        raise HTTPException(status_code=404, detail="application not found")

    await repo.update_state(app_id, "submitting")
    await queue_repo.enqueue("resume", app_id, {
        "run_id": body.run_id,
        "approved_values": {},
        "action_label": body.label,
        "action": "continue",
    })
    return {"application_id": app_id, "state": "submitting"}
