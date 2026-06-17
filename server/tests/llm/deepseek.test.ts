import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse, delay } from 'msw'
import { createDeepSeekProvider } from '../../src/llm/deepseek.js'
import type { DecideInput } from '../../src/llm/types.js'
import { LLMProviderError } from '../../src/llm/types.js'
import { logger, LogLine } from '../../src/logger.js'
import { createRegistry } from '../../src/llm/registry.js'
import { createScriptedProvider } from '../../src/llm/scripted.js'

const BASE_URL = 'https://api.deepseek.test'
const ENDPOINT = `${BASE_URL}/v1/chat/completions`

const DECIDE_INPUT: DecideInput = {
  playerId: 'player-1',
  faction: 'elves',
  snapshot: {
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
    knownEnemies: [],
  },
  sessionState: {
    sessionId: 'sess-1',
    factionId: 'elves',
    ticksSinceStart: 0,
    providerContext: null,
  },
}

function makeToolCallResponse(args: string) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'issue_command', arguments: args },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 50, completion_tokens: 10 },
  }
}

const VALID_PATROL_ARGS = JSON.stringify({
  kind: 'patrol',
  pathId: 'path-elf-forest-perimeter',
  speed: 'normal',
})

const VALID_IDLE_ARGS = JSON.stringify({ kind: 'idle', reason: 'no threats' })

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('decide() — happy path', () => {
  it('returns parsed DecideOutput for valid patrol command', async () => {
    server.use(
      http.post(ENDPOINT, () => HttpResponse.json(makeToolCallResponse(VALID_PATROL_ARGS))),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    const output = await provider.decide(DECIDE_INPUT)

    expect(output.command).toEqual({
      kind: 'patrol',
      pathId: 'path-elf-forest-perimeter',
      speed: 'normal',
    })
    expect(output.updatedSessionState.ticksSinceStart).toBe(1)
    expect(output.updatedSessionState.factionId).toBe('elves')
  })

  it('returns usage when provider includes it', async () => {
    server.use(
      http.post(ENDPOINT, () => HttpResponse.json(makeToolCallResponse(VALID_IDLE_ARGS))),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    const output = await provider.decide(DECIDE_INPUT)

    expect(output.usage).toEqual({ promptTokens: 50, completionTokens: 10 })
  })

  it('appends turn to providerContext for multi-tick continuity', async () => {
    server.use(
      http.post(ENDPOINT, () => HttpResponse.json(makeToolCallResponse(VALID_IDLE_ARGS))),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    const output = await provider.decide(DECIDE_INPUT)

    const ctx = output.updatedSessionState.providerContext as unknown[]
    expect(Array.isArray(ctx)).toBe(true)
    expect(ctx.length).toBeGreaterThan(0)
  })

  it('sends Authorization header correctly', async () => {
    let capturedAuth: string | null = null
    server.use(
      http.post(ENDPOINT, ({ request }) => {
        capturedAuth = request.headers.get('Authorization')
        return HttpResponse.json(makeToolCallResponse(VALID_PATROL_ARGS))
      }),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-secret-key-xyz', baseUrl: BASE_URL })
    await provider.decide(DECIDE_INPUT)

    expect(capturedAuth).toBe('Bearer sk-secret-key-xyz')
  })
})

// ─── Schema validation ────────────────────────────────────────────────────────

describe('decide() — schema validation errors', () => {
  it('throws schema-invalid when tool call has unknown kind', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          makeToolCallResponse(JSON.stringify({ kind: 'nuke', targetZone: 'palace' })),
        ),
      ),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      name: 'LLMProviderError',
      code: 'schema-invalid',
    })
  })

  it('throws schema-invalid when required field (pathId) is missing', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          // patrol command missing pathId
          makeToolCallResponse(JSON.stringify({ kind: 'patrol', speed: 'fast' })),
        ),
      ),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      code: 'schema-invalid',
    })
  })

  it('throws schema-invalid when durationSec exceeds 300', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          makeToolCallResponse(
            JSON.stringify({ kind: 'ambush', nodeId: 'node-x', durationSec: 9999 }),
          ),
        ),
      ),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      code: 'schema-invalid',
    })
  })

  it('throws schema-invalid when tool call arguments is not valid JSON', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          makeToolCallResponse('not-json{{{{'),
        ),
      ),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      code: 'schema-invalid',
    })
  })

  it('throws schema-invalid when choices array is missing', async () => {
    server.use(
      http.post(ENDPOINT, () => HttpResponse.json({ model: 'deepseek-chat' })),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      code: 'schema-invalid',
    })
  })

  it('throws schema-invalid when response body is not JSON', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        new HttpResponse('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      ),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      code: 'schema-invalid',
    })
  })
})

// ─── idle.reason sanitization at schema-parse time (BOO-510) ──────────────────

