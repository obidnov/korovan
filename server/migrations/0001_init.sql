-- 0001_init.sql
-- P1 initial schema: players, saves, leaderboard_entries, ai_sessions
--
-- Applied by the boot-time runner (implemented in P0-1 bootstrap).
-- The runner sets PRAGMA foreign_keys = ON before executing this file.
-- Checksum and schema_migrations INSERT are performed by the runner, not here.
--
-- SQLite 3.24+ required (ON CONFLICT DO UPDATE upsert syntax).

-- players: cookie-based identity; no email/password in P1
CREATE TABLE players (
  player_id      TEXT    PRIMARY KEY NOT NULL,  -- UUIDv4, server-generated; never reused
  nickname       TEXT,                          -- nullable; sanitized per P0-4; <= 32 chars
  created_at     INTEGER NOT NULL,              -- unix ms
  last_seen_at   INTEGER NOT NULL,              -- unix ms; updated on every authed request
  cookie_version INTEGER NOT NULL DEFAULT 1     -- bumped on signing-secret rotation
);

-- saves: one row per (player, slot); single slot (0) in P1
CREATE TABLE saves (
  save_id         TEXT    PRIMARY KEY NOT NULL,  -- UUIDv4, server-generated
  player_id       TEXT    NOT NULL,
  slot            INTEGER NOT NULL DEFAULT 0,    -- 0 in P1; multi-slot deferred to P2+
  version         INTEGER NOT NULL,              -- payload schema version (see docs/save-format.md)
  payload         TEXT    NOT NULL,              -- JSON-stringified save; <= 64 KB enforced server-side
  updated_at      INTEGER NOT NULL,              -- unix ms
  client_clock_ms INTEGER NOT NULL,              -- client-reported timestamp for conflict resolution
  FOREIGN KEY (player_id) REFERENCES players (player_id) ON DELETE CASCADE,
  UNIQUE (player_id, slot)
);

-- leaderboard_entries: immutable score submissions; nickname snapshot preserves history on rename
CREATE TABLE leaderboard_entries (
  entry_id          TEXT    PRIMARY KEY NOT NULL,  -- UUIDv4, server-generated
  player_id         TEXT    NOT NULL,
  zone              TEXT    NOT NULL,              -- app-layer enum: forest/palace/neutral/mountain
  faction           TEXT    NOT NULL,              -- app-layer enum: elves/palace_guard/villain
  score             INTEGER NOT NULL,              -- range-validated at app layer before INSERT
  nickname_snapshot TEXT,                          -- nickname at submission; NULL if player had none
  submitted_at      INTEGER NOT NULL,              -- unix ms
  FOREIGN KEY (player_id) REFERENCES players (player_id)
  -- No ON DELETE: leaderboard history survives player removal
);

-- Top-N leaderboard query: WHERE zone = ? AND faction = ? ORDER BY score DESC LIMIT ?
CREATE INDEX leaderboard_zone_faction_score
  ON leaderboard_entries (zone, faction, score DESC);

-- ai_sessions: per-(player, faction) agent state; read/written on every /api/llm/decide
CREATE TABLE ai_sessions (
  session_id       TEXT    PRIMARY KEY NOT NULL,  -- UUIDv4, server-generated
  player_id        TEXT    NOT NULL,
  faction          TEXT    NOT NULL,              -- app-layer enum
  state            TEXT    NOT NULL,              -- JSON session state; <= 16 KB enforced server-side
  last_command     TEXT,                          -- JSON AgentCommand from last decision; NULL until first
  last_decision_at INTEGER,                       -- unix ms; NULL until first decision
  decision_count   INTEGER NOT NULL DEFAULT 0,    -- incremented per decision; BC-4 token-budget enforcement
  FOREIGN KEY (player_id) REFERENCES players (player_id) ON DELETE CASCADE,
  UNIQUE (player_id, faction)
);
