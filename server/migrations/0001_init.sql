-- korovan DB bootstrap (P0-5 schema spec §Tables)
-- Applied at startup via server/src/db.ts migration runner.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  player_id      TEXT PRIMARY KEY,
  nickname       TEXT,
  created_at     INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  cookie_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS saves (
  save_id         TEXT PRIMARY KEY,
  player_id       TEXT NOT NULL REFERENCES players(player_id),
  slot            INTEGER NOT NULL DEFAULT 0,
  version         INTEGER NOT NULL,
  payload         TEXT NOT NULL,
  updated_at      INTEGER NOT NULL,
  client_clock_ms INTEGER NOT NULL,
  UNIQUE(player_id, slot)
);

CREATE TABLE IF NOT EXISTS leaderboard_entries (
  entry_id          TEXT PRIMARY KEY,
  player_id         TEXT NOT NULL REFERENCES players(player_id),
  zone              TEXT NOT NULL,
  faction           TEXT NOT NULL,
  score             INTEGER NOT NULL,
  nickname_snapshot TEXT,
  submitted_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_zone_faction_score
  ON leaderboard_entries(zone, faction, score DESC);

CREATE TABLE IF NOT EXISTS ai_sessions (
  session_id       TEXT PRIMARY KEY,
  player_id        TEXT NOT NULL REFERENCES players(player_id),
  faction          TEXT NOT NULL,
  state            TEXT NOT NULL,
  last_command     TEXT,
  last_decision_at INTEGER,
  decision_count   INTEGER NOT NULL DEFAULT 0,
  UNIQUE(player_id, faction)
);
