# korovan — Database Schema

**Version:** 1.0 (BOO-469)
**Owner:** Backend Developer
**Parent:** BOO-458 (korovan backend epic)
**Last updated:** 2026-06-15

---

## Overview

korovan uses **SQLite 3** as its on-disk store, mounted at `$DATABASE_PATH`
(Fly.io volume at `/data/korovan.db`). Four tables cover all P1 scope.
Schema is managed via numbered raw-SQL migration files in `server/migrations/`;
a `schema_migrations` tracking table records each applied migration.

**SQLite version requirement:** 3.24+ (`ON CONFLICT DO UPDATE` upsert syntax).

**Connection setup (applied by the runner on every open):**

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

---

## Migration system

### Tool choice: plain raw-SQL files + custom boot-time runner

No heavy ORM migrator. Each migration is a self-contained `.sql` file containing
forward-only DDL. The boot-time runner (implemented in the P0-1 bootstrap issue)
reads files in numeric order, skips already-applied ones, and records each run in
`schema_migrations`.

**Rationale:** SQLite + a few dozen migrations at most — zero dependency overhead
with raw SQL files. Easy to audit, easy to test, no external migration binary to
provision on the Fly.io image.

### File layout

```
server/
  migrations/
    0001_init.sql          ← all P1 tables (this file; see §0001_init)
    NNNN_description.sql   ← future migrations, sequentially numbered
```

Filenames: zero-padded 4-digit prefix (`0001`, `0002`, …) + underscore + kebab-case
description + `.sql`. The numeric prefix determines execution order.

### `schema_migrations` tracking table

Created by the runner itself (not a numbered migration) before any migration runs:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,  -- sequential (1, 2, 3, …)
  name       TEXT    NOT NULL,     -- filename e.g. "0001_init.sql"
  checksum   TEXT    NOT NULL,     -- SHA-256 hex of file content
  applied_at INTEGER NOT NULL      -- unix ms
);
```

### Boot-time auto-apply algorithm

1. Open SQLite at `$DATABASE_PATH`.
2. Apply connection PRAGMAs (WAL, foreign_keys, busy_timeout).
3. `CREATE TABLE IF NOT EXISTS schema_migrations (…)`.
4. Read all `*.sql` files from `server/migrations/`, sort ascending by numeric prefix.
5. For each file:
   - Extract version number from prefix.
   - `SELECT 1 FROM schema_migrations WHERE version = ?` — skip if applied.
   - Compute SHA-256 of file content (hex).
   - Execute file SQL in a single transaction.
   - `INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (…)`.
6. On any failure: log to stderr, exit non-zero. Server does not start with a
   failed migration.

**No down migrations in MVP.** Rollback = restore Fly.io volume snapshot.

---

## Tables

### `players`

Cookie-based identity. No `email` / `password` columns in P1.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `player_id` | TEXT | PRIMARY KEY NOT NULL | UUIDv4, server-generated; never reused |
| `nickname` | TEXT | NULLABLE | User-provided; sanitized per [P0-4 sanitizer rules](#sanitization); ≤ 32 chars |
| `created_at` | INTEGER | NOT NULL | Unix ms |
| `last_seen_at` | INTEGER | NOT NULL | Unix ms; updated on every cookie-authenticated request |
| `cookie_version` | INTEGER | NOT NULL DEFAULT 1 | Bumped on signing-secret rotation to invalidate sessions |

**No FK inbound in P1.** All child tables (`saves`, `leaderboard_entries`,
`ai_sessions`) reference `players(player_id)`.

**Sanitization reference:** `nickname` must pass through the P0-4 sanitizer before
INSERT or UPDATE. Rules: strip HTML tags, collapse whitespace, truncate to 32 chars,
reject empty-after-strip. See `docs/sanitization.md` (filed under BOO P0-4). Server
returns 400 on violation; DB never sees unsanitized input.

---

### `saves`

One row per player per save slot. Single slot (`slot = 0`) in P1; the column
exists now so future multi-slot (P2+) adds no DDL migration.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `save_id` | TEXT | PRIMARY KEY NOT NULL | UUIDv4, server-generated |
| `player_id` | TEXT | NOT NULL | FK → `players(player_id)` ON DELETE CASCADE |
| `slot` | INTEGER | NOT NULL DEFAULT 0 | 0 in P1; multi-slot deferred to P2 |
| `version` | INTEGER | NOT NULL | Save payload schema version (see §Save payload versioning) |
| `payload` | TEXT | NOT NULL | JSON-stringified save (HP, position, loot, zone state) |
| `updated_at` | INTEGER | NOT NULL | Unix ms |
| `client_clock_ms` | INTEGER | NOT NULL | Client-reported timestamp at save time; conflict resolution tiebreaker |

**Unique constraint:** `(player_id, slot)`.

**Upsert pattern** (used on every save-game call):

```sql
INSERT INTO saves
  (save_id, player_id, slot, version, payload, updated_at, client_clock_ms)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(player_id, slot) DO UPDATE SET
  version         = excluded.version,
  payload         = excluded.payload,
  updated_at      = excluded.updated_at,
  client_clock_ms = excluded.client_clock_ms;
