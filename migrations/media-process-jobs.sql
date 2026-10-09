-- Additive development schema changes. No existing media or tags are modified.
ALTER TABLE nextcloud_jobs ADD COLUMN IF NOT EXISTS manifest text;
ALTER TABLE nextcloud_jobs ADD COLUMN IF NOT EXISTS worker_token text;
ALTER TABLE nextcloud_jobs ADD COLUMN IF NOT EXISTS manifest_expires_at timestamp;
CREATE INDEX IF NOT EXISTS nextcloud_job_ready_idx ON nextcloud_jobs(status, updated_at);
CREATE TABLE IF NOT EXISTS media_analysis_jobs (
  media_id integer PRIMARY KEY REFERENCES media_items(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  worker_token text,
  generated_tags text[],
  error text,
  duration_ms integer
);
CREATE INDEX IF NOT EXISTS media_analysis_ready_idx ON media_analysis_jobs(status, available_at);
