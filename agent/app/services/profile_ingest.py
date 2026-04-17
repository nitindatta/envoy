"""Profile upload, extraction, and raw-profile construction."""

from __future__ import annotations

import hashlib
import html
import json
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.settings import Settings
from app.state.raw_profile import (
    RawProfile,
    RawProfileBullet,
    RawProfileExperience,
    RawProfileIdentity,
    RawProfileProject,
    SourceDocument,
)

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"(\+?\d[\d\s()-]{7,}\d)")
_YEARISH_RE = re.compile(r"(19|20)\d{2}")
_MONTH_YEAR_RANGE_RE = re.compile(
    r"([A-Z][a-z]+ \d{4}\s*[-–—]\s*(?:[A-Z][a-z]+ \d{4}|Present))(?:\s*\(([^)]+)\))?$"
)
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_KNOWN_SECTION_HEADINGS = {
    "about": "about",
    "certifications": "certifications",
    "core skills": "core skills",
    "education": "education",
    "experience": "experience",
    "key skills": "key skills",
    "licenses": "licenses",
    "professional experience": "professional experience",
    "profile": "profile",
    "projects": "projects",
    "selected projects": "selected projects",
    "skills": "skills",
    "summary": "summary",
    "technical skills": "technical skills",
    "top skills": "top skills",
    "work experience": "work experience",
    "earlier experience": "earlier experience",
}
_TITLE_ENDINGS = {
    "engineer",
    "architect",
    "officer",
    "manager",
    "developer",
    "analyst",
    "lead",
    "consultant",
    "specialist",
    "president",
    "programmer",
}
_TITLE_PREFIXES = {
    "chief",
    "technology",
    "technical",
    "senior",
    "solutions",
    "solution",
    "enterprise",
    "product",
    "data",
    "software",
    "blockchain",
    "iot",
    "ecommerce",
    "vice",
    "principal",
    "cloud",
    "machine",
    "learning",
}


class ProfileIngestError(Exception):
    pass


@dataclass
class ExtractedProfileArtifacts:
    source_document: SourceDocument
    raw_profile: RawProfile


def persist_uploaded_file(
    settings: Settings,
    *,
    filename: str,
    content_type: str,
    content: bytes,
) -> tuple[SourceDocument, Path]:
    upload_id = uuid.uuid4().hex
    safe_name = _sanitize_filename(filename or "upload.bin")
    upload_dir = settings.resolved_profile_upload_dir / upload_id
    upload_dir.mkdir(parents=True, exist_ok=True)

    saved_path = upload_dir / safe_name
    saved_path.write_bytes(content)
    sha256 = hashlib.sha256(content).hexdigest()

    source_document = SourceDocument(
        id=upload_id,
        filename=safe_name,
        mime_type=content_type or _guess_mime_type(saved_path.suffix.lower()),
        saved_path=str(saved_path),
        sha256=sha256,
    )
    return source_document, upload_dir


def extract_profile_from_saved_file(
    settings: Settings,
    source_document: SourceDocument,
) -> ExtractedProfileArtifacts:
    saved_path = Path(source_document.saved_path)
    suffix = saved_path.suffix.lower()

    if suffix == ".json":
        raw_data = json.loads(saved_path.read_text(encoding="utf-8"))
        raw_profile = build_raw_profile_from_legacy_json(raw_data, source_document)
        source_document.parse_status = "success"
        return ExtractedProfileArtifacts(source_document=source_document, raw_profile=raw_profile)

    markdown = _extract_markdown(saved_path)
    markdown_path = saved_path.with_suffix(".md")
    markdown_path.write_text(markdown, encoding="utf-8")
    source_document.extracted_text_path = str(markdown_path)
    source_document.extracted_markdown_path = str(markdown_path)
    source_document.parse_status = "success"

    raw_profile = build_raw_profile_from_markdown(markdown, source_document)
    return ExtractedProfileArtifacts(source_document=source_document, raw_profile=raw_profile)


