-- Development preparation only; no records are archived by this schema change.
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS archived_at timestamp;
CREATE INDEX IF NOT EXISTS media_active_event_idx ON media_items(event_id,id DESC)
  WHERE archived_at IS NULL;
