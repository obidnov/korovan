import { describe, it, expect, beforeEach, vi } from 'vitest'
import express, { type Express, Router } from 'express'
import request from 'supertest'
import {
  _resetStore,
  checkAndIncrement,
  checkDailyBudget,
  createRateLimiter,
  retryAfterSeconds,
  type DailyBudgetStore,
} from '../src/middleware/rateLimit'
import { listen } from './helpers/listen'

// ─── helpers ────────────────────────────────────────────────────────────────

function makeApp(identityPerMin: number, ipPerMin: number, playerId?: string): Express {
  const app = express()
  // Trust proxy = 1 so req.ip reads X-Forwarded-For (matches production setup).
  app.set('trust proxy', 1)
  app.use((req, _res, next) => {
    if (playerId) req.playerId = playerId
    next()
  })
  app.post(
    '/api/llm/decide',
    createRateLimiter({ identityPerMin, ipPerMin }),
    (_req, res) => res.json({ ok: true }),
  )
  return app
}

/**
 * Builds an app with TWO sub-routers, each with the same limiter instance/profile,
 * mounted at different paths. Used to verify counter isolation (BOO-512).
 */
function makeTwoRouterApp(ipPerMin: number): Express {
  const app = express()
  app.set('trust proxy', 1)
  const limiter = createRateLimiter({ identityPerMin: 1000, ipPerMin })
  const routerA = Router()
  routerA.post('/', limiter, (_req, res) => res.json({ endpoint: 'A' }))
  const routerB = Router()
  routerB.post('/', limiter, (_req, res) => res.json({ endpoint: 'B' }))
  app.use('/api/leaderboard', routerA)
  app.use('/api/saves', routerB)
  return app
}

// ─── window helpers ──────────────────────────────────────────────────────────

describe('retryAfterSeconds', () => {
  it('returns ≤60 and >0', () => {
    const s = retryAfterSeconds()
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThanOrEqual(60)
  })
})

// ─── checkAndIncrement ───────────────────────────────────────────────────────

describe('checkAndIncrement', () => {
  beforeEach(_resetStore)

  it('allows requests within the limit', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkAndIncrement('key1', 5)).toBe(true)
    }
  })

  it('blocks the (limit+1)th request in the same window', () => {
    for (let i = 0; i < 5; i++) checkAndIncrement('key1', 5)
    expect(checkAndIncrement('key1', 5)).toBe(false)
  })

  it('resets counter on window change', () => {
    const t0 = 1_000_000
    checkAndIncrement('key1', 1, t0)
    expect(checkAndIncrement('key1', 1, t0)).toBe(false) // same window
    // Next window (60 001 ms later)
    const t1 = t0 + 60_001
    expect(checkAndIncrement('key1', 1, t1)).toBe(true)
  })

  it('keys are independent', () => {
    checkAndIncrement('keyA', 1)
    expect(checkAndIncrement('keyA', 1)).toBe(false)
    expect(checkAndIncrement('keyB', 1)).toBe(true) // different key
  })
})

// ─── per-identity rate limit ──────────────────────────────────────────────────