describe('decide() — idle.reason sanitization via schema transform', () => {
  it('strips Unicode bidi override (U+202E) from idle.reason', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          makeToolCallResponse(JSON.stringify({ kind: 'idle', reason: 'normal‮reverse' })),
        ),
      ),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    const output = await provider.decide(DECIDE_INPUT)
    const idle = output.command as { kind: 'idle'; reason: string }

    expect(idle.kind).toBe('idle')
    expect(idle.reason).not.toContain('‮')
    expect(idle.reason).toBe('normalreverse')
  })

  it('strips zero-width joiner (U+200D) from idle.reason', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          makeToolCallResponse(JSON.stringify({ kind: 'idle', reason: 'safe‍beacon' })),
        ),
      ),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    const output = await provider.decide(DECIDE_INPUT)
    const idle = output.command as { kind: 'idle'; reason: string }

    expect(idle.reason).not.toContain('‍')
    // Zero-width joiner is not in the allowlist; sanitizeUserString replaces
    // it with a space, so 'safe‍beacon' collapses to 'safe beacon'.
    expect(idle.reason).toBe('safe beacon')
  })

  it('preserves clean idle.reason unchanged (no false positives)', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          makeToolCallResponse(JSON.stringify({ kind: 'idle', reason: 'no threats detected' })),
        ),
      ),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    const output = await provider.decide(DECIDE_INPUT)
    const idle = output.command as { kind: 'idle'; reason: string }

    expect(idle.reason).toBe('no threats detected')
  })

  it('strips ASCII control chars from idle.reason (preserves existing behavior)', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          makeToolCallResponse(JSON.stringify({ kind: 'idle', reason: 'with\x00null\x07bell' })),
        ),
      ),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    const output = await provider.decide(DECIDE_INPUT)
    const idle = output.command as { kind: 'idle'; reason: string }

    // eslint-disable-next-line no-control-regex -- assertion deliberately targets stripped C0 controls
    expect(idle.reason).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/)
    expect(idle.reason).toBe('withnullbell')
  })

  it('still rejects idle reason longer than 128 chars (max check before transform)', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          makeToolCallResponse(JSON.stringify({ kind: 'idle', reason: 'x'.repeat(129) })),
        ),
      ),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      code: 'schema-invalid',
    })
  })
})

// ─── Rate limiting (HTTP 429) ─────────────────────────────────────────────────

describe('decide() — rate-limited (429)', () => {
  it('throws LLMProviderError with code rate-limited on 429', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        new HttpResponse(null, { status: 429, headers: { 'Retry-After': '1' } }),
      ),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    const err = await provider.decide(DECIDE_INPUT).catch((e) => e as LLMProviderError)

    expect(err).toBeInstanceOf(LLMProviderError)
    expect(err.code).toBe('rate-limited')
    expect(err.httpStatus).toBe(429)
    expect(err.retryAfterMs).toBe(1000)
  })
})

// ─── Server errors (5xx) ─────────────────────────────────────────────────────

describe('decide() — provider-5xx', () => {
  it('throws LLMProviderError with code provider-5xx on 500', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 500 })),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      code: 'provider-5xx',
      httpStatus: 500,
    })
  })

  it('throws provider-5xx on 503', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 503 })),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      code: 'provider-5xx',
    })
  })
})

// ─── Timeout ─────────────────────────────────────────────────────────────────

describe('decide() — timeout', () => {
  it('throws LLMProviderError with code timeout when timeoutMs fires', async () => {
    server.use(
      http.post(ENDPOINT, async () => {
        await delay(500)
        return HttpResponse.json(makeToolCallResponse(VALID_PATROL_ARGS))
      }),
    )

    const provider = createDeepSeekProvider({
      apiKey: 'sk-test',
      baseUrl: BASE_URL,
      timeoutMs: 50,
    })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      code: 'timeout',
    })
  })
})

// ─── Auth errors ──────────────────────────────────────────────────────────────

describe('decide() — auth errors', () => {
  it('throws code auth on 401', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 401 })),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-bad', baseUrl: BASE_URL })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      code: 'auth',
      httpStatus: 401,
    })
  })

  it('throws code auth on 403', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 403 })),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-bad', baseUrl: BASE_URL })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      code: 'auth',
      httpStatus: 403,
    })
  })
})

// ─── HTTPS enforcement ────────────────────────────────────────────────────────