```

**Payload size limit:** 64 KB enforced at the application layer before INSERT.
Server returns 413 if exceeded.

**Payload sanitization reference:** `payload` JSON must be validated against the
current `SaveV{N}` schema (see `docs/save-format.md`) before INSERT. PII fields
introduced in future payload versions must be handled per BC-3 rules. The server
rejects payloads that fail `validateSave(raw)`.

---

### `leaderboard_entries`

Immutable score submissions. `nickname_snapshot` captures the player's display name
at submission time so subsequent renames don't rewrite leaderboard history.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `entry_id` | TEXT | PRIMARY KEY NOT NULL | UUIDv4, server-generated |
| `player_id` | TEXT | NOT NULL | FK → `players(player_id)` — no ON DELETE |
| `zone` | TEXT | NOT NULL | e.g. `"forest"`, `"palace"`, `"neutral"`, `"mountain"`; enum-validated at app layer |
| `faction` | TEXT | NOT NULL | e.g. `"elves"`, `"palace_guard"`, `"villain"`; enum-validated |
| `score` | INTEGER | NOT NULL | Game-defined metric; range-validated at app layer before INSERT |
| `nickname_snapshot` | TEXT | NULLABLE | Nickname at submission time; NULL if player had none |
| `submitted_at` | INTEGER | NOT NULL | Unix ms |

**Index for top-N queries:**

```sql
CREATE INDEX leaderboard_zone_faction_score
  ON leaderboard_entries (zone, faction, score DESC);
```

Query shape: `SELECT … ORDER BY score DESC LIMIT ?` where `zone = ?` AND `faction = ?`.

**FK note on player deletion:** `leaderboard_entries.player_id` references
`players(player_id)` without `ON DELETE CASCADE`. With `PRAGMA foreign_keys = ON`,
SQLite's default FK action (`NO ACTION`) **blocks** any `DELETE FROM players` that
has a matching `leaderboard_entries` row — a dangling reference cannot be produced.
Player deletion is blocked by this FK while any `leaderboard_entries` reference the
player. No player deletion flow in P1, so this is a non-issue. P2+ adds either
`ON DELETE SET NULL` (allows deletion; preserves history without the live link) or a
soft-delete pattern on `players` (preserves the FK link).

---

### `ai_sessions`

Per-(player, faction) AI agent state. Read on every `/api/llm/decide` call;
written back after each decision.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `session_id` | TEXT | PRIMARY KEY NOT NULL | UUIDv4, server-generated |
| `player_id` | TEXT | NOT NULL | FK → `players(player_id)` ON DELETE CASCADE |
| `faction` | TEXT | NOT NULL | Faction this session drives; enum-validated |
| `state` | TEXT | NOT NULL | JSON-stringified session state; ≤ 16 KB |
| `last_command` | TEXT | NULLABLE | JSON-stringified `AgentCommand` from last decision |
| `last_decision_at` | INTEGER | NULLABLE | Unix ms; NULL until first decision |
| `decision_count` | INTEGER | NOT NULL DEFAULT 0 | Incremented per decision; for BC-4 token-budget enforcement |

**Unique constraint:** `(player_id, faction)` — at most one session per player per faction.

**Upsert pattern** (used on every `/api/llm/decide` response):

```sql
INSERT INTO ai_sessions
  (session_id, player_id, faction, state, last_command, last_decision_at, decision_count)
