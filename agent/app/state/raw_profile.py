"""Raw parsed profile models.

The raw profile stays close to uploaded source material. It preserves extracted
text, bullets, and provenance so we can later derive a canonical STAR-style
profile without losing traceability back to the original resume.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class SourceDocument(BaseModel):
    id: str
    filename: str
    mime_type: str
    saved_path: str
    sha256: str
    extracted_text_path: str | None = None
    extracted_markdown_path: str | None = None
    parse_status: str = "pending"
    parse_error: str | None = None


class RawProfileIdentity(BaseModel):
    name: str = ""
    headline: str = ""
    email: str = ""
    phone: str = ""
    location: str = ""


class RawProfileBullet(BaseModel):
    text: str
    source_excerpt: str = ""
    confidence: str = "medium"


class RawProfileExperience(BaseModel):
    id: str
    title: str = ""
    company: str = ""
    period_raw: str = ""
    bullets: list[RawProfileBullet] = Field(default_factory=list)
    metrics: list[str] = Field(default_factory=list)
    technologies: list[str] = Field(default_factory=list)


class RawProfileProject(BaseModel):
    id: str
    name: str = ""
    summary: str = ""
    bullets: list[RawProfileBullet] = Field(default_factory=list)
    technologies: list[str] = Field(default_factory=list)


class RawProfile(BaseModel):
    version: int = 1
    source_documents: list[SourceDocument] = Field(default_factory=list)
    identity: RawProfileIdentity = Field(default_factory=RawProfileIdentity)
    summary: str = ""
    experience: list[RawProfileExperience] = Field(default_factory=list)
    projects: list[RawProfileProject] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    education: list[str] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)
    writing_samples: list[str] = Field(default_factory=list)
    parse_notes: list[str] = Field(default_factory=list)


class RawProfileResponse(BaseModel):
    raw_profile_exists: bool
    raw_profile_path: str
    raw_profile: RawProfile | None = None


class ProfileUploadResponse(BaseModel):
    ok: bool
    source_document: SourceDocument
    raw_profile_path: str
    raw_profile: RawProfile
