ALTER TABLE events ADD COLUMN IF NOT EXISTS round text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS track text;
CREATE TABLE IF NOT EXISTS event_entries (
  id serial PRIMARY KEY,
  event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  number text NOT NULL,
  team text NOT NULL,
  car text NOT NULL,
  drivers text NOT NULL
);
CREATE INDEX IF NOT EXISTS event_entries_event_idx ON event_entries(event_id);