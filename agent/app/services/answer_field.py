"""AI field proposer — maps form fields to values using profile, memory, and LLM.

Resolution order per design.md §7.1:
  1. Profile lookup (name, email, phone, work rights, location)
  2. Memory lookup (question_answers table by question_fingerprint)
  3. LLM call (only for fields not resolved above)
  4. Pause (interrupt) if LLM confidence is low
"""

from __future__ import annotations

import hashlib
import json
import logging

from openai import AsyncOpenAI

from app.settings import Settings
from app.state.apply import FieldInfo

log = logging.getLogger("answer_field")


# ── 1. Profile lookup ──────────────────────────────────────────────────────

_PROFILE_FIELD_MAP = {
    # Common SEEK field labels → profile keys
    "first name": lambda p: p.get("name", "").split()[0] if p.get("name") else "",
    "last name": lambda p: p.get("name", "").split()[-1] if p.get("name") else "",
    "full name": lambda p: p.get("name", ""),
    "name": lambda p: p.get("name", ""),
    "email": lambda p: p.get("contact", {}).get("email", ""),
    "email address": lambda p: p.get("contact", {}).get("email", ""),
    "phone": lambda p: p.get("contact", {}).get("phone", ""),
    "phone number": lambda p: p.get("contact", {}).get("phone", ""),
    "mobile": lambda p: p.get("contact", {}).get("phone", ""),
    "location": lambda p: p.get("location", ""),
    "city": lambda p: p.get("location", "").split(",")[0].strip() if p.get("location") else "",
    "right to work": lambda p: p.get("work_rights", ""),
    "work rights": lambda p: p.get("work_rights", ""),
    "right to work in australia": lambda p: p.get("work_rights", ""),
    "salary": lambda p: p.get("salary_expectation", ""),
    "salary expectation": lambda p: p.get("salary_expectation", ""),
    "expected salary": lambda p: p.get("salary_expectation", ""),
    "notice period": lambda p: p.get("notice_period", ""),
    "availability": lambda p: p.get("notice_period", ""),
    "cover letter": None,  # handled separately
}


def _skills_set(profile: dict) -> set[str]:
    """All skill names from profile in lowercase for fast lookup."""
    skills = profile.get("core_strengths", [])
    # Also pull from experience highlights for broader coverage
    extra = []
    for exp in profile.get("experience", []):
        extra.extend(exp.get("technologies", []))
        extra.extend(exp.get("skills", []))
    return {s.lower() for s in skills + extra}


def _lookup_from_profile(field: FieldInfo, profile: dict) -> str | None:
    label_lower = field.label.lower().strip()
    for key, resolver in _PROFILE_FIELD_MAP.items():
        if key in label_lower and resolver is not None:
            value = resolver(profile)
            if not value:
                return None
            # For select fields, validate the value matches one of the available options.
            # If not, return None so the caller falls through to LLM with the options context.
            if field.field_type == "select" and field.options:
                options_lower = [o.lower() for o in field.options]
                if value.lower() not in options_lower:
                    log.debug(
                        "[profile] select value %r not in options for label=%r — falling through",
                        value, field.label,
                    )
                    return None
            return value
    return None


# ── 2. Memory lookup ───────────────────────────────────────────────────────

def _question_fingerprint(text: str) -> str:
    return hashlib.md5(text.lower().strip().encode()).hexdigest()


async def _lookup_from_memory(
    field: FieldInfo, conn
) -> str | None:
    """Look up a previously approved answer from question_answers table."""
    fingerprint = _question_fingerprint(field.label)
    async with conn.execute(
        "SELECT answer_text FROM question_answers WHERE question_fingerprint = ? "
        "AND approved_by_user = 1 ORDER BY last_used_at DESC LIMIT 1",
        (fingerprint,),
    ) as cur:
        row = await cur.fetchone()
    return row[0] if row else None


# ── 3. LLM call ────────────────────────────────────────────────────────────