def save_raw_profile(settings: Settings, raw_profile: RawProfile) -> Path:
    path = settings.resolved_raw_profile_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(raw_profile.model_dump_json(indent=2), encoding="utf-8")
    return path


def load_raw_profile(settings: Settings) -> RawProfile | None:
    path = settings.resolved_raw_profile_path
    if not path.exists():
        return None
    return RawProfile.model_validate_json(path.read_text(encoding="utf-8"))


def build_raw_profile_from_legacy_json(
    legacy: dict[str, Any],
    source_document: SourceDocument,
) -> RawProfile:
    contact = legacy.get("contact", {}) if isinstance(legacy.get("contact"), dict) else {}
    experience: list[RawProfileExperience] = []
    for index, exp in enumerate(legacy.get("experience", []), start=1):
        if not isinstance(exp, dict):
            continue
        bullets = [
            RawProfileBullet(text=text, source_excerpt=text, confidence="high")
            for text in _clean_list(exp.get("highlights", []))
        ]
        combined = "\n".join([b.text for b in bullets] + _clean_list(exp.get("metrics", [])))
        experience.append(
            RawProfileExperience(
                id=_slug(f"{exp.get('company', '')}-{exp.get('title', '')}") or f"exp_{index:03d}",
                title=str(exp.get("title", "")).strip(),
                company=str(exp.get("company", "")).strip(),
                period_raw=str(exp.get("period", "")).strip(),
                bullets=bullets,
                metrics=_clean_list(exp.get("metrics", [])),
                technologies=_infer_technologies(
                    combined,
                    _clean_list(legacy.get("core_strengths", [])),
                ),
            )
        )

    projects: list[RawProfileProject] = []
    for index, project in enumerate(legacy.get("selected_projects", []), start=1):
        if not isinstance(project, dict):
            continue
        summary = str(project.get("summary", "")).strip()
        projects.append(
            RawProfileProject(
                id=_slug(project.get("name", "")) or f"proj_{index:03d}",
                name=str(project.get("name", "")).strip(),
                summary=summary,
                bullets=[RawProfileBullet(text=summary, source_excerpt=summary, confidence="high")] if summary else [],
                technologies=_infer_technologies(
                    summary,
                    _clean_list(legacy.get("core_strengths", [])),
                ),
            )
        )

    return RawProfile(
        source_documents=[source_document],
        identity=RawProfileIdentity(
            name=str(legacy.get("name", "")).strip(),
            headline=str(legacy.get("headline", "")).strip(),
            email=str(contact.get("email", "")).strip(),
            phone=str(contact.get("phone", "")).strip(),
            location=str(legacy.get("location", "")).strip(),
        ),
        summary=str(legacy.get("summary", "")).strip(),
        experience=experience,
        projects=projects,
        skills=_clean_list(legacy.get("core_strengths", [])),
        education=_clean_list(legacy.get("education", [])),
        certifications=_clean_list(legacy.get("certifications", [])),
        writing_samples=_clean_list(legacy.get("writing_samples", [])),
    )


def build_raw_profile_from_markdown(
    markdown: str,
    source_document: SourceDocument,
) -> RawProfile:
    markdown = _normalize_extracted_markdown(markdown)
    lines = [line.rstrip() for line in markdown.splitlines()]
    sections, preamble = _sectionize_markdown(lines)
    full_text = "\n".join(lines)

    email = _EMAIL_RE.search(full_text)
    name, headline = _extract_identity_lines(
        preamble,
        lines=lines,
        email=email.group(0) if email else "",
    )
    email = _EMAIL_RE.search(full_text)
    phone = _extract_phone(preamble)
    location = _extract_location_line(preamble)

    summary = _extract_summary(sections, preamble)
    skills = _extract_listish_values(
        sections,
        ("skills", "top skills", "key skills", "technical skills", "core skills"),
    )
    education = _extract_line_values(sections, ("education",))
    certifications = _extract_line_values(sections, ("certifications", "licenses"))
    experience = _parse_experience_sections(sections, skills)
    projects = _parse_project_sections(sections, skills)

    parse_notes: list[str] = []
    if not experience:
        parse_notes.append("Could not confidently segment experience entries from extracted document.")
    if not skills:
        parse_notes.append("Could not confidently extract a skills section from extracted document.")

    return RawProfile(
        source_documents=[source_document],
        identity=RawProfileIdentity(
            name=name,
            headline=headline,
            email=email.group(0) if email else "",
            phone=phone,
            location=location,
        ),
        summary=summary,
        experience=experience,
        projects=projects,
        skills=skills,
        education=education,
        certifications=certifications,
        parse_notes=parse_notes,
    )