describe('createRateLimiter — per-identity limit', () => {
  beforeEach(_resetStore)

  it('burst 70 calls → 60 succeed, 10 get 429', async () => {
    // BOO-507: TWO determinism fixes for this test:
    //   (1) Pin `Date.now()` so the middleware's 60-second `_windowStart()`
    //       bucket doesn't roll mid-burst under CPU load. Surgical spy — keeps
    //       `new Date()` live so the HTTP stack's `Date` response header still
    //       works (`vi.useFakeTimers({ toFake: ['Date'] })` mocks Date wholesale
    //       and causes `Error: Parse Error: Expected HTTP/` in supertest).
    //   (2) Share ONE listener across all 70 requests instead of supertest's
    //       default per-call `app.listen(0)`. 70 rapid listen/close cycles
    //       exhaust the macOS ephemeral-port pool and TIME_WAIT recycling
    //       produces sporadic `socket hang up`, `ECONNRESET`, and wrong-status
    //       responses.
    const FROZEN_MS = new Date('2026-01-01T00:00:30.000Z').getTime()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(FROZEN_MS)
    const { server, close } = listen(makeApp(60, 600, 'player-001'))
    try {
      let ok = 0
      let tooMany = 0
      for (let i = 0; i < 70; i++) {
        const res = await request(server)
          .post('/api/llm/decide')
          .set('X-Forwarded-For', '10.0.0.1')
        if (res.status === 200) ok++
        else if (res.status === 429) tooMany++
      }
      expect(ok).toBe(60)
      expect(tooMany).toBe(10)
    } finally {
      nowSpy.mockRestore()
      await close()
    }
  })

  it('429 response includes Retry-After header', async () => {
    const { server, close } = listen(makeApp(1, 1000, 'player-002'))
    try {
      await request(server).post('/api/llm/decide').set('X-Forwarded-For', '10.0.0.2')
      const res = await request(server).post('/api/llm/decide').set('X-Forwarded-For', '10.0.0.2')
      expect(res.status).toBe(429)
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0)
    } finally {
      await close()
    }
  })

  it('same player, two different IPs → per-identity limit still binds', async () => {
    const { server, close } = listen(makeApp(5, 1000, 'player-003'))
    try {
      // 5 calls from IP A — exhausts identity budget
      for (let i = 0; i < 5; i++) {
        await request(server).post('/api/llm/decide').set('X-Forwarded-For', '10.1.0.1')
      }
      // 6th call from IP B → 429 because identity counter is exhausted
      const res = await request(server).post('/api/llm/decide').set('X-Forwarded-For', '10.1.0.2')
      expect(res.status).toBe(429)
    } finally {
      await close()
    }
  })
})

// ─── per-IP rate limit ────────────────────────────────────────────────────────

describe('createRateLimiter — per-IP limit', () => {
  beforeEach(_resetStore)

  it('two players, one IP → per-IP ceiling applies; one can starve the other', async () => {
    // IP budget = 5, identity budget = 100 (effectively unlimited per-player)
    const handleA = listen(makeApp(100, 5, 'playerA'))
    const handleB = listen(makeApp(100, 5, 'playerB'))
    try {
      // Player A exhausts the shared IP budget
      for (let i = 0; i < 5; i++) {
        await request(handleA.server).post('/api/llm/decide').set('X-Forwarded-For', '192.168.1.1')
      }
      // Player B (same IP) hits 429
      const res = await request(handleB.server).post('/api/llm/decide').set('X-Forwarded-For', '192.168.1.1')
      expect(res.status).toBe(429)
    } finally {
      await handleA.close()
      await handleB.close()
    }
  })

  it('same player, different IPs share per-identity limit but not per-IP limit', async () => {
    // identity budget = 3, ip budget = 100
    const { server, close } = listen(makeApp(3, 100, 'player-x'))
    try {
      // First 3 from IP1 — succeeds
      for (let i = 0; i < 3; i++) {
        const res = await request(server).post('/api/llm/decide').set('X-Forwarded-For', '1.1.1.1')
        expect(res.status).toBe(200)
      }
      // 4th from IP2 — hits identity limit (not IP limit)
      const res = await request(server).post('/api/llm/decide').set('X-Forwarded-For', '2.2.2.2')
      expect(res.status).toBe(429)
    } finally {
      await close()
    }
  })

  it('unknown player (no playerId) falls back to IP-only limiting', async () => {
    // No playerId → identity check skipped
    const { server, close } = listen(makeApp(1, 3)) // identity limit 1, but no playerId attached
    try {
      for (let i = 0; i < 3; i++) {
        const res = await request(server).post('/api/llm/decide').set('X-Forwarded-For', '5.5.5.5')
        expect(res.status).toBe(200)
      }
      const res = await request(server).post('/api/llm/decide').set('X-Forwarded-For', '5.5.5.5')
      expect(res.status).toBe(429)
    } finally {
      await close()
    }
  })
})

// ─── checkDailyBudget ─────────────────────────────────────────────────────────