async def _resolve_via_llm(
    field: FieldInfo,
    profile: dict,
    settings: Settings,
    cover_letter: str,
) -> tuple[str, float]:
    """Returns (answer, confidence) where confidence is 0.0–1.0."""
    client = AsyncOpenAI(base_url=settings.openai_base_url, api_key=settings.openai_api_key)

    options_text = ""
    if field.options:
        options_list = "\n".join(f"  - {o}" for o in field.options)
        options_text = f"\nOptions:\n{options_list}"

    is_radio_group = field.field_type == "radio" and bool(field.options)
    radio_instruction = (
        "This is a radio button group. You must pick EXACTLY ONE option from the list above. "
        "Return the exact text of the chosen option as the answer. "
        "Pick the option most appropriate for the candidate."
    ) if is_radio_group else ""

    # Build a richer profile block so the LLM can answer screening questions accurately
    exp_lines = []
    for exp in profile.get("experience", [])[:4]:
        techs = exp.get("technologies", []) + exp.get("skills", [])
        line = f"- {exp.get('title','')} at {exp.get('company','')} ({exp.get('period','')})"
        if techs:
            line += f": {', '.join(techs[:8])}"
        exp_lines.append(line)
    experience_block = "\n".join(exp_lines) or "Not provided"

    skills_block = ", ".join(profile.get("core_strengths", []))
    narrative_block = "\n".join(
        f"- {s}" for s in profile.get("narrative_strengths", [])[:5]
    )

    system = (
        "You are filling out a job application form on behalf of a candidate. "
        "Answer each question accurately based solely on the candidate's profile below. "
        "For yes/no or radio questions: pick the option that is most truthful given the candidate's experience. "
        "If the candidate clearly does NOT have the stated experience, answer 'No'. "
        "Set confidence < 0.6 if you are genuinely unsure. "
        "Return JSON only: {\"answer\": \"...\", \"confidence\": 0.0-1.0}"
    )
    user = f"""Form field: {field.label}
Field type: {field.field_type}{options_text}
Required: {field.required}
{radio_instruction}

Candidate profile:
Name: {profile.get('name')}
Location: {profile.get('location')}
Summary: {profile.get('summary', '')[:300]}

Experience:
{experience_block}

Skills: {skills_block}

Key achievements:
{narrative_block}

Cover letter excerpt: {cover_letter[:400] if cover_letter else 'N/A'}

Answer this field truthfully for the candidate. Return only JSON."""

    response = await client.chat.completions.create(
        model=settings.openai_model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0.2,
        max_tokens=200,
    )
    raw = response.choices[0].message.content or "{}"
    try:
        parsed = json.loads(raw)
        return str(parsed.get("answer", "")), float(parsed.get("confidence", 0.5))
    except (json.JSONDecodeError, ValueError):
        return raw.strip(), 0.3


# ── Public API ─────────────────────────────────────────────────────────────

LOW_CONFIDENCE_THRESHOLD = 0.6


async def propose_field_values(
    fields: list[FieldInfo],
    profile: dict,
    cover_letter: str,
    settings: Settings,
    db_conn,
) -> tuple[dict[str, str], list[str]]:
    """
    Returns (proposed_values, low_confidence_ids).

    proposed_values: {field_id: proposed_value} for all fields
    low_confidence_ids: field ids where LLM confidence < threshold → trigger interrupt
    """
    proposed: dict[str, str] = {}
    low_confidence: list[str] = []

    log.info("[propose_field_values] resolving %d fields", len(fields))

    for field in fields:
        if field.field_type == "file":
            log.debug("[field:%s] type=file — skipped", field.id)
            continue

        label_lower = field.label.lower()

        # Cover letter textarea
        if "cover letter" in label_lower and field.field_type == "textarea":
            proposed[field.id] = cover_letter
            log.debug("[field:%s] label=%r → cover_letter (%d words)", field.id, field.label, len(cover_letter.split()))
            continue

        # Radio groups: cover letter → force "Write a cover letter"
        if field.field_type == "radio":
            if "cover letter" in label_lower and field.options:
                write_opt = next((o for o in field.options if "write" in o.lower()), None)
                if write_opt:
                    proposed[field.id] = write_opt
                    log.debug("[field:%s] label=%r → radio force=%r", field.id, field.label, write_opt)
                    continue
            # If already has a pre-selected value, keep it (SEEK sometimes pre-fills)
            if field.current_value:
                proposed[field.id] = field.current_value
                log.debug("[field:%s] label=%r → radio keep default=%r", field.id, field.label, field.current_value)
                continue
            # No default — screening question, must answer via LLM (fall through below)

        # 1. Profile lookup
        value = _lookup_from_profile(field, profile)
        if value:
            proposed[field.id] = value
            log.debug("[field:%s] label=%r → profile value=%r", field.id, field.label, value)
            continue

        # 2. Memory lookup
        value = await _lookup_from_memory(field, db_conn)
        if value:
            proposed[field.id] = value
            log.debug("[field:%s] label=%r → memory value=%r", field.id, field.label, value)
            continue

        # 2b. Skill checkbox — resolve Yes/No directly from profile skills (no LLM)
        if field.field_type == "checkbox":
            known = _skills_set(profile)
            answer = "Yes" if label_lower.strip() in known else "No"
            proposed[field.id] = answer
            log.debug("[field:%s] label=%r → skill_check=%r", field.id, field.label, answer)
            continue

        # 3. LLM
        value, confidence = await _resolve_via_llm(field, profile, settings, cover_letter)
        proposed[field.id] = value
        if confidence < LOW_CONFIDENCE_THRESHOLD:
            low_confidence.append(field.id)
            log.info("[field:%s] label=%r → LLM LOW_CONF=%.2f value=%r", field.id, field.label, confidence, value)
        else:
            log.debug("[field:%s] label=%r → LLM conf=%.2f value=%r", field.id, field.label, confidence, value)

    log.info("[propose_field_values] done: proposed=%d low_confidence=%s", len(proposed), low_confidence)
    return proposed, low_confidence
