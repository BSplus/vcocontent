-- Additive development migration. Do not apply to production without approval.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_cover_image text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_cover_public boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_contact_email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS website_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS instagram_url text;
CREATE TABLE IF NOT EXISTS creator_follows (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT creator_follows_no_self CHECK (user_id <> creator_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS creator_follows_user_creator_unique ON creator_follows(user_id, creator_id);
CREATE INDEX IF NOT EXISTS creator_follows_creator_idx ON creator_follows(creator_id);
COMMIT;
