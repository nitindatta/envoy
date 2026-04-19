"""Profile interview API routes."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from app.services.profile_store import (
    apply_canonical_profile_to_interview_state,
    current_source_profile_path,
    load_or_build_target_profile,
    mirror_target_profile,
)
from app.state.profile_interview import (
    AnswerProfileInterviewRequest,
    ApproveProfileInterviewRequest,
    ClarifyProfileInterviewRequest,
    CompleteProfileInterviewRequest,
    ConfirmProfileInterviewRequest,
    DeferProfileInterviewRequest,
    ExampleProfileInterviewRequest,
    ProfileInterviewPrompt,
    ProfileInterviewSessionResponse,
    ProfileInterviewState,
    RephraseProfileInterviewRequest,
    SelectProfileInterviewRequest,
    StartProfileInterviewRequest,
)
from app.state.profile_state import ProfileStateSnapshot
from app.workflows.profile_interview import run_profile_interview

router = APIRouter()


@router.get("/api/profile-interview/active", response_model=ProfileInterviewSessionResponse | None)
async def get_active_profile_interview(request: Request) -> ProfileInterviewSessionResponse | None:
    repo = request.app.state.profile_interview_repository
    state = await repo.get_active()
    if state is None:
        return None
    refreshed = await _refresh_state_from_store(request, state.model_copy(deep=True))
    if refreshed.model_dump(mode="json") != state.model_dump(mode="json"):
        await repo.save_state(refreshed)
    state = refreshed
    return _response_from_state(state)


@router.post("/api/profile-interview/start", response_model=ProfileInterviewSessionResponse)
async def start_profile_interview(
    request: Request,
    body: StartProfileInterviewRequest,
) -> ProfileInterviewSessionResponse:
    repo = request.app.state.profile_interview_repository
    existing = await repo.get_active()
    if existing is not None:
        refreshed = await _refresh_state_from_store(request, existing.model_copy(deep=True))
        if refreshed.model_dump(mode="json") != existing.model_dump(mode="json"):
            await repo.save_state(refreshed)
        return _response_from_state(refreshed)

    settings = request.app.state.settings
    snapshot = await request.app.state.profile_state_repository.get()
    canonical_profile = (
        snapshot.canonical_profile if snapshot is not None else load_or_build_target_profile(settings)
    )
    if canonical_profile is None:
        raise HTTPException(status_code=404, detail="no source profile is available yet")

    source_profile_path = (
        snapshot.source_profile_path if snapshot is not None else current_source_profile_path(settings)
    )
    target_profile_path = (
        snapshot.target_profile_path
        if snapshot is not None
        else str(settings.resolved_target_profile_path)
    )
    if snapshot is None:
        await request.app.state.profile_state_repository.save(
            ProfileStateSnapshot(
                source_profile_path=source_profile_path,
                target_profile_path=target_profile_path,
                canonical_profile=canonical_profile,
            )
        )
    state = ProfileInterviewState(
        session_id=str(uuid.uuid4()),
        source_profile_path=source_profile_path,
        target_profile_path=target_profile_path,
        canonical_profile=canonical_profile,
        action="select" if body.item_id else "start",
        selected_item_id=body.item_id or "",
    )
    state = await run_profile_interview(settings, state)
    await repo.create(state)
    await _persist_draft_snapshot(repo, state)
    return _response_from_state(state)


@router.post("/api/profile-interview/{session_id}/select", response_model=ProfileInterviewSessionResponse)
async def select_profile_interview_item(
    session_id: str,
    request: Request,
    body: SelectProfileInterviewRequest,
) -> ProfileInterviewSessionResponse:
    repo = request.app.state.profile_interview_repository
    existing = await repo.get(session_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="profile interview session not found")

    state = existing.model_copy(deep=True)
    state = await _refresh_state_from_store(request, state)
    state.action = "select"
    state.selected_item_id = body.item_id
    state.error = None
    updated = await run_profile_interview(request.app.state.settings, state)

    await repo.save_state(updated)
    await _persist_draft_snapshot(repo, updated)
    return _response_from_state(updated)


@router.post("/api/profile-interview/{session_id}/answer", response_model=ProfileInterviewSessionResponse)
async def answer_profile_interview(
    session_id: str,
    request: Request,
    body: AnswerProfileInterviewRequest,
) -> ProfileInterviewSessionResponse:
    repo = request.app.state.profile_interview_repository
    existing = await repo.get(session_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="profile interview session not found")

    state = existing.model_copy(deep=True)
    state = await _refresh_state_from_store(request, state)
    state.action = "answer"
    state.user_answer = body.answer
    state.error = None
    updated = await run_profile_interview(request.app.state.settings, state)

    await repo.record_turn(
        session_id=updated.session_id,
        item_id=updated.current_item_id or existing.current_item_id,
        question_id=existing.current_question_id,
        question_text=existing.current_question,
        user_answer=body.answer,
        interpreted_answer=updated.last_interpretation,
    )
    await repo.save_state(updated)
    await _persist_draft_snapshot(repo, updated)
    return _response_from_state(updated)


@router.post("/api/profile-interview/{session_id}/clarify", response_model=ProfileInterviewSessionResponse)
async def clarify_profile_interview_question(
    session_id: str,
    request: Request,
    body: ClarifyProfileInterviewRequest,
) -> ProfileInterviewSessionResponse:
    del body
    repo = request.app.state.profile_interview_repository
    existing = await repo.get(session_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="profile interview session not found")

    state = existing.model_copy(deep=True)
    state = await _refresh_state_from_store(request, state)
    state.action = "clarify"
    state.error = None
    updated = await run_profile_interview(request.app.state.settings, state)
    await repo.save_state(updated)
    return _response_from_state(updated)


@router.post("/api/profile-interview/{session_id}/example", response_model=ProfileInterviewSessionResponse)
async def example_profile_interview_question(
    session_id: str,
    request: Request,
    body: ExampleProfileInterviewRequest,
) -> ProfileInterviewSessionResponse:
    del body
    repo = request.app.state.profile_interview_repository
    existing = await repo.get(session_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="profile interview session not found")

    state = existing.model_copy(deep=True)
    state = await _refresh_state_from_store(request, state)
    state.action = "example"
    state.error = None
    updated = await run_profile_interview(request.app.state.settings, state)
    await repo.save_state(updated)
    return _response_from_state(updated)


@router.post("/api/profile-interview/{session_id}/rephrase", response_model=ProfileInterviewSessionResponse)
async def rephrase_profile_interview_question_route(
    session_id: str,
    request: Request,
    body: RephraseProfileInterviewRequest,
) -> ProfileInterviewSessionResponse:
    del body
    repo = request.app.state.profile_interview_repository
    existing = await repo.get(session_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="profile interview session not found")

    state = existing.model_copy(deep=True)
    state = await _refresh_state_from_store(request, state)
    state.action = "rephrase"
    state.error = None
    updated = await run_profile_interview(request.app.state.settings, state)
    await repo.save_state(updated)
    return _response_from_state(updated)


@router.post("/api/profile-interview/{session_id}/confirm", response_model=ProfileInterviewSessionResponse)
async def confirm_profile_interview_answer(
    session_id: str,
    request: Request,
    body: ConfirmProfileInterviewRequest,
) -> ProfileInterviewSessionResponse:
    del body
    repo = request.app.state.profile_interview_repository
    existing = await repo.get(session_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="profile interview session not found")

    state = existing.model_copy(deep=True)
    state = await _refresh_state_from_store(request, state)
    state.action = "confirm"
    state.error = None
    updated = await run_profile_interview(request.app.state.settings, state)

    await _save_profile_state_snapshot(request, updated)
    await repo.save_state(updated)
    await _persist_draft_snapshot(repo, updated)
    return _response_from_state(updated)


@router.post("/api/profile-interview/{session_id}/approve", response_model=ProfileInterviewSessionResponse)
async def approve_profile_interview_item(
    session_id: str,
    request: Request,
    body: ApproveProfileInterviewRequest,
) -> ProfileInterviewSessionResponse:
    del body
    repo = request.app.state.profile_interview_repository
    existing = await repo.get(session_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="profile interview session not found")

    state = existing.model_copy(deep=True)
    state = await _refresh_state_from_store(request, state)
    state.action = "approve"
    state.error = None
    updated = await run_profile_interview(request.app.state.settings, state)

    await _save_profile_state_snapshot(request, updated)
    await repo.save_state(updated)
    await _persist_draft_snapshot(repo, updated)
    return _response_from_state(updated)


@router.post("/api/profile-interview/{session_id}/defer", response_model=ProfileInterviewSessionResponse)
async def defer_profile_interview_item(
    session_id: str,
    request: Request,
    body: DeferProfileInterviewRequest,
) -> ProfileInterviewSessionResponse:
    del body
    repo = request.app.state.profile_interview_repository
    existing = await repo.get(session_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="profile interview session not found")

    state = existing.model_copy(deep=True)
    state = await _refresh_state_from_store(request, state)
    state.action = "defer"
    state.error = None
    updated = await run_profile_interview(request.app.state.settings, state)

    await _save_profile_state_snapshot(request, updated)
    await repo.save_state(updated)
    await _persist_draft_snapshot(repo, updated)
    return _response_from_state(updated)


@router.post("/api/profile-interview/{session_id}/complete", response_model=ProfileInterviewSessionResponse)
async def complete_profile_interview(
    session_id: str,
    request: Request,
    body: CompleteProfileInterviewRequest,
) -> ProfileInterviewSessionResponse:
    del body
    repo = request.app.state.profile_interview_repository
    existing = await repo.get(session_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="profile interview session not found")

    state = existing.model_copy(deep=True)
    state = await _refresh_state_from_store(request, state)
    state.action = "complete"
    state.error = None
    updated = await run_profile_interview(request.app.state.settings, state)

    await _save_profile_state_snapshot(request, updated)
    await repo.save_state(updated)
    await _persist_draft_snapshot(repo, updated)
    return _response_from_state(updated)


def _response_from_state(state: ProfileInterviewState) -> ProfileInterviewSessionResponse:
    approved_items = sum(
        1 for item in state.canonical_profile.evidence_items if item.confidence == "approved"
    )
    return ProfileInterviewSessionResponse(
        session_id=state.session_id,
        status=state.status,
        source_profile_path=state.source_profile_path,
        target_profile_path=state.target_profile_path,
        current_item_id=state.current_item_id,
        draft_item=state.draft_item,
        open_gaps=state.open_gaps,
        current_gap=state.current_gap,
        current_question_id=state.current_question_id,
        current_question=state.current_question,
        current_prompt=state.current_prompt or ProfileInterviewPrompt(),
        pending_item=state.pending_item,
        last_answer_assessment=state.last_answer_assessment,
        item_quality_scores=state.item_quality_scores,
        completeness_score=state.completeness_score,
        overall_answer_quality_score=state.overall_answer_quality_score,
        overall_profile_score=state.overall_profile_score,
        approved_items=approved_items,
        total_items=len(state.canonical_profile.evidence_items),
        error=state.error,
    )


async def _persist_draft_snapshot(repo, state: ProfileInterviewState) -> None:
    if state.draft_item is None or not state.current_item_id:
        return
    await repo.record_draft(
        session_id=state.session_id,
        item_id=state.current_item_id,
        status=state.status,
        completeness_score=state.completeness_score,
        item_json=state.draft_item.model_dump_json(),
        gap_summary_json=json.dumps(state.open_gaps),
    )


async def _load_profile_snapshot_or_build(request: Request) -> ProfileStateSnapshot | None:
    settings = request.app.state.settings
    snapshot = await request.app.state.profile_state_repository.get()
    if snapshot is not None:
        return snapshot

    profile = load_or_build_target_profile(settings)
    if profile is None:
        return None

    snapshot = ProfileStateSnapshot(
        source_profile_path=current_source_profile_path(settings),
        target_profile_path=str(settings.resolved_target_profile_path),
        canonical_profile=profile,
    )
    return snapshot


async def _refresh_state_from_store(
    request: Request,
    state: ProfileInterviewState,
) -> ProfileInterviewState:
    snapshot = await _load_profile_snapshot_or_build(request)
    if snapshot is None:
        return state

    apply_canonical_profile_to_interview_state(
        state,
        canonical_profile=snapshot.canonical_profile,
        source_profile_path=snapshot.source_profile_path,
        target_profile_path=snapshot.target_profile_path,
    )
    return state


async def _save_profile_state_snapshot(request: Request, state: ProfileInterviewState) -> None:
    snapshot = ProfileStateSnapshot(
        source_profile_path=state.source_profile_path,
        target_profile_path=state.target_profile_path,
        canonical_profile=state.canonical_profile,
    )
    await request.app.state.profile_state_repository.save(snapshot)
    mirror_target_profile(Path(state.target_profile_path), state.canonical_profile)
