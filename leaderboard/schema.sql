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

-- Claim attempts per network and hour, to keep handle-grabbing slow.
CREATE TABLE IF NOT EXISTS claims (
  bucket TEXT NOT NULL,                        -- sha256 of the caller's address, hour
  n      INTEGER NOT NULL,
  PRIMARY KEY (bucket)
);
