-- Stop the association-enabled application first. Export links before removal.
-- This removes ONLY links, never events, media, likes, or favorites.
BEGIN;
DROP TABLE IF EXISTS creator_event_associations;
COMMIT;
