import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'
import supertest from 'supertest'
import { readFileSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'
import { app } from '../src/app'
import { setDb, closeDb } from '../src/db'
import { listen, type ListenHandle } from './helpers/listen'
import { _resetStore } from '../src/middleware/rateLimit'

// TEST_SECRET must match the value set in vitest.config.ts COOKIE_SIGNING_SECRET env.
const TEST_SECRET = 'test-signing-secret-min-32-bytes!!'

function makeCookie(playerId: string): string {
  const sig = createHmac('sha256', TEST_SECRET).update(playerId).digest('hex')
  // BOO-470 format: <uuid>.<hex-sig>  (UUID_LEN=36, dot at index 36)
  return `kr_pid=${playerId}.${sig}`
}

function buildDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const sql = readFileSync(join(__dirname, '..', 'migrations', '0001_init.sql'), 'utf8')
  db.exec(sql)
  return db
}

function seedPlayer(db: Database.Database, playerId: string): void {
  const now = Date.now()
  db.prepare(
    'INSERT INTO players (player_id, nickname, created_at, last_seen_at, cookie_version) VALUES (?, ?, ?, ?, ?)',
  ).run(playerId, null, now, now, 1)
}

// BOO-507: share one HTTP listener for the whole file so supertest reuses it
// instead of opening+closing a new server per request (which races macOS
// ephemeral-port recycling and produces sporadic status mismatches).
let handle: ListenHandle
beforeAll(() => { handle = listen(app) })
afterAll(async () => { await handle.close() })

describe('POST /api/saves', () => {
  const PLAYER_ID = 'a0000000-0000-4000-8000-000000000001'
  let db: Database.Database

  beforeEach(() => {
    _resetStore()
    db = buildDb()
    setDb(db)
    seedPlayer(db, PLAYER_ID)
  })

  afterEach(() => {
    closeDb()
  })

  it('new save → 200 + row in saves', async () => {
    const res = await supertest(handle.server)
      .post('/api/saves')
      .set('Cookie', makeCookie(PLAYER_ID))
      .send({ slot: 0, version: 1, payload: { hp: 100, position: [0, 0, 0] } })

    expect(res.status).toBe(200)
    expect(typeof res.body.save_id).toBe('string')
    expect(typeof res.body.updated_at).toBe('number')

    const row = db
      .prepare('SELECT * FROM saves WHERE player_id = ? AND slot = ?')
      .get(PLAYER_ID, 0) as { save_id: string; version: number; payload: string } | undefined
    expect(row).toBeDefined()
    expect(row?.save_id).toBe(res.body.save_id)
    expect(row?.version).toBe(1)
    expect(JSON.parse(row!.payload)).toMatchObject({ hp: 100 })
  })

  it('update existing slot → 200; single row, updated_at increases', async () => {
    const before = Date.now()

    const r1 = await supertest(handle.server)
      .post('/api/saves')
      .set('Cookie', makeCookie(PLAYER_ID))
      .send({ slot: 0, version: 1, payload: { hp: 100 } })
    expect(r1.status).toBe(200)
    const saveId1 = r1.body.save_id as string

    const r2 = await supertest(handle.server)
      .post('/api/saves')
      .set('Cookie', makeCookie(PLAYER_ID))
      .send({ slot: 0, version: 2, payload: { hp: 80 } })
    expect(r2.status).toBe(200)

    // save_id must be preserved (upsert keeps same row)
    expect(r2.body.save_id).toBe(saveId1)
    expect(r2.body.updated_at).toBeGreaterThanOrEqual(before)

    const rows = db
      .prepare('SELECT * FROM saves WHERE player_id = ? AND slot = ?')
      .all(PLAYER_ID, 0)
    expect(rows).toHaveLength(1)

    const row = rows[0] as { payload: string; updated_at: number }
    expect(JSON.parse(row.payload)).toMatchObject({ hp: 80 })
    expect(row.updated_at).toBeGreaterThanOrEqual(before)
  })

  it('payload > 64 KB → 413', async () => {
    const bigPayload = { data: 'x'.repeat(65 * 1024) }

    const res = await supertest(handle.server)
      .post('/api/saves')
      .set('Cookie', makeCookie(PLAYER_ID))
      .send({ slot: 0, version: 1, payload: bigPayload })

    expect(res.status).toBe(413)
  })

  it('older version than stored → 409', async () => {
    await supertest(handle.server)
      .post('/api/saves')
      .set('Cookie', makeCookie(PLAYER_ID))
      .send({ slot: 0, version: 5, payload: { hp: 100 } })

    const res = await supertest(handle.server)
      .post('/api/saves')
      .set('Cookie', makeCookie(PLAYER_ID))
      .send({ slot: 0, version: 3, payload: { hp: 50 } })

    expect(res.status).toBe(409)
    expect(res.body.stored_version).toBe(5)
  })

  it('missing cookie → 401', async () => {
    const res = await supertest(handle.server)
      .post('/api/saves')
      .send({ slot: 0, version: 1, payload: { hp: 100 } })

    expect(res.status).toBe(401)
  })
})

