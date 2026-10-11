CREATE TABLE IF NOT EXISTS nextcloud_sources (
  event_id integer PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  encrypted text NOT NULL
);
ALTER TABLE nextcloud_jobs ADD COLUMN IF NOT EXISTS run_keys jsonb;
ALTER TABLE nextcloud_jobs ADD COLUMN IF NOT EXISTS existing_keys jsonb NOT NULL DEFAULT '[]';
