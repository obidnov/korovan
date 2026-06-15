import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
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
import { listen, type ListenHandle } from './helpers/listen'

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
//
// BOO-507: pre-allocate all three servers at describe scope.
// Per-test listen/close cycles race macOS TIME_WAIT port recycling even under
// singleThread sequential execution — observed as ok=0 cold-start on Run-1 (burst)
// and sporadic 404 on Run-1 (two-player test). One beforeAll per describe
// eliminates all intra-describe listen/close cycles.

describe('createRateLimiter — per-identity limit', () => {
  let burst70Handle: ListenHandle
  let retryAfterHandle: ListenHandle
  let twoIpsHandle: ListenHandle

  beforeAll(() => {
    burst70Handle = listen(makeApp(60, 600, 'player-001'))
    retryAfterHandle = listen(makeApp(1, 1000, 'player-002'))
    twoIpsHandle = listen(makeApp(5, 1000, 'player-003'))
  })

  afterAll(async () => {
    await burst70Handle.close()
    await retryAfterHandle.close()
    await twoIpsHandle.close()
  })

  beforeEach(_resetStore)

  it('burst 70 calls → 60 succeed, 10 get 429', async () => {
    // BOO-507: TWO determinism fixes for this test:
    //   (1) Pin `Date.now()` so the middleware's 60-second `_windowStart()`
    //       bucket doesn't roll mid-burst under CPU load. Surgical spy — keeps
    //       `new Date()` live so the HTTP stack's `Date` response header still
    //       works (`vi.useFakeTimers({ toFake: ['Date'] })` mocks Date wholesale
    //       and causes `Error: Parse Error: Expected HTTP/` in supertest).
    //   (2) Server is pre-warmed from beforeAll — no cold-start race that caused
    //       ok=0 when listen() was called inside the test body (Run-1 failure).
    const FROZEN_MS = new Date('2026-01-01T00:00:30.000Z').getTime()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(FROZEN_MS)
    try {
      let ok = 0
      let tooMany = 0
      for (let i = 0; i < 70; i++) {
        const res = await request(burst70Handle.server)
          .post('/api/llm/decide')
          .set('X-Forwarded-For', '10.0.0.1')
        if (res.status === 200) ok++
        else if (res.status === 429) tooMany++
      }
      expect(ok).toBe(60)
      expect(tooMany).toBe(10)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('429 response includes Retry-After header', async () => {
    await request(retryAfterHandle.server).post('/api/llm/decide').set('X-Forwarded-For', '10.0.0.2')
    const res = await request(retryAfterHandle.server).post('/api/llm/decide').set('X-Forwarded-For', '10.0.0.2')
    expect(res.status).toBe(429)
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('same player, two different IPs → per-identity limit still binds', async () => {
    // 5 calls from IP A — exhausts identity budget
    for (let i = 0; i < 5; i++) {
      await request(twoIpsHandle.server).post('/api/llm/decide').set('X-Forwarded-For', '10.1.0.1')
    }
    // 6th call from IP B → 429 because identity counter is exhausted
    const res = await request(twoIpsHandle.server).post('/api/llm/decide').set('X-Forwarded-For', '10.1.0.2')
    expect(res.status).toBe(429)
  })
})

// ─── per-IP rate limit ────────────────────────────────────────────────────────
//
// BOO-507: pre-allocate all four servers at describe scope for the same reason as
// per-identity limit above. The two-player test requires two distinct apps (each
// has a hardcoded playerId in middleware); the others need their own configs.

describe('createRateLimiter — per-IP limit', () => {
  let twoPlayerHandleA: ListenHandle
  let twoPlayerHandleB: ListenHandle
  let diffIpsHandle: ListenHandle
  let noPlayerHandle: ListenHandle

  beforeAll(() => {
    // IP budget = 5, identity budget = 100 (effectively unlimited per-player)
    twoPlayerHandleA = listen(makeApp(100, 5, 'playerA'))
    twoPlayerHandleB = listen(makeApp(100, 5, 'playerB'))
    // identity budget = 3, ip budget = 100 (tests identity-based blocking)
    diffIpsHandle = listen(makeApp(3, 100, 'player-x'))
    // No playerId → identity check skipped; ip budget = 3
    noPlayerHandle = listen(makeApp(1, 3))
  })

  afterAll(async () => {
    await twoPlayerHandleA.close()
    await twoPlayerHandleB.close()
    await diffIpsHandle.close()
    await noPlayerHandle.close()
  })

  beforeEach(_resetStore)

  it('two players, one IP → per-IP ceiling applies; one can starve the other', async () => {
    // Player A exhausts the shared IP budget
    for (let i = 0; i < 5; i++) {
      await request(twoPlayerHandleA.server).post('/api/llm/decide').set('X-Forwarded-For', '192.168.1.1')
    }
    // Player B (same IP) hits 429
    const res = await request(twoPlayerHandleB.server).post('/api/llm/decide').set('X-Forwarded-For', '192.168.1.1')
    expect(res.status).toBe(429)
  })

  it('same player, different IPs share per-identity limit but not per-IP limit', async () => {
    // First 3 from IP1 — succeeds
    for (let i = 0; i < 3; i++) {
      const res = await request(diffIpsHandle.server).post('/api/llm/decide').set('X-Forwarded-For', '1.1.1.1')
      expect(res.status).toBe(200)
    }
    // 4th from IP2 — hits identity limit (not IP limit)
    const res = await request(diffIpsHandle.server).post('/api/llm/decide').set('X-Forwarded-For', '2.2.2.2')
    expect(res.status).toBe(429)
  })

  it('unknown player (no playerId) falls back to IP-only limiting', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(noPlayerHandle.server).post('/api/llm/decide').set('X-Forwarded-For', '5.5.5.5')
      expect(res.status).toBe(200)
    }
    const res = await request(noPlayerHandle.server).post('/api/llm/decide').set('X-Forwarded-For', '5.5.5.5')
    expect(res.status).toBe(429)
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
//
// BOO-507: share ONE server for all three counter-isolation tests to eliminate
// rapid listen/close cycles. Each test uses a distinct IP address so _resetStore()
// before each test is the only inter-test coupling. ipPerMin=3 is consistent
// across all three tests.

describe('createRateLimiter — cross-endpoint counter isolation', () => {
  let xEnpHandle: ListenHandle

  beforeAll(() => {
    // ipPerMin=3: each test exhausts the per-IP limit with 3 calls, then verifies
    // the sibling endpoint's counter remains independent. Tests use distinct IPs
    // (10.0.1.1, .2, .3) so _resetStore() between tests prevents cross-contamination.
    xEnpHandle = listen(makeTwoRouterApp(3))
  })

  afterAll(async () => {
    await xEnpHandle.close()
  })

  beforeEach(_resetStore)

  it('exhausting /api/leaderboard does NOT exhaust /api/saves', async () => {
    const IP = '10.0.1.1'
    // ipPerMin=3: POST /api/leaderboard is exhausted after 3 calls.
    for (let i = 0; i < 3; i++) {
      const res = await request(xEnpHandle.server).post('/api/leaderboard').set('X-Forwarded-For', IP)
      expect(res.status).toBe(200)
    }
    // /api/leaderboard is now exhausted
    const blocked = await request(xEnpHandle.server).post('/api/leaderboard').set('X-Forwarded-For', IP)
    expect(blocked.status).toBe(429)

    // /api/saves must still have its own fresh counter
    const saved = await request(xEnpHandle.server).post('/api/saves').set('X-Forwarded-For', IP)
    expect(saved.status).toBe(200)
  })

  it('exhausting /api/saves does NOT exhaust /api/leaderboard', async () => {
    const IP = '10.0.1.2'
    // Three calls exhaust /api/saves (ipPerMin=3 for this describe)
    for (let i = 0; i < 3; i++) {
      await request(xEnpHandle.server).post('/api/saves').set('X-Forwarded-For', IP)
    }
    const blocked = await request(xEnpHandle.server).post('/api/saves').set('X-Forwarded-For', IP)
    expect(blocked.status).toBe(429)

    const res = await request(xEnpHandle.server).post('/api/leaderboard').set('X-Forwarded-For', IP)
    expect(res.status).toBe(200)
  })

  it('single-consumer case unchanged: /api/leaderboard still enforces its own limit', async () => {
    const IP = '10.0.1.3'
    for (let i = 0; i < 3; i++) {
      expect(
        (await request(xEnpHandle.server).post('/api/leaderboard').set('X-Forwarded-For', IP)).status,
      ).toBe(200)
    }
    expect(
      (await request(xEnpHandle.server).post('/api/leaderboard').set('X-Forwarded-For', IP)).status,
    ).toBe(429)
  })
})
