ALTER TABLE jobs ADD COLUMN posted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON jobs (posted_at);
