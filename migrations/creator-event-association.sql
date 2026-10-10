BEGIN;
CREATE TABLE IF NOT EXISTS creator_event_associations (
  gallery_id integer PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  official_event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT creator_event_associations_distinct CHECK (gallery_id <> official_event_id)
);
CREATE INDEX IF NOT EXISTS creator_event_associations_target_idx
  ON creator_event_associations(official_event_id);
COMMIT;
