-- Search keyword tags for jobs.
-- Each row records that a specific job was returned by a specific keyword search.
-- Many-to-many: one job can be tagged by multiple searches; one search tags many jobs.
CREATE TABLE IF NOT EXISTS job_search_tags (
    job_id  TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    PRIMARY KEY (job_id, keyword)
);

CREATE INDEX IF NOT EXISTS idx_job_search_tags_keyword ON job_search_tags(keyword);
