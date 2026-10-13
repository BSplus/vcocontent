-- Additive DEVELOPMENT migration. No startup DDL, no media metadata rewrites.
CREATE TABLE IF NOT EXISTS media_object_routes (
  key text PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('replit','r2')),
  state text NOT NULL CHECK (state IN ('pending','verified','deleted')),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  size bigint CHECK (size > 0),
  mime text,
  object_version text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE media_object_routes ADD COLUMN IF NOT EXISTS object_version text;
