-- PREPARED ONLY. Additive schema; do not execute without approval.
-- No media bytes, credentials, user/role/series/settings changes or data copy.
CREATE TABLE media_upload_sessions (
  id text PRIMARY KEY,
  actor_id integer NOT NULL,
  request_key text NOT NULL,
  request_fingerprint text NOT NULL,
  event_id integer NOT NULL,
  owner_id integer,
  size bigint NOT NULL,
  mime text NOT NULL,
  sha256 text NOT NULL,
  metadata jsonb NOT NULL,
  parts jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'receiving',
  worker_pid integer,
  media_id integer,
  cleaned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT upload_session_size CHECK (size > 0),
  CONSTRAINT upload_session_state CHECK (state IN ('receiving','finalizing','completed','failed','cancelled'))
);
CREATE UNIQUE INDEX upload_session_request_idx ON media_upload_sessions(actor_id,request_key);
CREATE INDEX upload_session_expiry_idx ON media_upload_sessions(state,expires_at);
