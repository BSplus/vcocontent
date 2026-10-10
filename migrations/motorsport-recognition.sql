ALTER TABLE events ADD COLUMN IF NOT EXISTS reference_revision integer NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS reference_season_year integer;
ALTER TABLE event_entries ADD COLUMN IF NOT EXISTS manufacturer text NOT NULL DEFAULT '';
ALTER TABLE event_entries ADD COLUMN IF NOT EXISTS racing_class text NOT NULL DEFAULT '';
ALTER TABLE event_entries ADD COLUMN IF NOT EXISTS discipline text NOT NULL DEFAULT '';
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS identification jsonb NOT NULL DEFAULT '[]';
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS identification_manual boolean NOT NULL DEFAULT false;
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS recognition_session text;
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS suppressed_ai_tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS manual_tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE media_analysis_jobs ADD COLUMN IF NOT EXISTS recognition jsonb;
ALTER TABLE media_analysis_jobs ADD COLUMN IF NOT EXISTS reference_revision integer NOT NULL DEFAULT 0;
ALTER TABLE media_analysis_jobs ADD COLUMN IF NOT EXISTS reference_only boolean NOT NULL DEFAULT false;
ALTER TABLE media_analysis_jobs ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS reference_documents (
 id serial PRIMARY KEY, event_id integer REFERENCES events(id) ON DELETE CASCADE,
 series_id integer REFERENCES series(id), owner_id integer REFERENCES users(id),
 season_year integer NOT NULL, scope text NOT NULL, kind text NOT NULL, session text,
 title text NOT NULL, source_key text, fingerprint text NOT NULL, identity_key text NOT NULL UNIQUE,
 rows jsonb NOT NULL, updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reference_scope_idx ON reference_documents(series_id, season_year, owner_id);
CREATE INDEX IF NOT EXISTS reference_event_idx ON reference_documents(event_id);
