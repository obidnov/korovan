-- 0002_leaderboard_keep_best.sql
-- BOO-478: extend leaderboard_entries for POST /api/leaderboard
--
-- 1. Opaque run_metadata blob (max 4 KB enforced at app layer, not DB).
-- 2. Unique index on (player_id, zone, faction) to enforce one-best-entry
--    per player per (zone, faction) pair — required for keep-best semantics.
--    SQLite doesn't support ADD CONSTRAINT; CREATE UNIQUE INDEX is equivalent.
--
-- Note: On a populated table the UNIQUE INDEX creation will fail if duplicate
--       (player_id, zone, faction) tuples already exist. In P1 the DB is empty
--       on first deploy so this is safe. Add a dedup step before the index
--       if ever running this against a pre-existing dataset.

ALTER TABLE leaderboard_entries ADD COLUMN run_metadata TEXT;

CREATE UNIQUE INDEX leaderboard_player_zone_faction
  ON leaderboard_entries (player_id, zone, faction);
