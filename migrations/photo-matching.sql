ALTER TABLE events ADD COLUMN IF NOT EXISTS photo_matching_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS photo_matching_revision integer NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS photo_match_status text;
ALTER TABLE media_analysis_jobs ADD COLUMN IF NOT EXISTS photo_workflow boolean NOT NULL DEFAULT false;
ALTER TABLE media_analysis_jobs ADD COLUMN IF NOT EXISTS photo_matching_revision integer NOT NULL DEFAULT 0;
ALTER TABLE media_analysis_jobs ADD COLUMN IF NOT EXISTS replace_caption text;
