CREATE TABLE IF NOT EXISTS job_analysis (
    job_id TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    must_have_json TEXT NOT NULL DEFAULT '[]',
    duties_json TEXT NOT NULL DEFAULT '[]',
    nice_to_have_json TEXT NOT NULL DEFAULT '[]',
    contact_name TEXT NOT NULL DEFAULT '',
    analysed_at TEXT NOT NULL
);