def _extract_markdown(path: Path) -> str:
    try:
        from docling.document_converter import DocumentConverter
    except ImportError as exc:  # pragma: no cover - depends on runtime env
        raise ProfileIngestError(
            "Docling is not installed. Run `uv sync` in the agent directory to enable PDF/DOCX parsing."
        ) from exc

    converter = DocumentConverter()
    result = converter.convert(path, raises_on_error=False)
    if getattr(result, "document", None) is None:
        errors = getattr(result, "errors", None)
        raise ProfileIngestError(f"Docling could not extract {path.name}: {errors or 'unknown error'}")
    return result.document.export_to_markdown()


def _normalize_extracted_markdown(markdown: str) -> str:
    normalized = html.unescape(markdown)
    replacements = {
        "â€™": "'",
        "â€œ": '"',
        "â€\x9d": '"',
        "â€”": "-",
        "â€“": "-",
        "â€¢": "•",
        "\xa0": " ",
    }
    for source, target in replacements.items():
        normalized = normalized.replace(source, target)
    return normalized


def _sectionize_markdown(lines: list[str]) -> tuple[dict[str, list[str]], list[str]]:
    sections: dict[str, list[str]] = {}
    current_key: str | None = None
    preamble: list[str] = []

    for raw_line in lines:
        line = raw_line.strip()
        heading_text = _extract_heading_text(line)
        canonical_heading = _canonicalize_heading(heading_text) if heading_text else None
        if canonical_heading:
            current_key = canonical_heading
            sections.setdefault(current_key, [])
            continue
        if heading_text and current_key is None:
            preamble.append(heading_text)
        elif current_key is None:
            preamble.append(line)
        else:
            sections[current_key].append(line)
    return sections, [line for line in preamble if line]


def _extract_heading_text(line: str) -> str | None:
    if not line:
        return None
    match = _HEADING_RE.match(line)
    if not match:
        return None
    return match.group(2).strip()


def _canonicalize_heading(heading_text: str | None) -> str | None:
    if not heading_text:
        return None
    return _KNOWN_SECTION_HEADINGS.get(heading_text.strip().lower())


def _extract_identity_lines(
    preamble: list[str],
    *,
    lines: list[str],
    email: str,
) -> tuple[str, str]:
    meaningful = [
        line
        for line in preamble
        if line
        and "@" not in line
        and not _PHONE_RE.search(line)
    ]
    name = ""
    headline = ""
    if meaningful:
        if _looks_like_person_name(meaningful[0]):
            name = meaningful[0]
            headline = meaningful[1] if len(meaningful) > 1 else ""
        else:
            headline = meaningful[0]

    inferred_name = _infer_name_from_document(lines, email=email)
    if inferred_name:
        name = inferred_name
    if headline and name and headline == name:
        headline = ""
    return name.strip(), headline.strip()


def _extract_location_line(preamble: list[str]) -> str:
    for line in preamble:
        if "@" in line:
            parts = [part.strip() for part in line.split("|")]
            for part in reversed(parts):
                lowered = part.lower()
                if "github" in lowered or "linkedin" in lowered or lowered.startswith("http"):
                    continue
                if "@" in part or _PHONE_RE.search(part):
                    continue
                if part:
                    return part
    meaningful = [
        line
        for line in preamble
        if line
        and "@" not in line
        and not _PHONE_RE.search(line)
    ]
    if len(meaningful) >= 3:
        return meaningful[2].strip()
    return ""


