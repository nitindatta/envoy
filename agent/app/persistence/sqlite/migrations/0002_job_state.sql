-- Add state column to jobs table.
-- States: discovered | in_review | ignored
ALTER TABLE jobs ADD COLUMN state TEXT NOT NULL DEFAULT 'discovered';
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs (state);
