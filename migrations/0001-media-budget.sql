-- Apply once to the existing PostgreSQL database before deploying the media budget.
-- This does not rewrite or delete historical media or its Base64 fields.
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS stored_bytes bigint;
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS object_count integer;
CREATE INDEX IF NOT EXISTS media_event_page_idx ON media_items (event_id, id);
CREATE INDEX IF NOT EXISTS media_url_idx ON media_items (url) WHERE url LIKE '/api/media/files/%';
CREATE INDEX IF NOT EXISTS media_thumbnail_idx ON media_items (thumbnail) WHERE thumbnail LIKE '/api/media/files/%';
CREATE INDEX IF NOT EXISTS media_popular_idx ON media_items (download_count);
CREATE TABLE IF NOT EXISTS media_reservations (
  id text PRIMARY KEY,
  event_id integer NOT NULL,
  creator_id integer,
  reserved_bytes bigint NOT NULL,
  storage_key text NOT NULL,
  thumbnail_key text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS media_cleanup (
  key text PRIMARY KEY,
  created_at timestamp NOT NULL DEFAULT now(),
  last_error text
);