VALUES (?, ?, ?, ?, ?, ?, 1)
ON CONFLICT(player_id, faction) DO UPDATE SET
  state            = excluded.state,
  last_command     = excluded.last_command,
  last_decision_at = excluded.last_decision_at,
  decision_count   = ai_sessions.decision_count + 1;
```

`decision_count` increments atomically in the DB (not in application code) to avoid
read-modify-write races under concurrent requests.

**State size limit:** 16 KB enforced at the application layer before INSERT/UPDATE.

---

## Foreign key summary

| Table | FK column | References | On Delete |
|---|---|---|---|
| `saves` | `player_id` | `players(player_id)` | CASCADE |
| `leaderboard_entries` | `player_id` | `players(player_id)` | (none — history preserved) |
| `ai_sessions` | `player_id` | `players(player_id)` | CASCADE |

---

## Indexes summary

| Index | Table | Columns | Purpose |
|---|---|---|---|
| `leaderboard_zone_faction_score` | `leaderboard_entries` | `(zone, faction, score DESC)` | Top-N leaderboard queries |

SQLite automatically creates B-tree indexes for all `PRIMARY KEY` columns and
`UNIQUE` constraints. No additional indexes needed for P1 traffic volumes.

---

## Save payload versioning

The `saves.version` column is a **payload schema version integer**, independent of
the DB migration version. It allows the payload JSON shape to evolve without a
schema migration.

### Strategy: lazy upgrade-on-read

When the server reads a save row:

1. Parse `payload` as JSON.
2. Check `version` (the integer embedded in the JSON envelope, same as the `saves.version` column).
3. If `version < CURRENT_SAVE_VERSION`: call `migrate(parsed)` from `src/save/schema.ts` (see `docs/save-format.md`).
4. Write the upgraded payload back to the DB so future reads skip the migration step.
5. Return the upgraded save to the client.

**If `version > CURRENT_SAVE_VERSION`:** client is ahead of server — reject with
409 Conflict and message `"save version {v} newer than server {CURRENT}; update server"`.
This prevents an older server from corrupting a newer-format save.

**Why lazy, not eager batch-migrate:** avoids a potentially long startup migration
blocking the server on first deploy. For P1 (single slot per player, small payloads)
this is effectively invisible. If at P3+ payload volume grows, add an optional
background sweeper.

### Version history

| `saves.version` | Shipped in | Shape |
|---|---|---|
| `1` | P1 | See `docs/save-format.md` §SaveV1 |

BD owns `CURRENT_SAVE_VERSION`. Bump when the payload JSON shape changes
incompatibly; each bump requires a `migrate(v_n → v_{n+1})` case in
`src/save/schema.ts`.

---

## Sanitization reference points

| Field | Table | Rule source |
|---|---|---|
| `nickname` | `players` | P0-4 sanitizer: strip HTML, ≤ 32 chars, reject empty-after-strip |
| `payload` | `saves` | BC-3: validate against `SaveV{N}` schema; reject if > 64 KB or schema invalid |
| `zone`, `faction` | `leaderboard_entries`, `ai_sessions` | Application-layer enum allowlist |
| `score` | `leaderboard_entries` | Application-layer range validation (0 ≤ score ≤ MAX_SCORE) |
| `state` | `ai_sessions` | Application-layer size check: ≤ 16 KB |

None of these checks use SQLite `CHECK` constraints — errors surface before the DB
call for cleaner HTTP error messages.

---

## Appendix: enum values

### zone

| Value | Zone |
|---|---|
| `forest` | Elf forest |
| `palace` | Emperor's palace |
| `neutral` | Neutral human trade hub |
| `mountain` | Villain's mountain fort |

### faction

| Value | Faction |
|---|---|
| `elves` | Forest elves |
| `palace_guard` | Palace guard |
| `villain` | Villain warlord |
