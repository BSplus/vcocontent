ALTER TABLE media_items ADD COLUMN IF NOT EXISTS caption_source text NOT NULL DEFAULT 'preserved';
CREATE TABLE IF NOT EXISTS community_likes (
 id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 media_id integer REFERENCES media_items(id) ON DELETE CASCADE,
 event_id integer REFERENCES events(id) ON DELETE CASCADE, created_at timestamp NOT NULL DEFAULT now(),
 CHECK ((media_id IS NULL) <> (event_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS likes_user_media ON community_likes(user_id,media_id);
CREATE UNIQUE INDEX IF NOT EXISTS likes_user_event ON community_likes(user_id,event_id);
CREATE TABLE IF NOT EXISTS community_favorites (
 id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 media_id integer REFERENCES media_items(id) ON DELETE CASCADE,
 event_id integer REFERENCES events(id) ON DELETE CASCADE, created_at timestamp NOT NULL DEFAULT now(),
 CHECK ((media_id IS NULL) <> (event_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_media ON community_favorites(user_id,media_id);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_event ON community_favorites(user_id,event_id);
CREATE TABLE IF NOT EXISTS download_operations (
 id text PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 media_id integer NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
 quality text NOT NULL CHECK (quality IN ('high','low')), created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS download_history (
 id serial PRIMARY KEY, operation_id text NOT NULL UNIQUE,
 user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 media_id integer NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
 quality text NOT NULL CHECK (quality IN ('high','low')), created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS downloads_user_date ON download_history(user_id,created_at);
