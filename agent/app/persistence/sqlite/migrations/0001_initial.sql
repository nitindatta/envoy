-- Initial schema for the autonomous job agent.
-- Source of truth: docs/design.md §3 (Data Model).
-- LangGraph checkpoint tables are managed separately by SqliteSaver.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    source_url TEXT NOT NULL,
    canonical_key TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT,
    summary TEXT,
    payload_json TEXT NOT NULL,
    discovered_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    UNIQUE (provider, source_url)
);

CREATE INDEX IF NOT EXISTS idx_jobs_canonical_key ON jobs (canonical_key);
CREATE INDEX IF NOT EXISTS idx_jobs_provider ON jobs (provider);

CREATE TABLE IF NOT EXISTS job_labels (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    reason TEXT,
    actor TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_labels_job_id ON job_labels (job_id);

CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    source_provider TEXT NOT NULL,
    target_portal TEXT,
    source_url TEXT NOT NULL,
    target_application_url TEXT,
    state TEXT NOT NULL,
    approval_required INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    submitted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications (job_id);
CREATE INDEX IF NOT EXISTS idx_applications_state ON applications (state);

CREATE TABLE IF NOT EXISTS application_events (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    from_state TEXT,
    to_state TEXT,
    payload_json TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_application_events_app ON application_events (application_id);

CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
    draft_type TEXT NOT NULL,
    question_fingerprint TEXT,
    generator TEXT NOT NULL,
    content TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_drafts_application_id ON drafts (application_id);

CREATE TABLE IF NOT EXISTS question_answers (
    id TEXT PRIMARY KEY,
    question_fingerprint TEXT NOT NULL,
    question_text TEXT NOT NULL,
    answer_text TEXT NOT NULL,
    confidence TEXT NOT NULL,
    source TEXT NOT NULL,
    approved_by_user INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_question_answers_fingerprint ON question_answers (question_fingerprint);

CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    application_id TEXT REFERENCES applications (id) ON DELETE SET NULL,
    workflow_type TEXT NOT NULL,
    status TEXT NOT NULL,
    current_node TEXT,
    state_json TEXT,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs (status);

CREATE TABLE IF NOT EXISTS browser_sessions (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    session_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_browser_sessions_provider ON browser_sessions (provider);

CREATE TABLE IF NOT EXISTS memory_entries (
    id TEXT PRIMARY KEY,
    memory_type TEXT NOT NULL,
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    confidence REAL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_type_scope ON memory_entries (memory_type, scope);

CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    artifact_type TEXT NOT NULL,
    path TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_owner ON artifacts (owner_type, owner_id);

CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (scope, key)
);

CREATE TABLE IF NOT EXISTS drift_signals (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    parser_id TEXT NOT NULL,
    expected_schema TEXT NOT NULL,
    observed_summary TEXT NOT NULL,
    page_snapshot_path TEXT,
    workflow_run_id TEXT REFERENCES workflow_runs (id) ON DELETE SET NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_drift_signals_resolved ON drift_signals (resolved);