describe('GET /api/saves/me', () => {
  const PLAYER_ID = 'a0000000-0000-4000-8000-000000000002'
  let db: Database.Database

  beforeEach(() => {
    db = buildDb()
    setDb(db)
    seedPlayer(db, PLAYER_ID)
  })

  afterEach(() => {
    closeDb()
  })

  it('player with no save → 204', async () => {
    const res = await supertest(handle.server)
      .get('/api/saves/me')
      .set('Cookie', makeCookie(PLAYER_ID))

    expect(res.status).toBe(204)
  })

  it('player with save → 200 + full save body', async () => {
    // seed a save directly
    db.prepare(
      'INSERT INTO saves (save_id, player_id, slot, version, payload, updated_at, client_clock_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('save-0001', PLAYER_ID, 0, 3, JSON.stringify({ hp: 75 }), 1000, 999)

    const res = await supertest(handle.server)
      .get('/api/saves/me')
      .set('Cookie', makeCookie(PLAYER_ID))

    expect(res.status).toBe(200)
    expect(res.body.save_id).toBe('save-0001')
    expect(res.body.slot).toBe(0)
    expect(res.body.version).toBe(3)
    expect(res.body.payload).toMatchObject({ hp: 75 })
    expect(res.body.updated_at).toBe(1000)
    expect(res.body.client_clock_ms).toBe(999)
  })

  it('?slot=1 with no save at slot 1 → 204', async () => {
    // seed slot 0
    db.prepare(
      'INSERT INTO saves (save_id, player_id, slot, version, payload, updated_at, client_clock_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('save-0002', PLAYER_ID, 0, 1, JSON.stringify({ hp: 100 }), 1000, 999)

    const res = await supertest(handle.server)
      .get('/api/saves/me?slot=1')
      .set('Cookie', makeCookie(PLAYER_ID))

    expect(res.status).toBe(204)
  })

  it('missing cookie → 401', async () => {
    const res = await supertest(handle.server).get('/api/saves/me')
    expect(res.status).toBe(401)
  })

  it('Cache-Control: no-store header set', async () => {
    const res = await supertest(handle.server)
      .get('/api/saves/me')
      .set('Cookie', makeCookie(PLAYER_ID))

    expect(res.headers['cache-control']).toBe('no-store')
  })
})

describe('POST /api/saves — rate limiting', () => {
  const RL_PLAYER_ID = 'b0000000-0000-4000-8000-000000000003'
  let db: Database.Database

  beforeEach(() => {
    _resetStore()
    db = buildDb()
    setDb(db)
    seedPlayer(db, RL_PLAYER_ID)
  })

  afterEach(() => {
    closeDb()
  })

  it(
    'burst 31 from same player → first 30 pass (200/409), 31st gets 429',
    async () => {
      let passCount = 0
      for (let v = 1; v <= 30; v++) {
        const res = await supertest(handle.server)
          .post('/api/saves')
          .set('Cookie', makeCookie(RL_PLAYER_ID))
          .set('X-Forwarded-For', '10.10.10.1')
          .send({ slot: 0, version: v, payload: { v } })
        expect(res.status, `request ${v} should not be rate-limited`).not.toBe(429)
        passCount++
      }
      expect(passCount).toBe(30)

      const blocked = await supertest(handle.server)
        .post('/api/saves')
        .set('Cookie', makeCookie(RL_PLAYER_ID))
        .set('X-Forwarded-For', '10.10.10.1')
        .send({ slot: 0, version: 31, payload: { v: 31 } })
      expect(blocked.status).toBe(429)
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    },
    { timeout: 30_000 },
  )

  it(
    'burst 301 from same IP (no cookie) → first 300 not rate-limited, 301st gets 429',
    async () => {
      for (let i = 1; i <= 300; i++) {
        const res = await supertest(handle.server)
          .post('/api/saves')
          .set('X-Forwarded-For', '10.20.30.40')
          .send({ slot: 0, version: 1, payload: {} })
        // Rate limiter passes; saves handler returns 401 (no cookie) — not 429.
        expect(res.status, `request ${i} should not be rate-limited`).not.toBe(429)
      }

      const blocked = await supertest(handle.server)
        .post('/api/saves')
        .set('X-Forwarded-For', '10.20.30.40')
        .send({ slot: 0, version: 1, payload: {} })
      expect(blocked.status).toBe(429)
    },
    { timeout: 60_000 },
  )
})
