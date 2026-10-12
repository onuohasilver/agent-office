-- The leaderboard's whole database. Counters and a handle, nothing else.

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,                 -- sha256 of the user's secret; the secret is never stored
  handle     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL,
  synced_at  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,                       -- YYYY-MM-DD, UTC
  jobs    INTEGER NOT NULL,
  tokens  INTEGER NOT NULL,
  seconds INTEGER NOT NULL,                    -- agent time: seconds agents spent working that day
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS days_day ON days(day);

-- Tries per caller and time window (claims, redeems), to keep guessing slow.
-- The hourly cron deletes rows whose window is over.
DROP TABLE IF EXISTS claims;                   -- the old, never-pruned counters
CREATE TABLE IF NOT EXISTS throttles (
  bucket     TEXT PRIMARY KEY,                 -- sha256 of what is counted and the window; addresses go in as an HMAC
  n          INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS throttles_expiry ON throttles(expires_at);

-- Linked offices. An invite is a one-time code, kept only as a hash.
CREATE TABLE IF NOT EXISTS invites (
  id         TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL UNIQUE,             -- sha256 of the normalised code; the code is never stored
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                    -- link | guest
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS invites_user ON invites(user_id);

-- Two offices that can see each other. For a guest link, a_user is the host.
-- a_user always made the invite.
CREATE TABLE IF NOT EXISTS links (
  id         TEXT PRIMARY KEY,
  a_user     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b_user     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                    -- link | guest
  invite_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS links_a ON links(a_user);
CREATE INDEX IF NOT EXISTS links_b ON links(b_user);
