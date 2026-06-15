import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createHmac } from 'crypto'
import { app } from '../src/app'
import { setDb, closeDb } from '../src/db'
import { _resetStore, ENDPOINT_PROFILES } from '../src/middleware/rateLimit'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COOKIE_SECRET = process.env.COOKIE_SIGNING_SECRET!
const COOKIE_NAME = 'kr_pid'

function buildInMemoryDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // Apply all migrations so tests reflect the full schema.
  const init = readFileSync(join(__dirname, '..', 'migrations', '0001_init.sql'), 'utf8')
  const keepBest = readFileSync(
    join(__dirname, '..', 'migrations', '0002_leaderboard_keep_best.sql'),
    'utf8',
  )
  db.exec(init)
  db.exec(keepBest)
  return db
}

function insertPlayer(
  db: Database.Database,
  playerId: string,
  nickname: string | null = null,
): void {
  db.prepare(
    `INSERT INTO players(player_id, nickname, created_at, last_seen_at) VALUES (?, ?, ?, ?)`,
  ).run(playerId, nickname, Date.now(), Date.now())
}

function signCookie(playerId: string): string {
  const sig = createHmac('sha256', COOKIE_SECRET).update(playerId).digest('hex')
  return `${COOKIE_NAME}=${playerId}.${sig}`
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let db: Database.Database

beforeEach(() => {
  db = buildInMemoryDb()
  setDb(db)
  _resetStore() // clear rate-limit counters between tests (BOO-482 in-memory store)
})

afterEach(() => {
  closeDb()
})

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('POST /api/leaderboard', () => {
  it('201 — creates a new entry and returns entry_id + rank', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid, 'Nomad')

    const res = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 9001 })

    expect(res.status).toBe(201)
    expect(typeof res.body.entry_id).toBe('string')
    expect(res.body.rank).toBe(1)
  })

  it('201 — rank accounts for other entries in same (zone, faction)', async () => {
    const p1 = 'aaaaaaaa-0001-4000-a000-000000000001'
    const p2 = 'aaaaaaaa-0002-4000-a000-000000000002'
    insertPlayer(db, p1)
    insertPlayer(db, p2)

    await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(p1))
      .send({ zone: 'forest', faction: 'bandits', score: 9000 })

    const res = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(p2))
      .send({ zone: 'forest', faction: 'bandits', score: 5000 })

    expect(res.status).toBe(201)
    expect(res.body.rank).toBe(2)
  })

  it('201 — nickname_snapshot captures current player nickname', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid, 'Kazakh')

    await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 100 })

    const row = db
      .prepare('SELECT nickname_snapshot FROM leaderboard_entries WHERE player_id = ?')
      .get(pid) as { nickname_snapshot: string | null }
    expect(row.nickname_snapshot).toBe('Kazakh')
  })

  it('201 — nickname_snapshot is NULL for anonymous player', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid, null)

    const res = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 42 })

    expect(res.status).toBe(201)
    const row = db
      .prepare('SELECT nickname_snapshot FROM leaderboard_entries WHERE player_id = ?')
      .get(pid) as { nickname_snapshot: string | null }
    expect(row.nickname_snapshot).toBeNull()
  })

  it('201 — stores opaque run_metadata blob', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid)
    const meta = { kills: 5, time_ms: 120_000 }

    await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 100, run_metadata: meta })

    const row = db
      .prepare('SELECT run_metadata FROM leaderboard_entries WHERE player_id = ?')
      .get(pid) as { run_metadata: string | null }
    expect(JSON.parse(row.run_metadata!)).toEqual(meta)
  })

  // ── Keep-best semantics ──────────────────────────────────────────────────

  it('201 — higher score updates the existing row (same entry_id)', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid)

    const first = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 1000 })
    expect(first.status).toBe(201)
    const { entry_id } = first.body as { entry_id: string }

    const second = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 5000 })

    expect(second.status).toBe(201)
    expect(second.body.entry_id).toBe(entry_id)

    const row = db
      .prepare('SELECT score FROM leaderboard_entries WHERE entry_id = ?')
      .get(entry_id) as { score: number }
    expect(row.score).toBe(5000)
  })

  it('409 — lower score returns kept:existing with rank', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid)

    await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 9000 })

    const res = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 1000 })

    expect(res.status).toBe(409)
    expect(res.body.kept).toBe('existing')
    expect(typeof res.body.rank).toBe('number')
  })

  it('409 — equal score is also kept-best', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid)

    await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 9000 })

    const res = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 9000 })

    expect(res.status).toBe(409)
  })

  it('entries are independent per (zone, faction) — different faction allows new entry', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid)

    await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 9000 })

    const res = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'wolves', score: 100 })

    expect(res.status).toBe(201)
  })

  // ── Authentication ───────────────────────────────────────────────────────

  it('401 — no cookie', async () => {
    const res = await request(app)
      .post('/api/leaderboard')
      .send({ zone: 'forest', faction: 'bandits', score: 100 })

    expect(res.status).toBe(401)
  })

  it('401 — tampered cookie is rejected by cookieAuth middleware', async () => {
    const res = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', `${COOKIE_NAME}=aaaaaaaa-0001-4000-a000-000000000001.badsig`)
      .send({ zone: 'forest', faction: 'bandits', score: 100 })

    expect(res.status).toBe(401)
  })

  // ── Input validation ─────────────────────────────────────────────────────

  it('400 — invalid zone', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid)

    const res = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'moon', faction: 'bandits', score: 100 })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_zone')
  })

  it('400 — invalid faction', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid)

    const res = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'robots', score: 100 })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_faction')
  })

  it('400 — score is negative', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid)

    const res = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: -1 })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_score')
  })

  it('400 — score exceeds MAX_SCORE (1e9)', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid)

    const res = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 1_000_000_001 })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_score')
  })

  it('400 — score is a float', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid)

    const res = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 100.5 })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_score')
  })

  it('400 — run_metadata exceeds 4 KB', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid)

    const res = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 100, run_metadata: { data: 'x'.repeat(5000) } })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('run_metadata_too_large')
  })

  it('201 — score of 0 is valid', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid)

    const res = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 0 })

    expect(res.status).toBe(201)
  })

  it('201 — score exactly at MAX_SCORE (1e9) is valid', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid)

    const res = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 1_000_000_000 })

    expect(res.status).toBe(201)
  })

  // ── Rate limiting ────────────────────────────────────────────────────────

  it('429 — identity rate limit after identityPerMin requests', async () => {
    const pid = 'aaaaaaaa-0001-4000-a000-000000000001'
    insertPlayer(db, pid)
    const { identityPerMin } = ENDPOINT_PROFILES['POST /api/leaderboard']

    // Exhaust the per-identity window.
    for (let i = 0; i < identityPerMin; i++) {
      const r = await request(app)
        .post('/api/leaderboard')
        .set('Cookie', signCookie(pid))
        .send({ zone: 'forest', faction: 'bandits', score: i })
      // First identityPerMin requests must succeed (201 or 409 keep-best).
      expect([201, 409]).toContain(r.status)
    }

    // The next request must be rate-limited.
    const res = await request(app)
      .post('/api/leaderboard')
      .set('Cookie', signCookie(pid))
      .send({ zone: 'forest', faction: 'bandits', score: 999 })

    expect(res.status).toBe(429)
    expect(res.body.error).toBe('Too Many Requests')
    expect(typeof res.body.retryAfter).toBe('number')
    expect(res.headers['retry-after']).toBeDefined()
  })
})
