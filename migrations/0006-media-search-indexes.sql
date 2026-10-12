-- Additive, opt-in rollout. Do not run against production without approval.
-- Run outside a transaction: concurrent builds keep gallery writes available.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY IF NOT EXISTS media_caption_search_idx
  ON media_items USING gin (caption gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS media_photographer_search_idx
  ON media_items USING gin (photographer gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS media_identification_search_idx
  ON media_items USING gin ((identification::text) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS media_event_count_idx
  ON media_items (event_id,type,is_premium,safety_status,safety_policy,content_version,safety_version,id);
-- The predicate matches shared/media-query-policy.ts (1 MiB inline limit).
-- Thumbnail bytes are NEVER index keys, including historical inline thumbnails.
CREATE INDEX CONCURRENTLY IF NOT EXISTS media_thumbnail_options_idx
  ON media_items (event_id,safety_status,safety_policy,content_version,safety_version,id)
  WHERE type = 'image' AND NOT is_premium AND
    (thumbnail ~ '^/api/media/files/thumb-[0-9a-f-]{36}\.webp$' OR
      (thumbnail ~ '^data:image/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$'
        AND length(thumbnail) <= 1398202));
