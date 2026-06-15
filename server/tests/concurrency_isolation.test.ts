import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from '../src/app'
import { setDb, closeDb } from '../src/db'
import { listen, type ListenHandle } from './helpers/listen'

function buildDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const sql = readFileSync(join(__dirname, '..', 'migrations', '0001_init.sql'), 'utf8')
  db.exec(sql)
  return db
}

// BOO-507 regression sentinel: 8 rapid GET /api/leaderboard requests via a
// shared listener. If singleThread is ever removed and supertest(app) per-call
// is re-introduced, TIME_WAIT port exhaustion causes sporadic 404/503 here.
describe('concurrency isolation sentinel (BOO-507)', () => {
  let handle: ListenHandle

  beforeAll(() => {
    handle = listen(app)
  })

  afterAll(async () => {
    await handle.close()
  })

  beforeEach(() => {
    setDb(buildDb())
  })

  afterEach(() => {
    closeDb()
  })

  it('8 rapid leaderboard requests never return 404 or 503', async () => {
    for (let i = 0; i < 8; i++) {
      const res = await request(handle.server)
        .get('/api/leaderboard?zone=forest&faction=bandits')
      expect([200, 400]).toContain(res.status)
    }
  })
})
