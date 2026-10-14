-- Development/post-merge schema preparation. Production uses Publishing diff.
ALTER TABLE events ADD COLUMN IF NOT EXISTS vehicle text;
