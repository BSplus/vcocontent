CREATE TABLE IF NOT EXISTS nextcloud_jobs (
  id serial PRIMARY KEY,
  event_id integer NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'idle',
  updated_at timestamp NOT NULL DEFAULT now(),
  error text,
  skipped integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS nextcloud_files (
  id serial PRIMARY KEY,
  event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  media_id integer REFERENCES media_items(id) ON DELETE SET NULL,
  message text,
  ai_warning text,
  CONSTRAINT nextcloud_file_source_idx UNIQUE(event_id, source_key)
);