def _extract_phone(preamble: list[str]) -> str:
    for line in preamble[:5]:
        match = _PHONE_RE.search(line)
        if match and sum(char.isdigit() for char in match.group(0)) >= 9:
            return match.group(0).strip()
    return ""


def _infer_name_from_document(lines: list[str], *, email: str) -> str:
    email_tokens = [
        token
        for token in re.split(r"[^a-z]+", email.split("@", 1)[0].lower())
        if len(token) > 1
    ]
    if len(email_tokens) < 2:
        return ""

    for raw_line in lines:
        line = _extract_heading_text(raw_line.strip()) or raw_line.strip()
        if not line:
            continue
        lowered = line.lower()
        if any(token not in lowered for token in email_tokens):
            continue
        if _looks_like_person_name(line):
            return line.strip()
    return ""


def _looks_like_person_name(value: str) -> bool:
    cleaned = value.strip().strip("#").strip()
    if not cleaned or any(char.isdigit() for char in cleaned):
        return False
    if "@" in cleaned or "linkedin" in cleaned.lower() or "http" in cleaned.lower():
        return False
    words = [word for word in re.split(r"\s+", cleaned) if word]
    if not 2 <= len(words) <= 4:
        return False
    return all(word[0].isupper() for word in words if word[0].isalpha())


def _extract_summary(sections: dict[str, list[str]], preamble: list[str]) -> str:
    for key in ("summary", "profile", "about"):
        if key in sections:
            paragraph = " ".join(line for line in sections[key] if line and not line.startswith("-")).strip()
            if paragraph:
                return paragraph
    fallback = [
        line for line in preamble[2:]
        if line and "@" not in line and not _PHONE_RE.search(line)
    ]
    return " ".join(fallback[:2]).strip()


def _extract_listish_values(sections: dict[str, list[str]], keys: tuple[str, ...]) -> list[str]:
    for key in keys:
        if key not in sections:
            continue
        items: list[str] = []
        for line in sections[key]:
            cleaned = _strip_bullet(line)
            if not cleaned:
                continue
            if ":" in cleaned:
                _label, remainder = cleaned.split(":", 1)
                if "," in remainder:
                    items.extend(part.strip() for part in remainder.split(",") if part.strip())
                    continue
            if "," in cleaned:
                items.extend(part.strip() for part in cleaned.split(",") if part.strip())
            else:
                items.append(cleaned)
        unique = _unique(items)
        if unique:
            return unique
    return []


def _extract_line_values(sections: dict[str, list[str]], keys: tuple[str, ...]) -> list[str]:
    for key in keys:
        if key not in sections:
            continue
        values = [
            _strip_bullet(line)
            for line in sections[key]
            if _strip_bullet(line) and not line.strip().startswith("#")
        ]
        if values:
            return _unique(values)
    return []