describe('checkDailyBudget', () => {
  const factions = ['bandits', 'forest_spirits', 'merchants']

  it('aggregates decisions across factions correctly', async () => {
    const store: DailyBudgetStore = {
      recentDecisions: vi.fn(async (_playerId, faction) => {
        return faction === 'bandits' ? 10 : faction === 'forest_spirits' ? 5 : 3
      }),
    }
    const result = await checkDailyBudget('player-1', store, factions)
    expect(result.usedToday).toBe(18) // 10 + 5 + 3
    expect(typeof result.over).toBe('boolean')
  })

  it('returns over:false when under the budget threshold', async () => {
    const store: DailyBudgetStore = {
      recentDecisions: vi.fn(async () => 1),
    }
    const result = await checkDailyBudget('player-2', store, factions)
    expect(result.over).toBe(false)
    expect(result.usedToday).toBe(3) // 1 per faction × 3 factions
  })

  it('returns correct usedToday when a faction has zero decisions', async () => {
    const store: DailyBudgetStore = {
      recentDecisions: vi.fn(async (_p, faction) => (faction === 'bandits' ? 7 : 0)),
    }
    const result = await checkDailyBudget('player-3', store, factions)
    expect(result.usedToday).toBe(7)
  })

  it('calls recentDecisions for every faction', async () => {
    const spy = vi.fn(async () => 0)
    const store: DailyBudgetStore = { recentDecisions: spy }
    await checkDailyBudget('player-4', store, factions)
    expect(spy).toHaveBeenCalledTimes(factions.length)
    for (const f of factions) {
      expect(spy).toHaveBeenCalledWith('player-4', f, 86_400_000)
    }
  })
})

// ─── cross-endpoint counter isolation (BOO-512 regression) ──────────────────
//
// Before the fix, req.path inside a sub-router was always "/", so every limiter
// shared the key "POST /" and counters collided across mounted endpoints.
// After the fix, originalUrl is used, giving distinct keys per mount path.

describe('createRateLimiter — cross-endpoint counter isolation', () => {
  beforeEach(_resetStore)

  it('exhausting /api/leaderboard does NOT exhaust /api/saves', async () => {
    const IP = '10.0.1.1'
    // ipPerMin=3: POST /api/leaderboard is exhausted after 3 calls.
    const { server, close } = listen(makeTwoRouterApp(3))
    try {
      for (let i = 0; i < 3; i++) {
        const res = await request(server).post('/api/leaderboard').set('X-Forwarded-For', IP)
        expect(res.status).toBe(200)
      }
      // /api/leaderboard is now exhausted
      const blocked = await request(server).post('/api/leaderboard').set('X-Forwarded-For', IP)
      expect(blocked.status).toBe(429)

      // /api/saves must still have its own fresh counter
      const saved = await request(server).post('/api/saves').set('X-Forwarded-For', IP)
      expect(saved.status).toBe(200)
    } finally {
      await close()
    }
  })

  it('exhausting /api/saves does NOT exhaust /api/leaderboard', async () => {
    const IP = '10.0.1.2'
    const { server, close } = listen(makeTwoRouterApp(2))
    try {
      for (let i = 0; i < 2; i++) {
        await request(server).post('/api/saves').set('X-Forwarded-For', IP)
      }
      const blocked = await request(server).post('/api/saves').set('X-Forwarded-For', IP)
      expect(blocked.status).toBe(429)

      const res = await request(server).post('/api/leaderboard').set('X-Forwarded-For', IP)
      expect(res.status).toBe(200)
    } finally {
      await close()
    }
  })

  it('single-consumer case unchanged: /api/leaderboard still enforces its own limit', async () => {
    const IP = '10.0.1.3'
    const { server, close } = listen(makeTwoRouterApp(3))
    try {
      for (let i = 0; i < 3; i++) {
        expect(
          (await request(server).post('/api/leaderboard').set('X-Forwarded-For', IP)).status,
        ).toBe(200)
      }
      expect(
        (await request(server).post('/api/leaderboard').set('X-Forwarded-For', IP)).status,
      ).toBe(429)
    } finally {
      await close()
    }
  })
})
