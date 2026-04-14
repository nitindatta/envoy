CREATE TABLE IF NOT EXISTS work_queue (
  id TEXT PRIMARY KEY,
  queue_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_work_queue_status ON work_queue (status, created_at);
ALTER TABLE applications ADD COLUMN last_apply_step_json TEXT;