describe('HTTPS enforcement', () => {
  it('throws LLMProviderError with code "auth" on non-loopback http:// base URL', () => {
    let caught: unknown = null
    try {
      createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: 'http://api.deepseek.com' })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(LLMProviderError)
    expect((caught as LLMProviderError).code).toBe('auth')
  })

  it('accepts http://localhost loopback (Ollama-style local endpoint, NODE_ENV=test)', () => {
    expect(() =>
      createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: 'http://localhost:11434' }),
    ).not.toThrow()
  })

  it('accepts http://127.0.0.1 loopback', () => {
    expect(() =>
      createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: 'http://127.0.0.1:8080' }),
    ).not.toThrow()
  })

  it('accepts http://[::1] IPv6 loopback', () => {
    expect(() =>
      createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: 'http://[::1]:8080' }),
    ).not.toThrow()
  })

  it('accepts https:// base URL', () => {
    expect(() =>
      createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com' }),
    ).not.toThrow()
  })

  it('rejects http://localhost when NODE_ENV is not "test" (production loopback gate)', () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      let caught: unknown = null
      try {
        createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: 'http://localhost:11434' })
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(LLMProviderError)
      expect((caught as LLMProviderError).code).toBe('auth')
    } finally {
      process.env.NODE_ENV = prev
    }
  })
})

// ─── API key security ──────────────────────────────────────────────────────────

describe('API key security', () => {
  it('does not include raw API key in thrown error messages', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 401 })),
    )

    const SECRET = 'sk-never-leak-this-secret'
    const provider = createDeepSeekProvider({ apiKey: SECRET, baseUrl: BASE_URL })

    try {
      await provider.decide(DECIDE_INPUT)
      expect.fail('should have thrown')
    } catch (err) {
      const error = err as LLMProviderError
      expect(error.message).not.toContain(SECRET)
    }
  })

  it('does not log raw API key in structured log output', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 401 })),
    )

    const SECRET = 'sk-never-log-this-key'
    const captured: LogLine[] = []
    const prevSink = logger.sink
    logger.sink = (line) => captured.push(line)

    const provider = createDeepSeekProvider({ apiKey: SECRET, baseUrl: BASE_URL })
    try {
      await provider.decide(DECIDE_INPUT)
    } catch {
      // expected
    } finally {
      logger.sink = prevSink
    }

    const allLogText = captured.map((l) => JSON.stringify(l)).join('\n')
    expect(allLogText).not.toContain(SECRET)
  })
})

// ─── ping() ───────────────────────────────────────────────────────────────────

describe('ping()', () => {
  it('returns ok:true on 200', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json({
          choices: [{ message: { role: 'assistant', content: 'pong' } }],
        }),
      ),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    const result = await provider.ping()

    expect(result.ok).toBe(true)
    expect(typeof result.latencyMs).toBe('number')
    expect(result.error).toBeUndefined()
  })

  it('returns ok:false (not throws) on 401', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 401 })),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-bad', baseUrl: BASE_URL })
    const result = await provider.ping()

    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns ok:false (not throws) on network error', async () => {
    server.use(
      http.post(ENDPOINT, () => HttpResponse.error()),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: BASE_URL })
    const result = await provider.ping()

    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })
})

// ─── Production URL regression ────────────────────────────────────────────────
// Pins the exact URL the adapter hits in production so the double-/v1 bug
// (DEFAULT_BASE_URL had /v1; fetch template also appended /v1) cannot regress silently.

describe('production URL regression', () => {
  const PROD_BASE = 'https://api.deepseek.com'
  const PROD_ENDPOINT = `${PROD_BASE}/v1/chat/completions`

  it('hits /v1/chat/completions on the prod default base URL (no explicit baseUrl)', async () => {
    server.use(
      http.post(PROD_ENDPOINT, () => HttpResponse.json(makeToolCallResponse(VALID_PATROL_ARGS))),
    )

    // No baseUrl → uses DEFAULT_BASE_URL = 'https://api.deepseek.com'
    const provider = createDeepSeekProvider({ apiKey: 'sk-test' })
    const output = await provider.decide(DECIDE_INPUT)

    expect(output.command.kind).toBe('patrol')
  })

  it('ping() hits /v1/chat/completions on the prod default base URL', async () => {
    server.use(
      http.post(PROD_ENDPOINT, () =>
        HttpResponse.json({ choices: [{ message: { role: 'assistant', content: 'pong' } }] }),
      ),
    )

    const provider = createDeepSeekProvider({ apiKey: 'sk-test' })
    const result = await provider.ping()

    expect(result.ok).toBe(true)
  })
})

// ─── Registry no-collision ────────────────────────────────────────────────────

describe('registry', () => {
  it('registers scripted provider alongside deepseek without collision', () => {
    const registry = createRegistry()
    registry.register(createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com' }))
    registry.register(createScriptedProvider())

    expect(registry.list()).toContain('deepseek')
    expect(registry.list()).toContain('scripted')
    expect(registry.list()).toHaveLength(2)
  })

  it('throws on duplicate provider registration', () => {
    const registry = createRegistry()
    registry.register(createDeepSeekProvider({ apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com' }))
    expect(() =>
      registry.register(createDeepSeekProvider({ apiKey: 'sk-other', baseUrl: 'https://api.deepseek.com' })),
    ).toThrow(/already registered/)
  })
})
