"""LangGraph workflow for iterative profile interviewing."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any
from uuid import uuid4

from langgraph.graph import END, StateGraph

from app.services.profile_interview_ai import (
    assess_profile_answer_quality,
    explain_profile_question,
    interpret_profile_answer,
    plan_profile_question,
    reflect_profile_answer,
    rephrase_profile_question,
)
from app.services.profile_target import extract_voice_samples_from_answer, merge_voice_samples
from app.services.voice_profile import build_voice_profile
from app.settings import Settings
from app.state.canonical_profile import CanonicalEvidenceItem
from app.state.profile_interview import ProfileInterviewPrompt, ProfileInterviewState

QuestionPlanner = Callable[[Settings, CanonicalEvidenceItem, str, list[str]], Awaitable[dict[str, object]]]
AnswerInterpreter = Callable[[Settings, CanonicalEvidenceItem, str, str, str], Awaitable[dict[str, object]]]
AnswerAssessor = Callable[[Settings, CanonicalEvidenceItem, str, str, str], Awaitable[dict[str, object]]]
QuestionExplainer = Callable[[Settings, CanonicalEvidenceItem, str, str, str], Awaitable[dict[str, object]]]
QuestionRephraser = Callable[[Settings, CanonicalEvidenceItem, str, str, list[str]], Awaitable[dict[str, object]]]
AnswerReflector = Callable[[Settings, CanonicalEvidenceItem, str, str, str, dict[str, object]], Awaitable[dict[str, object]]]


def build_profile_interview_graph(
    settings: Settings,
    *,
    question_planner: QuestionPlanner | None = None,
    answer_interpreter: AnswerInterpreter | None = None,
    answer_assessor: AnswerAssessor | None = None,
    question_explainer: QuestionExplainer | None = None,
    question_rephraser: QuestionRephraser | None = None,
    answer_reflector: AnswerReflector | None = None,
):
    planner = question_planner or _default_question_planner
    interpreter = answer_interpreter or _default_answer_interpreter
    assessor = answer_assessor or _default_answer_assessor
    explainer = question_explainer or _default_question_explainer
    rephraser = question_rephraser or _default_question_rephraser
    reflector = answer_reflector or _default_answer_reflector

    async def dispatch(state: ProfileInterviewState) -> dict[str, Any]:
        return {}

    async def start_or_select(state: ProfileInterviewState) -> dict[str, Any]:
        if state.selected_item_id:
            requested = _find_item(state.canonical_profile, state.selected_item_id)
            if requested is not None:
                requested_gaps = _compute_gaps(requested)
                return {
                    "draft_item": requested.model_copy(deep=True),
                    "current_item_id": requested.id,
                    "selected_item_id": requested.id,
                    "open_gaps": requested_gaps,
                    "current_gap": "",
                    "current_question_id": "",
                    "current_question": "",
                    "current_prompt": ProfileInterviewPrompt(),
                    "asked_question_ids": [],
                    "status": "reviewing" if not requested_gaps else "drafting",
                    "pending_item": None,
                    "pending_voice_answer": "",
                }
        current = _find_item(state.canonical_profile, state.current_item_id)
        if current is None or state.action == "start":
            next_item = _select_next_item(
                state.canonical_profile,
                excluded_ids=state.deferred_item_ids,
            )
            if next_item is None:
                return {
                    "status": "completed",
                    "current_item_id": "",
                    "draft_item": None,
                    "open_gaps": [],
                    "current_gap": "",
                    "current_question_id": "",
                    "current_question": "",
                    "current_prompt": ProfileInterviewPrompt(),
                    "completeness_score": 1.0,
                    "overall_profile_score": _combine_profile_score(
                        completeness_score=1.0,
                        overall_answer_quality=state.overall_answer_quality_score,
                    ),
                }
            return {
                "draft_item": next_item.model_copy(deep=True),
                "current_item_id": next_item.id,
                "selected_item_id": next_item.id,
                "open_gaps": _compute_gaps(next_item),
                "asked_question_ids": [],
                "status": "reviewing" if not _compute_gaps(next_item) else state.status,
                "pending_item": None,
                "pending_voice_answer": "",
            }
        return {
            "draft_item": current.model_copy(deep=True),
            "current_item_id": current.id,
            "selected_item_id": current.id,
            "open_gaps": _compute_gaps(current),
        }

    async def diagnose_gaps(state: ProfileInterviewState) -> dict[str, Any]:
        if state.status == "completed" or state.draft_item is None:
            return {}
        gaps = _compute_gaps(state.draft_item)
        score = _completeness_score(gaps)
        updates: dict[str, Any] = {
            "open_gaps": gaps,
            "completeness_score": score,
            "overall_profile_score": _combine_profile_score(
                completeness_score=score,
                overall_answer_quality=state.overall_answer_quality_score,
            ),
        }
        if not gaps:
            updates["status"] = "reviewing"
            updates["current_gap"] = ""
            updates["current_question_id"] = ""
            updates["current_question"] = ""
            updates["current_prompt"] = ProfileInterviewPrompt()
        return updates

    async def ask_question(state: ProfileInterviewState) -> dict[str, Any]:
        if state.draft_item is None or not state.open_gaps:
            return {}
        current_gap = state.open_gaps[0]
        plan = await planner(
            settings,
            state.draft_item,
            current_gap,
            state.asked_question_ids,
        )
        question_id = f"q-{uuid4().hex[:8]}"
        question = str(plan.get("question", "")).strip()
        prompt = ProfileInterviewPrompt(
            question_id=question_id,
            question=question,
            suggested_answer=str(plan.get("suggested_answer", "")).strip(),
            source_basis=_normalize_prompt_basis(plan.get("source_basis")),
            improvement_hint=str(plan.get("improvement_hint", "")).strip(),
            mode="question",
        )
        return {
            "status": "waiting_for_user",
            "current_gap": current_gap,
            "current_question_id": question_id,
            "current_question": question,
            "current_prompt": prompt,
            "asked_question_ids": list(state.asked_question_ids) + [question_id],
        }

    async def clarify_question(state: ProfileInterviewState) -> dict[str, Any]:
        if state.draft_item is None:
            return {"status": "error", "error": "no active evidence item to clarify"}
        explanation = await explainer(
            settings,
            state.draft_item,
            state.current_gap,
            state.current_question,
            state.current_prompt.suggested_answer,
        )
        prompt = state.current_prompt.model_copy(deep=True)
        prompt.mode = "clarify"
        prompt.assistant_message = str(explanation.get("assistant_message", "")).strip()
        hint = str(explanation.get("improvement_hint", "")).strip()
        if hint:
            prompt.improvement_hint = hint
        return {"status": "waiting_for_user", "current_prompt": prompt}

    async def show_example(state: ProfileInterviewState) -> dict[str, Any]:
        prompt = state.current_prompt.model_copy(deep=True)
        prompt.mode = "example"
        if not prompt.assistant_message:
            prompt.assistant_message = (
                "Here is a cautious example answer based on the evidence already in your profile. "
                "Please edit it so it sounds like what you really mean."
            )
        return {"status": "waiting_for_user", "current_prompt": prompt}

    async def rephrase_question(state: ProfileInterviewState) -> dict[str, Any]:
        if state.draft_item is None:
            return {"status": "error", "error": "no active evidence item to rephrase"}
        plan = await rephraser(
            settings,
            state.draft_item,
            state.current_gap,
            state.current_question,
            state.asked_question_ids,
        )
        question_id = f"q-{uuid4().hex[:8]}"
        return {
            "status": "waiting_for_user",
            "current_question_id": question_id,
            "current_question": str(plan.get("question", "")).strip(),
            "current_prompt": ProfileInterviewPrompt(
                question_id=question_id,
                question=str(plan.get("question", "")).strip(),
                suggested_answer=str(plan.get("suggested_answer", "")).strip(),
                source_basis=_normalize_prompt_basis(plan.get("source_basis")),
                improvement_hint=str(plan.get("improvement_hint", "")).strip(),
                mode="question",
                assistant_message="Here is another way to ask the same thing.",
            ),
            "asked_question_ids": list(state.asked_question_ids) + [question_id],
        }

    async def apply_user_answer(state: ProfileInterviewState) -> dict[str, Any]:
        if state.draft_item is None:
            return {"status": "error", "error": "no active evidence item to update"}
        if not state.user_answer.strip():
            return {"status": "error", "error": "missing user answer"}
        interpretation = await interpreter(
            settings,
            state.draft_item,
            state.current_gap,
            state.current_question,
            state.user_answer,
        )
        assessment = await assessor(
            settings,
            state.draft_item,
            state.current_gap,
            state.current_question,
            state.user_answer,
        )
        updated_item = state.draft_item.model_copy(deep=True)
        field_updates = interpretation.get("field_updates", {})
        if isinstance(field_updates, dict):
            for field_name in ("situation", "task", "action", "outcome"):
                value = field_updates.get(field_name)
                if isinstance(value, str) and value.strip():
                    setattr(updated_item, field_name, value.strip())
            metrics = field_updates.get("metrics")
            if isinstance(metrics, list):
                updated_item.metrics = [str(metric).strip() for metric in metrics if str(metric).strip()]

        reflection = await reflector(
            settings,
            updated_item,
            state.current_gap,
            state.current_question,
            state.user_answer,
            interpretation,
        )
        prompt = ProfileInterviewPrompt(
            question_id=state.current_question_id,
            question=str(reflection.get("confirmation_question", "")).strip() or "Does that capture what you meant?",
            suggested_answer="",
            source_basis=state.current_prompt.source_basis,
            improvement_hint=state.current_prompt.improvement_hint,
            mode="reflection",
            assistant_message=str(reflection.get("assistant_message", "")).strip(),
        )

        return {
            "draft_item": updated_item,
            "pending_item": updated_item,
            "pending_voice_answer": state.user_answer,
            "last_interpretation": interpretation,
            "last_answer_assessment": assessment,
            "turn_count": state.turn_count + 1,
            "user_answer": "",
            "status": "awaiting_confirmation",
            "current_prompt": prompt,
        }

    async def confirm_current_answer(state: ProfileInterviewState) -> dict[str, Any]:
        updated_item = state.pending_item.model_copy(deep=True) if state.pending_item is not None else (
            state.draft_item.model_copy(deep=True) if state.draft_item is not None else None
        )
        if updated_item is None:
            return {"status": "error", "error": "no pending answer to confirm"}

        updated_profile = state.canonical_profile.model_copy(deep=True)
        captured_voice = extract_voice_samples_from_answer(state.pending_voice_answer or "", limit=1)
        if captured_voice:
            updated_item.tone_sample = captured_voice[0]
        _replace_profile_item(updated_profile, updated_item)
        previous_voice_samples = list(updated_profile.voice_samples)
        merged_voice_samples = merge_voice_samples(previous_voice_samples, state.pending_voice_answer or "")
        updated_profile.voice_samples = merged_voice_samples
        if merged_voice_samples != previous_voice_samples:
            updated_profile.voice_profile = await build_voice_profile(
                merged_voice_samples,
                settings=settings,
            )
        elif not updated_profile.voice_profile.tone_labels and merged_voice_samples:
            updated_profile.voice_profile = await build_voice_profile(
                merged_voice_samples,
                settings=settings,
            )

        item_quality_scores = dict(state.item_quality_scores)
        item_quality_counts = dict(state.item_quality_counts)
        if updated_item.id:
            previous_score = float(item_quality_scores.get(updated_item.id, 0.0))
            previous_count = int(item_quality_counts.get(updated_item.id, 0))
            current_score = _coerce_score(state.last_answer_assessment.score)
            new_count = previous_count + 1
            item_quality_scores[updated_item.id] = round(
                ((previous_score * previous_count) + current_score) / new_count,
                2,
            )
            item_quality_counts[updated_item.id] = new_count
        overall_answer_quality = _compute_overall_answer_quality(item_quality_scores, item_quality_counts)
        updated_gaps = _compute_gaps(updated_item)
        updated_completeness = _completeness_score(updated_gaps)

        return {
            "canonical_profile": updated_profile,
            "draft_item": updated_item,
            "pending_item": None,
            "pending_voice_answer": "",
            "item_quality_scores": item_quality_scores,
            "item_quality_counts": item_quality_counts,
            "overall_answer_quality_score": overall_answer_quality,
            "overall_profile_score": _combine_profile_score(
                completeness_score=updated_completeness,
                overall_answer_quality=overall_answer_quality,
            ),
            "status": "drafting",
            "current_prompt": ProfileInterviewPrompt(),
            "current_question": "",
            "current_question_id": "",
        }

    async def approve_current_item(state: ProfileInterviewState) -> dict[str, Any]:
        if state.draft_item is None:
            return {"status": "error", "error": "no draft item is ready for approval"}
        updated_profile = state.canonical_profile.model_copy(deep=True)
        approved = state.draft_item.model_copy(deep=True)
        approved.confidence = "approved"
        _replace_profile_item(updated_profile, approved)

        next_item = _select_next_item(
            updated_profile,
            excluded_ids=state.deferred_item_ids,
        )
        if next_item is None:
            return {
                "canonical_profile": updated_profile,
                "status": "completed",
                "current_item_id": "",
                "selected_item_id": "",
                "draft_item": None,
                "open_gaps": [],
                "current_gap": "",
                "current_question_id": "",
                "current_question": "",
                "current_prompt": ProfileInterviewPrompt(),
                "completeness_score": 1.0,
                "overall_profile_score": _combine_profile_score(
                    completeness_score=1.0,
                    overall_answer_quality=state.overall_answer_quality_score,
                ),
            }

        next_gaps = _compute_gaps(next_item)
        return {
            "canonical_profile": updated_profile,
            "draft_item": next_item.model_copy(deep=True),
            "current_item_id": next_item.id,
            "selected_item_id": next_item.id,
            "open_gaps": next_gaps,
            "current_gap": "",
            "current_question_id": "",
            "current_question": "",
            "current_prompt": ProfileInterviewPrompt(),
            "status": "reviewing" if not next_gaps else "drafting",
            "completeness_score": _completeness_score(next_gaps),
            "overall_profile_score": _combine_profile_score(
                completeness_score=_completeness_score(next_gaps),
                overall_answer_quality=state.overall_answer_quality_score,
            ),
        }

    async def defer_current_item(state: ProfileInterviewState) -> dict[str, Any]:
        updated_profile = state.canonical_profile.model_copy(deep=True)
        deferred_ids = list(state.deferred_item_ids)
        if state.draft_item is not None:
            _replace_profile_item(updated_profile, state.draft_item.model_copy(deep=True))
            if state.draft_item.id and state.draft_item.id not in deferred_ids:
                deferred_ids.append(state.draft_item.id)

        next_item = _select_next_item(updated_profile, excluded_ids=deferred_ids)
        if next_item is None:
            return {
                "canonical_profile": updated_profile,
                "deferred_item_ids": deferred_ids,
                "status": "completed",
                "current_item_id": "",
                "selected_item_id": "",
                "draft_item": None,
                "open_gaps": [],
                "current_gap": "",
                "current_question_id": "",
                "current_question": "",
                "current_prompt": ProfileInterviewPrompt(),
                "completeness_score": 1.0,
                "overall_profile_score": _combine_profile_score(
                    completeness_score=1.0,
                    overall_answer_quality=state.overall_answer_quality_score,
                ),
                "user_answer": "",
            }

        next_gaps = _compute_gaps(next_item)
        return {
            "canonical_profile": updated_profile,
            "deferred_item_ids": deferred_ids,
            "draft_item": next_item.model_copy(deep=True),
            "current_item_id": next_item.id,
            "selected_item_id": next_item.id,
            "open_gaps": next_gaps,
            "current_gap": "",
            "current_question_id": "",
            "current_question": "",
            "current_prompt": ProfileInterviewPrompt(),
            "status": "reviewing" if not next_gaps else "drafting",
            "completeness_score": _completeness_score(next_gaps),
            "overall_profile_score": _combine_profile_score(
                completeness_score=_completeness_score(next_gaps),
                overall_answer_quality=state.overall_answer_quality_score,
            ),
            "user_answer": "",
        }

    async def complete_interview(state: ProfileInterviewState) -> dict[str, Any]:
        updated_profile = state.canonical_profile.model_copy(deep=True)
        if state.draft_item is not None:
            _replace_profile_item(updated_profile, state.draft_item.model_copy(deep=True))
        return {
            "canonical_profile": updated_profile,
            "status": "completed",
            "current_item_id": "",
            "selected_item_id": "",
            "draft_item": None,
            "open_gaps": [],
            "current_gap": "",
            "current_question_id": "",
            "current_question": "",
            "current_prompt": ProfileInterviewPrompt(),
            "completeness_score": 1.0,
            "overall_profile_score": _combine_profile_score(
                completeness_score=1.0,
                overall_answer_quality=state.overall_answer_quality_score,
            ),
            "user_answer": "",
        }

    graph = StateGraph(ProfileInterviewState)
    graph.add_node("dispatch", dispatch)
    graph.add_node("start_or_select", start_or_select)
    graph.add_node("diagnose_gaps", diagnose_gaps)
    graph.add_node("ask_question", ask_question)
    graph.add_node("clarify_question", clarify_question)
    graph.add_node("show_example", show_example)
    graph.add_node("rephrase_question", rephrase_question)
    graph.add_node("apply_user_answer", apply_user_answer)
    graph.add_node("confirm_current_answer", confirm_current_answer)
    graph.add_node("approve_current_item", approve_current_item)
    graph.add_node("defer_current_item", defer_current_item)
    graph.add_node("complete_interview", complete_interview)

    graph.set_entry_point("dispatch")
    graph.add_conditional_edges(
        "dispatch",
        _route_after_dispatch,
        {
            "start": "start_or_select",
            "select": "start_or_select",
            "answer": "apply_user_answer",
            "clarify": "clarify_question",
            "example": "show_example",
            "rephrase": "rephrase_question",
            "confirm": "confirm_current_answer",
            "approve": "approve_current_item",
            "defer": "defer_current_item",
            "complete": "complete_interview",
        },
    )
    graph.add_conditional_edges(
        "start_or_select",
        _route_after_start_or_select,
        {
            "completed": END,
            "diagnose": "diagnose_gaps",
        },
    )
    graph.add_conditional_edges(
        "diagnose_gaps",
        _route_after_diagnose,
        {
            "reviewing": END,
            "ask": "ask_question",
            "completed": END,
        },
    )
    graph.add_edge("ask_question", END)
    graph.add_edge("clarify_question", END)
    graph.add_edge("show_example", END)
    graph.add_edge("rephrase_question", END)
    graph.add_edge("apply_user_answer", END)
    graph.add_edge("confirm_current_answer", "diagnose_gaps")
    graph.add_edge("approve_current_item", "diagnose_gaps")
    graph.add_edge("defer_current_item", "diagnose_gaps")
    graph.add_edge("complete_interview", END)
    return graph.compile()


async def run_profile_interview(
    settings: Settings,
    state: ProfileInterviewState,
    *,
        question_planner: QuestionPlanner | None = None,
        answer_interpreter: AnswerInterpreter | None = None,
        answer_assessor: AnswerAssessor | None = None,
        question_explainer: QuestionExplainer | None = None,
        question_rephraser: QuestionRephraser | None = None,
        answer_reflector: AnswerReflector | None = None,
) -> ProfileInterviewState:
    graph = build_profile_interview_graph(
        settings,
        question_planner=question_planner,
        answer_interpreter=answer_interpreter,
        answer_assessor=answer_assessor,
        question_explainer=question_explainer,
        question_rephraser=question_rephraser,
        answer_reflector=answer_reflector,
    )
    result = await graph.ainvoke(state.model_dump())
    return ProfileInterviewState.model_validate(result)


def _route_after_dispatch(state: ProfileInterviewState) -> str:
    if state.action == "select":
        return "select"
    if state.action == "answer":
        return "answer"
    if state.action == "clarify":
        return "clarify"
    if state.action == "example":
        return "example"
    if state.action == "rephrase":
        return "rephrase"
    if state.action == "confirm":
        return "confirm"
    if state.action == "approve":
        return "approve"
    if state.action == "defer":
        return "defer"
    if state.action == "complete":
        return "complete"
    return "start"


def _route_after_start_or_select(state: ProfileInterviewState) -> str:
    if state.status == "completed":
        return "completed"
    return "diagnose"


def _route_after_diagnose(state: ProfileInterviewState) -> str:
    if state.status == "completed":
        return "completed"
    if state.status == "reviewing":
        return "reviewing"
    return "ask"


def _select_next_item(profile, *, excluded_ids: list[str] | None = None) -> CanonicalEvidenceItem | None:
    excluded = set(excluded_ids or [])
    candidates = [
        item
        for item in profile.evidence_items
        if item.confidence != "approved" and item.id not in excluded
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda item: (0 if _compute_gaps(item) else 1, item.id))
    return candidates[0]


def _compute_gaps(item: CanonicalEvidenceItem) -> list[str]:
    gaps: list[str] = []
    if not item.situation.strip():
        gaps.append("situation")
    if not item.task.strip():
        gaps.append("task")
    if not item.outcome.strip():
        gaps.append("outcome")
    if not item.metrics:
        gaps.append("metrics")
    return gaps


def _completeness_score(gaps: list[str]) -> float:
    total = 4
    return (total - len(gaps)) / total


def _find_item(profile, item_id: str) -> CanonicalEvidenceItem | None:
    return next((item for item in profile.evidence_items if item.id == item_id), None)


def _replace_profile_item(profile, updated_item: CanonicalEvidenceItem) -> None:
    for index, item in enumerate(profile.evidence_items):
        if item.id != updated_item.id:
            continue
        profile.evidence_items[index] = updated_item
        return


def _normalize_prompt_basis(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [text for text in (str(entry).strip() for entry in value) if text][:3]


async def _default_question_planner(
    settings: Settings,
    item: CanonicalEvidenceItem,
    current_gap: str,
    asked_question_ids: list[str],
) -> dict[str, object]:
    return await plan_profile_question(
        settings,
        item=item,
        current_gap=current_gap,
        asked_question_ids=asked_question_ids,
    )


async def _default_answer_interpreter(
    settings: Settings,
    item: CanonicalEvidenceItem,
    current_gap: str,
    current_question: str,
    answer: str,
) -> dict[str, object]:
    return await interpret_profile_answer(
        settings,
        item=item,
        current_gap=current_gap,
        current_question=current_question,
        answer=answer,
    )


async def _default_answer_assessor(
    settings: Settings,
    item: CanonicalEvidenceItem,
    current_gap: str,
    current_question: str,
    answer: str,
) -> dict[str, object]:
    return await assess_profile_answer_quality(
        settings,
        item=item,
        current_gap=current_gap,
        current_question=current_question,
        answer=answer,
    )


async def _default_question_explainer(
    settings: Settings,
    item: CanonicalEvidenceItem,
    current_gap: str,
    current_question: str,
    suggested_answer: str,
) -> dict[str, object]:
    return await explain_profile_question(
        settings,
        item=item,
        current_gap=current_gap,
        current_question=current_question,
        suggested_answer=suggested_answer,
    )


async def _default_question_rephraser(
    settings: Settings,
    item: CanonicalEvidenceItem,
    current_gap: str,
    current_question: str,
    asked_question_ids: list[str],
) -> dict[str, object]:
    return await rephrase_profile_question(
        settings,
        item=item,
        current_gap=current_gap,
        current_question=current_question,
        asked_question_ids=asked_question_ids,
    )


async def _default_answer_reflector(
    settings: Settings,
    item: CanonicalEvidenceItem,
    current_gap: str,
    current_question: str,
    answer: str,
    interpretation: dict[str, object],
) -> dict[str, object]:
    return await reflect_profile_answer(
        settings,
        item=item,
        current_gap=current_gap,
        current_question=current_question,
        answer=answer,
        interpretation=interpretation,
    )


def _coerce_score(value: object) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, round(numeric, 2)))


def _compute_overall_answer_quality(
    item_quality_scores: dict[str, float],
    item_quality_counts: dict[str, int],
) -> float | None:
    if not item_quality_scores:
        return None
    weighted_total = 0.0
    total_count = 0
    for item_id, score in item_quality_scores.items():
        count = max(1, int(item_quality_counts.get(item_id, 1)))
        weighted_total += float(score) * count
        total_count += count
    if total_count == 0:
        return None
    return round(weighted_total / total_count, 2)


def _combine_profile_score(
    *,
    completeness_score: float,
    overall_answer_quality: float | None,
) -> float | None:
    if overall_answer_quality is None:
        return round(completeness_score, 2)
    return round((completeness_score * 0.4) + (overall_answer_quality * 0.6), 2)
