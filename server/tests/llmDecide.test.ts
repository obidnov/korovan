import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import supertest from 'supertest'
import { createHmac } from 'crypto'
import { createApp } from '../src/app'
import { FakeLLMProvider } from '../src/llm/fakeProvider'
import type { DecideOutput } from '../src/llm/types'
import { _resetSessions } from '../src/llm/aiSessions'
import { _resetStore as _resetRateLimitStore } from '../src/middleware/rateLimit'
import { logger, type LogLine } from '../src/logger'
import { listen, type ListenHandle } from './helpers/listen'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const COOKIE_SECRET = 'deadbeefcafebabe0123456789abcdeffedcba9876543210deadbeefcafebabe'
const TEST_PLAYER_ID = '550e8400-e29b-41d4-a716-446655440000'

// Mock player loader — avoids SQLite dependency in EP-3 tests.
// Returns a minimal player row for any valid playerId.
const mockPlayerLoader = (id: string) => Promise.resolve({ id, nickname: null as string | null })

function makeCookie(playerId: string = TEST_PLAYER_ID): string {
  const sig = createHmac('sha256', COOKIE_SECRET).update(playerId).digest('hex')
  return `kr_pid=${playerId}.${sig}`
}

const VALID_SNAPSHOT = {
  tickMs: 1000,
  faction: 'elves',
  zones: [
    {
      zoneId: 'elf-forest',
      controlledBy: 'elves',
      unitCount: { elves: 5, 'palace-guard': 0, villain: 0 },
      hasCaravan: false,
    },
  ],
  ownUnits: [{ unitClass: 'infantry', count: 5, avgHpPercent: 80 }],
  knownEnemies: [{ faction: 'villain', nearestZone: 'neutral', estimatedStrength: 3 }],
}

