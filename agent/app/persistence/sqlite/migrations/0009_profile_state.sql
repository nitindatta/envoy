CREATE TABLE IF NOT EXISTS profile_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  source_profile_path TEXT NOT NULL,
  target_profile_path TEXT NOT NULL,
  canonical_profile_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
