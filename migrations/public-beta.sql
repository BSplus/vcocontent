-- Additive only. Historical accounts are NOT verified and historical media
-- remain explicitly unreviewed, not silently marked safe.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS quota_exception boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS analysis_last_served_at timestamp;
ALTER TABLE events ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'published';
ALTER TABLE events ADD COLUMN IF NOT EXISTS admin_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS safety_version integer NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS safety_status text NOT NULL DEFAULT 'legacy';
ALTER TABLE events ADD COLUMN IF NOT EXISTS safety_policy text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS safety_reason text;
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 0;
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS safety_version integer NOT NULL DEFAULT 0;
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS safety_status text NOT NULL DEFAULT 'legacy';
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS safety_policy text;
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS safety_reason text;
ALTER TABLE reference_documents ADD COLUMN IF NOT EXISTS stored_bytes bigint;
ALTER TABLE media_reservations ADD COLUMN IF NOT EXISTS replaces_reference_id integer;
CREATE TABLE IF NOT EXISTS email_verifications (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL, expires_at timestamp NOT NULL,
  sent_at timestamp NOT NULL DEFAULT now(), used_at timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS email_verification_hash_idx ON email_verifications(token_hash);
CREATE TABLE IF NOT EXISTS beta_rate_limits (
  key text PRIMARY KEY, count integer NOT NULL DEFAULT 0, reset_at timestamp NOT NULL
);
CREATE TABLE IF NOT EXISTS safety_results (
  fingerprint text PRIMARY KEY, status text NOT NULL, reason text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS safety_reviews (
  id serial PRIMARY KEY, resource text NOT NULL, resource_id integer NOT NULL,
  version integer NOT NULL, admin_id integer NOT NULL REFERENCES users(id),
  decision text NOT NULL, reason text NOT NULL, created_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE media_cleanup ADD COLUMN IF NOT EXISTS creator_id integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE media_cleanup ADD COLUMN IF NOT EXISTS stored_bytes bigint;
ALTER TABLE media_cleanup ADD COLUMN IF NOT EXISTS photo_token text;
-- Existing avatars were already exposed by the historical public user API.
-- Grandfather their visibility only once; never republish new private avatars
-- when this idempotent setup script runs on a later merge.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='users' AND column_name='profile_image_public') THEN
    ALTER TABLE users ADD COLUMN profile_image_public boolean NOT NULL DEFAULT false;
    UPDATE users SET profile_image_public=true;
  END IF;
END $$;
