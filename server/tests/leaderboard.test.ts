import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from '../src/app'
import { setDb, closeDb } from '../src/db'
import { _resetQueryCount, _queryCount, _clearCache } from '../src/routes/leaderboard'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInMemoryDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const sql = readFileSync(
    join(__dirname, '..', 'migrations', '0001_init.sql'),
    'utf8',
  )
  db.exec(sql)
  return db
}

function insertPlayer(db: Database.Database, playerId: string, nickname: string | null = null): void {
  db.prepare(
    `INSERT INTO players(player_id, nickname, created_at, last_seen_at) VALUES (?, ?, ?, ?)`,
  ).run(playerId, nickname, Date.now(), Date.now())
}

function insertEntry(
  db: Database.Database,
  opts: {
    entryId: string
    playerId: string
    zone: string
    faction: string
    score: number
    nicknameSnapshot?: string | null
    submittedAt?: number
  },
): void {
  db.prepare(
    `INSERT INTO leaderboard_entries(entry_id, player_id, zone, faction, score, nickname_snapshot, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.entryId,
    opts.playerId,
    opts.zone,
    opts.faction,
    opts.score,
    opts.nicknameSnapshot ?? null,
    opts.submittedAt ?? Date.now(),
  )
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: Database.Database

beforeEach(() => {
  db = buildInMemoryDb()
  setDb(db)
  _resetQueryCount()
  _clearCache()
})

afterEach(() => {
  closeDb()
})

// ---------------------------------------------------------------------------
// AC1 — Empty leaderboard → 200 + empty entries
// ---------------------------------------------------------------------------

describe('GET /api/leaderboard', () => {
  it('returns 200 with empty entries when leaderboard is empty', async () => {
    const res = await request(app)
      .get('/api/leaderboard?zone=forest&faction=bandits')
      .expect(200)

    expect(res.body).toEqual({ zone: 'forest', faction: 'bandits', entries: [] })
  })

  // -------------------------------------------------------------------------
  // AC2 — Two entries ordered by score DESC
  // -------------------------------------------------------------------------

  it('returns entries ordered by score descending', async () => {
    insertPlayer(db, 'player-aaa')
    insertPlayer(db, 'player-bbb')
    insertEntry(db, { entryId: 'e1', playerId: 'player-aaa', zone: 'forest', faction: 'bandits', score: 500, nicknameSnapshot: 'Hero' })
    insertEntry(db, { entryId: 'e2', playerId: 'player-bbb', zone: 'forest', faction: 'bandits', score: 9001, nicknameSnapshot: 'Legend' })

    const res = await request(app)
      .get('/api/leaderboard?zone=forest&faction=bandits')
      .expect(200)

    expect(res.body.entries).toHaveLength(2)
    expect(res.body.entries[0].rank).toBe(1)
    expect(res.body.entries[0].nickname).toBe('Legend')
    expect(res.body.entries[0].score).toBe(9001)
    expect(res.body.entries[1].rank).toBe(2)
    expect(res.body.entries[1].nickname).toBe('Hero')
    expect(res.body.entries[1].score).toBe(500)
  })

  // -------------------------------------------------------------------------
  // AC3 — Anonymous fallback when nickname_snapshot is NULL
  // -------------------------------------------------------------------------

  it('falls back to Anonymous # + first 6 chars of player_id when nickname_snapshot is null', async () => {
    const playerId = 'abcdef-1234-5678-abcd-ef0123456789'
    insertPlayer(db, playerId)
    insertEntry(db, { entryId: 'e3', playerId, zone: 'forest', faction: 'bandits', score: 100 })

    const res = await request(app)
      .get('/api/leaderboard?zone=forest&faction=bandits')
      .expect(200)

    expect(res.body.entries[0].nickname).toBe('Anonymous #abcdef')
  })

  // -------------------------------------------------------------------------
  // AC4 — Invalid zone → 400
  // -------------------------------------------------------------------------

  it('returns 400 for an invalid zone', async () => {
    const res = await request(app)
      .get('/api/leaderboard?zone=atlantis&faction=bandits')
      .expect(400)

    expect(res.body.error).toBe('invalid_zone')
  })

  it('returns 400 when zone param is missing', async () => {
    await request(app)
      .get('/api/leaderboard?faction=bandits')
      .expect(400)
  })

  // -------------------------------------------------------------------------
  // AC5 — Limit > 100 → 400
  // -------------------------------------------------------------------------

  it('returns 400 when limit > 100', async () => {
    const res = await request(app)
      .get('/api/leaderboard?zone=forest&faction=bandits&limit=101')
      .expect(400)

    expect(res.body.error).toBe('invalid_limit')
  })

  it('returns 400 for non-integer limit', async () => {
    await request(app)
      .get('/api/leaderboard?zone=forest&faction=bandits&limit=abc')
      .expect(400)
  })

  it('accepts limit=100 (boundary)', async () => {
    await request(app)
      .get('/api/leaderboard?zone=forest&faction=bandits&limit=100')
      .expect(200)
  })

  // -------------------------------------------------------------------------
  // AC6 — Cache hit: second request within 30 s served from memory
  //        Verified via _queryCount (increments only on real DB query)
  // -------------------------------------------------------------------------

  it('serves second identical request from cache without hitting the DB', async () => {
    expect(_queryCount).toBe(0)

    await request(app)
      .get('/api/leaderboard?zone=forest&faction=bandits')
      .expect(200)

    expect(_queryCount).toBe(1)

    await request(app)
      .get('/api/leaderboard?zone=forest&faction=bandits')
      .expect(200)

    // Still 1 — second request served from cache.
    expect(_queryCount).toBe(1)
  })

  it('uses separate cache entries for different zone/faction/limit combinations', async () => {
    await request(app).get('/api/leaderboard?zone=forest&faction=bandits').expect(200)
    await request(app).get('/api/leaderboard?zone=ruins&faction=bandits').expect(200)
    await request(app).get('/api/leaderboard?zone=forest&faction=wolves').expect(200)
    await request(app).get('/api/leaderboard?zone=forest&faction=bandits&limit=5').expect(200)

    expect(_queryCount).toBe(4)
  })

  // -------------------------------------------------------------------------
  // Additional — invalid faction → 400
  // -------------------------------------------------------------------------

  it('returns 400 for an invalid faction', async () => {
    const res = await request(app)
      .get('/api/leaderboard?zone=forest&faction=unicorns')
      .expect(400)

    expect(res.body.error).toBe('invalid_faction')
  })

  // -------------------------------------------------------------------------
  // Response shape — submitted_at is a number
  // -------------------------------------------------------------------------

  it('includes submitted_at as unix ms number', async () => {
    const ts = 1718432000123
    insertPlayer(db, 'p-ts')
    insertEntry(db, { entryId: 'e-ts', playerId: 'p-ts', zone: 'forest', faction: 'bandits', score: 1, submittedAt: ts })

    const res = await request(app)
      .get('/api/leaderboard?zone=forest&faction=bandits')
      .expect(200)

    expect(res.body.entries[0].submitted_at).toBe(ts)
  })
})