def _parse_experience_sections(
    sections: dict[str, list[str]],
    skills: list[str],
) -> list[RawProfileExperience]:
    lines = _collect_section_lines(
        sections,
        ("experience", "professional experience", "work experience", "earlier experience"),
    )
    if not lines:
        return []

    entries: list[RawProfileExperience] = []
    current_header = ""
    current_lines: list[str] = []

    def flush() -> None:
        nonlocal current_header, current_lines
        if not current_header and not current_lines:
            return
        title, company, period_raw = _parse_role_header(current_header)
        bullets = [
            RawProfileBullet(text=_strip_bullet(line), source_excerpt=line, confidence="medium")
            for line in current_lines
            if _strip_bullet(line)
        ]
        combined = "\n".join([current_header] + [b.text for b in bullets])
        metrics = [bullet.text for bullet in bullets if _looks_like_metric(bullet.text)]
        entries.append(
            RawProfileExperience(
                id=_slug(f"{company}-{title}") or _slug(current_header) or f"exp_{len(entries) + 1:03d}",
                title=title,
                company=company,
                period_raw=period_raw,
                bullets=bullets,
                metrics=metrics,
                technologies=_infer_technologies(combined, skills),
            )
        )
        current_header = ""
        current_lines = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("## "):
            flush()
            current_header = stripped.lstrip("#").strip()
            continue
        if not current_header and not stripped.startswith(("-", "*", "•")):
            current_header = stripped
            continue
        if current_header and not current_lines and _looks_like_period_line(stripped):
            current_header = f"{current_header} {stripped}".strip()
            continue
        if current_header and not current_lines and _header_has_period(current_header) and _split_company_and_title(stripped)[1]:
            flush()
            current_header = stripped
            continue
        if _looks_like_experience_header(stripped):
            flush()
            current_header = stripped.lstrip("#").strip()
            continue
        current_lines.append(stripped)

    flush()
    return [entry for entry in entries if entry.title or entry.company or entry.bullets]


def _parse_project_sections(
    sections: dict[str, list[str]],
    skills: list[str],
) -> list[RawProfileProject]:
    lines = _collect_section_lines(sections, ("projects", "selected projects"))
    if not lines:
        return []

    projects: list[RawProfileProject] = []
    current_header = ""
    current_lines: list[str] = []

    def flush() -> None:
        nonlocal current_header, current_lines
        if not current_header and not current_lines:
            return
        name, inline_summary = _parse_project_header(current_header)
        bullets = [
            RawProfileBullet(text=_strip_bullet(line), source_excerpt=line, confidence="medium")
            for line in current_lines
            if _strip_bullet(line)
        ]
        if inline_summary:
            bullets = [RawProfileBullet(text=inline_summary, source_excerpt=current_header, confidence="medium")] + bullets
        summary = " ".join(bullet.text for bullet in bullets[:2]).strip() or inline_summary
        combined = "\n".join([name] + [b.text for b in bullets])
        projects.append(
            RawProfileProject(
                id=_slug(name) or f"proj_{len(projects) + 1:03d}",
                name=name.strip(),
                summary=summary,
                bullets=bullets,
                technologies=_infer_technologies(combined, skills),
            )
        )
        current_header = ""
        current_lines = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("## "):
            flush()
            current_header = stripped.lstrip("#").strip()
            continue
        if not current_header and not stripped.startswith(("-", "*", "•")):
            current_header = stripped
            continue
        if _looks_like_project_header(stripped):
            flush()
            current_header = stripped.lstrip("#").strip()
            continue
        current_lines.append(stripped)

    flush()
    return [project for project in projects if project.name or project.bullets]


def _parse_role_header(header: str) -> tuple[str, str, str]:
    cleaned = header.strip().strip("*")
    period_raw = ""
    trailing_duration = ""
    period_match = re.search(r"\(([^)]+)\)$", cleaned)
    if period_match:
        period_raw = period_match.group(1).strip()
        trailing_duration = period_raw
        cleaned = cleaned[: period_match.start()].strip()
    elif _YEARISH_RE.search(cleaned):
        period_raw = cleaned
    linkedin_period_match = _MONTH_YEAR_RANGE_RE.search(cleaned)
    if linkedin_period_match:
        period_raw = linkedin_period_match.group(1).strip()
        if linkedin_period_match.group(2):
            period_raw = f"{period_raw} ({linkedin_period_match.group(2).strip()})"
        elif trailing_duration:
            period_raw = f"{period_raw} ({trailing_duration})"
        cleaned = cleaned[: linkedin_period_match.start()].strip()

    if " at " in cleaned:
        title, company = cleaned.split(" at ", 1)
        return title.strip(), company.strip(), period_raw
    if " | " in cleaned:
        left, right = cleaned.split(" | ", 1)
        return left.strip(), right.strip(), period_raw
    company, title = _split_company_and_title(cleaned)
    if title:
        return title, company, period_raw
    dash_match = re.split(r"\s[-–—]\s", cleaned, maxsplit=1)
    if len(dash_match) == 2:
        title, company = dash_match
        return title.strip(), company.strip(), period_raw
    return cleaned.strip(), "", period_raw