const VALID_PATROL_OUTPUT: DecideOutput = {
  command: { kind: 'patrol', pathId: 'p_42', speed: 'normal' },
  updatedSessionState: {
    sessionId: 'test-session',
    factionId: 'elves',
    ticksSinceStart: 0,
    decisionCount: 0,
    lastCommand: null,
    providerContext: null,
  },
  usage: { promptTokens: 100, completionTokens: 20 },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/llm/decide', () => {
  // BOO-507 / BOO-525: bind one HTTP listener per test so supertest reuses it
  // instead of opening+closing a server per request (which races macOS
  // ephemeral-port recycling and produces sporadic Parse Errors under the
  // 60-request burst in the per-player rate-limit test).
  let fake: FakeLLMProvider
  let handle: ListenHandle
  let request: ReturnType<typeof supertest>
  const logs: LogLine[] = []

  beforeEach(() => {
    fake = new FakeLLMProvider()
    handle = listen(createApp(fake, COOKIE_SECRET, mockPlayerLoader))
    request = supertest(handle.server)
    logs.length = 0
    logger.sink = (line) => logs.push(line)
    _resetSessions()
    _resetRateLimitStore()
  })

  afterEach(async () => {
    logger.sink = null
    await handle.close()
  })

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  it('returns 401 without cookie', async () => {
    const res = await request.post('/api/llm/decide').send({
      faction: 'elves',
      snapshot: VALID_SNAPSHOT,
    })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('authentication_required')
  })

  it('returns 401 with tampered cookie', async () => {
    const res = await request
      .post('/api/llm/decide')
      .set('Cookie', 'kr_pid=550e8400-e29b-41d4-a716-446655440000.badsig')
      .send({ faction: 'elves', snapshot: VALID_SNAPSHOT })
    expect(res.status).toBe(401)
  })

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('200 — valid request, LLM returns valid command', async () => {
    fake.configure({ response: VALID_PATROL_OUTPUT })

    const res = await request
      .post('/api/llm/decide')
      .set('Cookie', makeCookie())
      .send({ faction: 'elves', snapshot: VALID_SNAPSHOT })

    expect(res.status).toBe(200)
    expect(res.body.source).toBe('llm')
    expect(res.body.command).toMatchObject({ kind: 'patrol', speed: 'normal' })
    expect(typeof res.body.session_token_count).toBe('number')
  })

  it('persists session state after successful LLM call', async () => {
    fake.configure({ response: VALID_PATROL_OUTPUT })

    await request
      .post('/api/llm/decide')
      .set('Cookie', makeCookie())
      .send({ faction: 'elves', snapshot: VALID_SNAPSHOT })

    // Second call re-uses existing session (no error = session was persisted)
    const res2 = await request
      .post('/api/llm/decide')
      .set('Cookie', makeCookie())
      .send({ faction: 'elves', snapshot: VALID_SNAPSHOT })

    expect(res2.status).toBe(200)
  })

  // -------------------------------------------------------------------------
  // LLM failure modes → fallback
  // -------------------------------------------------------------------------

  it('200 with fallback when provider returns garbage JSON (schema-invalid)', async () => {
    fake.configure({ errorCode: 'schema-invalid' })

    const res = await request
      .post('/api/llm/decide')
      .set('Cookie', makeCookie())
      .send({ faction: 'elves', snapshot: VALID_SNAPSHOT })

    expect(res.status).toBe(200)
    expect(res.body.source).toBe('fallback')
  })

  it('200 with fallback on provider 5xx; CSO-alert log emitted', async () => {
    fake.configure({ errorCode: 'provider-5xx', httpStatus: 503 })

    const res = await request
      .post('/api/llm/decide')
      .set('Cookie', makeCookie())
      .send({ faction: 'elves', snapshot: VALID_SNAPSHOT })

    expect(res.status).toBe(200)
    expect(res.body.source).toBe('fallback')

    const alertLog = logs.find(
      (l) => l['msg'] === 'llm-decide:provider-error' && l['alert'] === 'CSO-ALERT',
    )
    expect(alertLog).toBeDefined()
  })

  it('200 with fallback on provider 4xx auth fail; CSO-alert log emitted', async () => {
    fake.configure({ errorCode: 'auth', httpStatus: 401 })

    const res = await request
      .post('/api/llm/decide')
      .set('Cookie', makeCookie())
      .send({ faction: 'elves', snapshot: VALID_SNAPSHOT })

    expect(res.status).toBe(200)
    expect(res.body.source).toBe('fallback')

    const alertLog = logs.find(
      (l) => l['msg'] === 'llm-decide:provider-error' && l['alert'] === 'CSO-ALERT',
    )
    expect(alertLog).toBeDefined()
  })

  it('200 with fallback on network error; CSO-alert log emitted', async () => {
    fake.configure({ errorCode: 'network' })

    const res = await request
      .post('/api/llm/decide')
      .set('Cookie', makeCookie())
      .send({ faction: 'elves', snapshot: VALID_SNAPSHOT })

    expect(res.status).toBe(200)
    expect(res.body.source).toBe('fallback')

    const alertLog = logs.find(
      (l) => l['msg'] === 'llm-decide:provider-error' && l['alert'] === 'CSO-ALERT',
    )
    expect(alertLog).toBeDefined()
  })

  it('200 with fallback on schema-invalid output; no alert logged', async () => {
    // LLM returns command that fails AgentCommand schema validation
    const badOutput: DecideOutput = {
      command: { kind: 'patrol', pathId: '', speed: 'warp' as never },
      updatedSessionState: VALID_PATROL_OUTPUT.updatedSessionState,
    }
    fake.configure({ response: badOutput })

    const res = await request
      .post('/api/llm/decide')
      .set('Cookie', makeCookie())
      .send({ faction: 'elves', snapshot: VALID_SNAPSHOT })

    expect(res.status).toBe(200)
    expect(res.body.source).toBe('fallback')
    // schema-invalid gets warn, not CSO-ALERT
    const alertLog = logs.find((l) => l['alert'] === 'CSO-ALERT')
    expect(alertLog).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // Validation errors → 400
  // -------------------------------------------------------------------------

  it('400 when snapshot missing required field', async () => {
    const badSnapshot = { ...VALID_SNAPSHOT }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (badSnapshot as any).tickMs

    const res = await request
      .post('/api/llm/decide')
      .set('Cookie', makeCookie())
      .send({ faction: 'elves', snapshot: badSnapshot })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_request')
  })

  it('400 — no session write on validation failure', async () => {
    let called = false
    const originalDecide = fake.decide.bind(fake)
    fake.decide = async (...args) => {
      called = true
      return originalDecide(...args)
    }

    await request
      .post('/api/llm/decide')
      .set('Cookie', makeCookie())
      .send({ faction: 'elves', snapshot: {} })

    expect(called).toBe(false)
  })

  it('400 when faction is not a valid enum value (injection-style payload)', async () => {
    const res = await request
      .post('/api/llm/decide')
      .set('Cookie', makeCookie())
      .send({
        faction: 'bandits"; DROP TABLE ai_sessions;--',
        snapshot: VALID_SNAPSHOT,
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_request')
  })

  it('400 when faction is a valid string but not an enum member', async () => {
    const res = await request
      .post('/api/llm/decide')
      .set('Cookie', makeCookie())
      .send({ faction: 'wolves', snapshot: { ...VALID_SNAPSHOT, faction: 'wolves' } })

    expect(res.status).toBe(400)
  })

  it('400 when snapshot.faction does not match request faction', async () => {
    const res = await request
      .post('/api/llm/decide')
      .set('Cookie', makeCookie())
      .send({
        faction: 'elves',
        snapshot: { ...VALID_SNAPSHOT, faction: 'villain' },
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('faction_mismatch')
  })

  // -------------------------------------------------------------------------
  // Rate limiting → 429
  // -------------------------------------------------------------------------

  it(
    '429 after exceeding per-player rate limit',
    async () => {
      fake.configure({ response: VALID_PATROL_OUTPUT })

      // Pin Date.now() so all 61 requests land inside one fixed 60s window — the
      // limiter is window-aligned to wall-clock, so without this the loop can
      // straddle a boundary and reset the counter mid-test. Spy only on Date.now
      // (not full fake-timers) so supertest's setImmediate-driven scheduling stays real.
      const fixedNow = new Date('2026-06-15T12:00:00Z').valueOf()
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow)

      try {
        // identityPerMin = 60 for POST /api/llm/decide (ENDPOINT_PROFILES).
        // First 60 succeed; 61st trips per-identity limit. ipPerMin = 600, well above.
        for (let i = 0; i < 60; i++) {
          const res = await request
            .post('/api/llm/decide')
            .set('Cookie', makeCookie())
            .send({ faction: 'elves', snapshot: VALID_SNAPSHOT })
          expect(res.status, `request ${i + 1} should not be rate-limited`).not.toBe(429)
        }

        const blocked = await request
          .post('/api/llm/decide')
          .set('Cookie', makeCookie())
          .send({ faction: 'elves', snapshot: VALID_SNAPSHOT })

        expect(blocked.status).toBe(429)
        expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
      } finally {
        nowSpy.mockRestore()
      }
    },
    { timeout: 30_000 },
  )
})
