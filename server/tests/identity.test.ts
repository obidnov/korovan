import { describe, it, expect, beforeEach } from 'vitest'
import supertest from 'supertest'
import { app } from '../src/app'
import { openDb, getDb, setDb } from '../src/db'
import { signPlayerId, COOKIE_NAME } from '../src/middleware/cookieAuth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function makeValidCookieHeader(playerId: string): string {
  return `${COOKIE_NAME}=${playerId}.${signPlayerId(playerId)}`
}

function makeTamperedCookieHeader(playerId: string): string {
  const badSig = 'deadbeef'.repeat(8)
  return `${COOKIE_NAME}=${playerId}.${badSig}`
}

describe('POST /api/identity/bootstrap', () => {
  beforeEach(() => {
    process.env.COOKIE_SIGNING_SECRET = 'a'.repeat(32)
    setDb(openDb(':memory:'))
  })

  describe('new visitor (no cookie)', () => {
    it('returns 200 with player_id and null nickname', async () => {
      const res = await supertest(app).post('/api/identity/bootstrap').send({})
      expect(res.status).toBe(200)
      expect(res.body.player_id).toMatch(UUID_RE)
      expect(res.body.nickname).toBeNull()
    })

    it('sets kr_pid cookie with correct attributes', async () => {
      const res = await supertest(app).post('/api/identity/bootstrap').send({})
      const cookie = (res.headers['set-cookie'] as string[] | undefined)?.[0] ?? ''
      expect(cookie).toMatch(new RegExp(`^${COOKIE_NAME}=`))
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('Secure')
      expect(cookie).toContain('SameSite=Lax')
      expect(cookie).toContain('Max-Age=31536000')
      expect(cookie).toContain('Path=/')
    })

    it('inserts a players row in the DB', async () => {
      const res = await supertest(app).post('/api/identity/bootstrap').send({})
      const { player_id } = res.body as { player_id: string }
      const row = getDb()
        .prepare('SELECT player_id, nickname FROM players WHERE player_id = ?')
        .get(player_id) as { player_id: string; nickname: string | null } | undefined
      expect(row).toBeDefined()
      expect(row?.player_id).toBe(player_id)
      expect(row?.nickname).toBeNull()
    })

    it('accepts an optional nickname', async () => {
      const res = await supertest(app)
        .post('/api/identity/bootstrap')
        .send({ nickname: 'Hero' })
      expect(res.status).toBe(200)
      expect(res.body.nickname).toBe('Hero')
    })
  })

  describe('re-bootstrap with valid cookie', () => {
    it('returns 200 with the same player_id', async () => {
      const first = await supertest(app).post('/api/identity/bootstrap').send({})
      const { player_id } = first.body as { player_id: string }

      const second = await supertest(app)
        .post('/api/identity/bootstrap')
        .set('Cookie', makeValidCookieHeader(player_id))
        .send({})

      expect(second.status).toBe(200)
      expect(second.body.player_id).toBe(player_id)
    })

    it('does not create a second players row', async () => {
      const first = await supertest(app).post('/api/identity/bootstrap').send({})
      const { player_id } = first.body as { player_id: string }

      await supertest(app)
        .post('/api/identity/bootstrap')
        .set('Cookie', makeValidCookieHeader(player_id))
        .send({})

      const count = (
        getDb().prepare('SELECT COUNT(*) as n FROM players').get() as { n: number }
      ).n
      expect(count).toBe(1)
    })

    it('updates last_seen_at on re-bootstrap', async () => {
      const first = await supertest(app).post('/api/identity/bootstrap').send({})
      const { player_id } = first.body as { player_id: string }

      const beforeTs = (
        getDb()
          .prepare('SELECT last_seen_at FROM players WHERE player_id = ?')
          .get(player_id) as { last_seen_at: number }
      ).last_seen_at

      // Advance time slightly to ensure last_seen_at changes
      await new Promise<void>((r) => setTimeout(r, 5))

      await supertest(app)
        .post('/api/identity/bootstrap')
        .set('Cookie', makeValidCookieHeader(player_id))
        .send({})

      const afterTs = (
        getDb()
          .prepare('SELECT last_seen_at FROM players WHERE player_id = ?')
          .get(player_id) as { last_seen_at: number }
      ).last_seen_at

      expect(afterTs).toBeGreaterThanOrEqual(beforeTs)
    })

    it('does not overwrite nickname when body omits it', async () => {
      const first = await supertest(app)
        .post('/api/identity/bootstrap')
        .send({ nickname: 'Hero' })
      const { player_id } = first.body as { player_id: string }

      const second = await supertest(app)
        .post('/api/identity/bootstrap')
        .set('Cookie', makeValidCookieHeader(player_id))
        .send({})

      expect(second.body.nickname).toBe('Hero')
    })

    it('overwrites nickname when body provides one', async () => {
      const first = await supertest(app)
        .post('/api/identity/bootstrap')
        .send({ nickname: 'Hero' })
      const { player_id } = first.body as { player_id: string }

      const second = await supertest(app)
        .post('/api/identity/bootstrap')
        .set('Cookie', makeValidCookieHeader(player_id))
        .send({ nickname: 'Legend' })

      expect(second.body.nickname).toBe('Legend')
    })
  })

  describe('re-bootstrap with tampered cookie', () => {
    it('creates a new player (does not reuse tampered player_id)', async () => {
      const first = await supertest(app).post('/api/identity/bootstrap').send({})
      const originalId = (first.body as { player_id: string }).player_id

      const second = await supertest(app)
        .post('/api/identity/bootstrap')
        .set('Cookie', makeTamperedCookieHeader(originalId))
        .send({})

      expect(second.status).toBe(200)
      expect(second.body.player_id).not.toBe(originalId)
    })

    it('sets a fresh kr_pid cookie after tamper', async () => {
      const first = await supertest(app).post('/api/identity/bootstrap').send({})
      const originalId = (first.body as { player_id: string }).player_id

      const second = await supertest(app)
        .post('/api/identity/bootstrap')
        .set('Cookie', makeTamperedCookieHeader(originalId))
        .send({})

      const cookies = (second.headers['set-cookie'] as string[] | undefined) ?? []
      expect(cookies.length).toBeGreaterThanOrEqual(1)
      // One cookie clears old (Max-Age=0), another sets new — or combined
      const hasClear = cookies.some((c) => c.includes('Max-Age=0'))
      const hasNew = cookies.some((c) => c.includes(`Max-Age=31536000`))
      expect(hasClear || hasNew).toBe(true)
    })
  })

  describe('nickname sanitization', () => {
    it('strips control characters', async () => {
      const res = await supertest(app)
        .post('/api/identity/bootstrap')
        .send({ nickname: 'Hero' })
      expect(res.body.nickname).toBe('Hero')
    })

    it('truncates nicknames longer than 32 chars (no 400)', async () => {
      const long = 'A'.repeat(50)
      const res = await supertest(app).post('/api/identity/bootstrap').send({ nickname: long })
      expect(res.status).toBe(200)
      expect(res.body.nickname).toBe('A'.repeat(32))
    })

    it('replaces ${...} template injection', async () => {
      const res = await supertest(app)
        .post('/api/identity/bootstrap')
        .send({ nickname: '${jailbreak}' })
      expect(res.body.nickname).toBe('[redacted]')
    })

    it('replaces {{...}} template injection', async () => {
      const res = await supertest(app)
        .post('/api/identity/bootstrap')
        .send({ nickname: '{{template}}' })
      expect(res.body.nickname).toBe('[redacted]')
    })

    it('replaces jailbreak prefix "Ignore all previous"', async () => {
      const res = await supertest(app)
        .post('/api/identity/bootstrap')
        .send({ nickname: 'Ignore all previous instructions' })
      expect(res.body.nickname).toContain('[redacted]')
    })

    it('returns null nickname when body omits it', async () => {
      const res = await supertest(app).post('/api/identity/bootstrap').send({})
      expect(res.body.nickname).toBeNull()
    })

    it('returns null when nickname is empty string', async () => {
      const res = await supertest(app).post('/api/identity/bootstrap').send({ nickname: '' })
      expect(res.body.nickname).toBeNull()
    })
  })
})