def _parse_project_header(header: str) -> tuple[str, str]:
    cleaned = header.strip().strip("*")
    parts = re.split(r"\s[-–—]\s", cleaned, maxsplit=1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    return cleaned, ""


def _looks_like_experience_header(line: str) -> bool:
    cleaned = line.strip().lstrip("#").strip()
    if not cleaned or _is_bullet_line(cleaned):
        return False
    return bool(
        re.search(r"\((?:[^)]*(?:19|20)\d{2}[^)]*)\)$", cleaned)
        or _MONTH_YEAR_RANGE_RE.search(cleaned)
        or " at " in cleaned.lower()
    )


def _looks_like_project_header(line: str) -> bool:
    cleaned = line.strip().lstrip("#").strip()
    if not cleaned or _is_bullet_line(cleaned):
        return False
    if re.search(r"\((?:[^)]*(?:19|20)\d{2}[^)]*)\)$", cleaned):
        return False
    return bool(re.search(r"\s[-–—]\s", cleaned) or not line.startswith(("-", "*", "•")))


def _collect_section_lines(sections: dict[str, list[str]], keys: tuple[str, ...]) -> list[str]:
    collected: list[str] = []
    for key in keys:
        values = sections.get(key, [])
        if not values:
            continue
        if collected and collected[-1] != "":
            collected.append("")
        collected.extend(values)
    return collected


def _looks_like_period_line(line: str) -> bool:
    cleaned = line.strip()
    return bool(_MONTH_YEAR_RANGE_RE.fullmatch(cleaned))


def _header_has_period(line: str) -> bool:
    cleaned = line.strip()
    return bool(_MONTH_YEAR_RANGE_RE.search(cleaned) or re.search(r"\(([^)]+)\)$", cleaned))


def _split_company_and_title(value: str) -> tuple[str, str]:
    words = [word for word in value.split() if word]
    if len(words) < 2:
        return value.strip(), ""

    end_index = None
    for index in range(len(words) - 1, -1, -1):
        token = re.sub(r"[^a-z]", "", words[index].lower())
        if token in _TITLE_ENDINGS:
            end_index = index
            break
    if end_index is None:
        return value.strip(), ""

    start_index = end_index
    while start_index > 0:
        previous = re.sub(r"[^a-z]", "", words[start_index - 1].lower())
        if previous in _TITLE_PREFIXES:
            start_index -= 1
            continue
        break

    company = " ".join(words[:start_index]).strip(" ,")
    title = " ".join(words[start_index : end_index + 1]).strip(" ,")
    if not company or not title:
        return value.strip(), ""
    return company, title


def _infer_technologies(text: str, skills: list[str]) -> list[str]:
    lowered = text.lower()
    matched = [skill for skill in skills if skill.lower() in lowered]
    return _unique(matched)[:8]


def _looks_like_metric(text: str) -> bool:
    lowered = text.lower()
    return any(token in lowered for token in ("reduced", "improved", "%", "$", "ms", "seconds", "minutes", "hours")) or bool(re.search(r"\d", text))


def _clean_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    return _unique([str(value).strip() for value in values if str(value).strip()])


def _sanitize_filename(filename: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", filename).strip("._")
    return safe or "upload.bin"


def _guess_mime_type(suffix: str) -> str:
    return {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".json": "application/json",
    }.get(suffix, "application/octet-stream")


def _is_bullet_line(line: str) -> bool:
    stripped = line.lstrip()
    return stripped.startswith(("-", "*", "•"))


def _strip_bullet(line: str) -> str:
    return re.sub(r"^[\-\*\u2022]\s*", "", line).strip()


def _slug(value: Any) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-")
    return slug[:80]


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result
