import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse, delay } from 'msw'
import {
  createOpenAICompatServerProvider,
} from '../../src/llm/openaiCompat.js'
import type { LLMProviderError } from '../../src/llm/types.js'
import type { DecideInput } from '../../src/llm/types.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_URL = 'https://compat.test/v1'
const ENDPOINT = `${BASE_URL}/chat/completions`
const API_KEY = 'sk-test-secret'
const MODEL = 'gpt-4o'

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
        unitCount: { elves: 10, 'palace-guard': 0, villain: 0 },
        hasCaravan: false,
      },
    ],
    ownUnits: [{ unitClass: 'infantry', count: 10, avgHpPercent: 80 }],
    knownEnemies: [],
  },
  sessionState: {
    sessionId: 'sess-1',
    factionId: 'elves',
    ticksSinceStart: 0,
    providerContext: null,
  },
}

function makeToolCallResponse(args = '{"kind":"patrol","pathId":"p1","speed":"normal"}') {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_abc',
              type: 'function',
              function: { name: 'issue_command', arguments: args },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 150, completion_tokens: 20 },
  }
}

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// ---------------------------------------------------------------------------
// Boot-time validation (HTTPS guard + other config guards)
// ---------------------------------------------------------------------------

describe('boot-time validation', () => {
  it('throws for http:// remote endpoint (HTTPS guard)', () => {
    expect(() =>
      createOpenAICompatServerProvider({
        apiKey: API_KEY,
        baseUrl: 'http://evil.com/v1',
        model: MODEL,
      }),
    ).toThrow(/http:\/\/ is not allowed for remote/)
  })

  it('throws with message that does NOT contain the API key (key-never-logged)', () => {
    let errMsg = ''
    try {
      createOpenAICompatServerProvider({
        apiKey: 'super-secret-key-xyz',
        baseUrl: 'http://evil.com/v1',
        model: MODEL,
      })
    } catch (e) {
      errMsg = (e as Error).message
    }
    expect(errMsg).not.toContain('super-secret-key-xyz')
    expect(errMsg).toBeTruthy()
  })

  it('allows http://localhost for local dev (Ollama / llama.cpp)', () => {
    expect(() =>
      createOpenAICompatServerProvider({
        apiKey: API_KEY,
        baseUrl: 'http://localhost:11434/v1',
        model: MODEL,
      }),
    ).not.toThrow()
  })

  it('allows http://127.0.0.1 for local dev', () => {
    expect(() =>
      createOpenAICompatServerProvider({
        apiKey: API_KEY,
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: MODEL,
      }),
    ).not.toThrow()
  })

  it('throws when apiKey is empty', () => {
    expect(() =>
      createOpenAICompatServerProvider({ apiKey: '', baseUrl: BASE_URL, model: MODEL }),
    ).toThrow(/OPENAI_COMPAT_KEY/)
  })

  it('throws when model is empty', () => {
    expect(() =>
      createOpenAICompatServerProvider({ apiKey: API_KEY, baseUrl: BASE_URL, model: '' }),
    ).toThrow(/OPENAI_COMPAT_MODEL/)
  })

  it('throws when baseUrl is not a valid URL', () => {
    expect(() =>
      createOpenAICompatServerProvider({ apiKey: API_KEY, baseUrl: 'not-a-url', model: MODEL }),
    ).toThrow(/not a valid URL/)
  })

  it('throws for unsupported protocols (ftp://)', () => {
    expect(() =>
      createOpenAICompatServerProvider({
        apiKey: API_KEY,
        baseUrl: 'ftp://files.example.com/v1',
        model: MODEL,
      }),
    ).toThrow(/unsupported protocol/)
  })

  it('is case-insensitive — rejects HTTP:// remote (protocol normalised by URL parser)', () => {
    // new URL() normalises HTTP:// → http: so the guard fires regardless of casing
    expect(() =>
      createOpenAICompatServerProvider({
        apiKey: API_KEY,
        baseUrl: 'HTTP://evil.com/v1',
        model: MODEL,
      }),
    ).toThrow(/http:\/\/ is not allowed for remote/)
  })
})

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('happy path — tool-call response', () => {
  it('returns a valid AgentCommand from a tool-call response', async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json(makeToolCallResponse())))

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    const result = await provider.decide(DECIDE_INPUT)

    expect(result.command).toEqual({ kind: 'patrol', pathId: 'p1', speed: 'normal' })
    expect(result.updatedSessionState.ticksSinceStart).toBe(1)
    expect(result.usage?.promptTokens).toBe(150)
    expect(result.usage?.completionTokens).toBe(20)
  })

  it('sends Authorization: Bearer header', async () => {
    let capturedAuth: string | null = null
    server.use(
      http.post(ENDPOINT, ({ request }) => {
        capturedAuth = request.headers.get('Authorization')
        return HttpResponse.json(makeToolCallResponse())
      }),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: 'sk-captured-key',
      baseUrl: BASE_URL,
      model: MODEL,
    })
    await provider.decide(DECIDE_INPUT)

    expect(capturedAuth).toBe('Bearer sk-captured-key')
  })

  it('sends the correct model in request body', async () => {
    let capturedModel: unknown
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        capturedModel = body['model']
        return HttpResponse.json(makeToolCallResponse())
      }),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: 'meta-llama/Llama-3-70b-instruct',
    })
    await provider.decide(DECIDE_INPUT)

    expect(capturedModel).toBe('meta-llama/Llama-3-70b-instruct')
  })

  it('stores conversation history in updatedSessionState.providerContext', async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json(makeToolCallResponse())))

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    const result = await provider.decide(DECIDE_INPUT)
    const context = result.updatedSessionState.providerContext as unknown[]

    expect(Array.isArray(context)).toBe(true)
    expect(context.length).toBeGreaterThanOrEqual(2)
  })

  it('accepts JSON-content fallback (no tool_calls in response)', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '{"kind":"idle","reason":"awaiting orders"}',
                tool_calls: undefined,
              },
            },
          ],
        }),
      ),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    const result = await provider.decide(DECIDE_INPUT)
    expect(result.command).toEqual({ kind: 'idle', reason: 'awaiting orders' })
  })

  it('provider name is openai-compat', () => {
    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    expect(provider.name).toBe('openai-compat')
  })
})

// ---------------------------------------------------------------------------
// Error-class taxonomy (5 classes: network, timeout, rate-limited, auth, provider-5xx)
// + schema-invalid
// ---------------------------------------------------------------------------

describe('error class: network', () => {
  it('throws LLMProviderError with code "network" on fetch failure', async () => {
    // msw v2: HttpResponse.error() simulates a network-level error (fetch rejects).
    // Throwing inside the handler returns a 500 response instead — use .error() here.
    server.use(
      http.post(ENDPOINT, () => HttpResponse.error()),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      name: 'LLMProviderError',
      code: 'network',
    })
  })

  it('error message does not contain the API key', async () => {
    server.use(
      http.post(ENDPOINT, () => HttpResponse.error()),
    )

    const secretKey = 'super-secret-sk-network-test'
    const provider = createOpenAICompatServerProvider({
      apiKey: secretKey,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    try {
      await provider.decide(DECIDE_INPUT)
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as Error).message).not.toContain(secretKey)
    }
  })
})

describe('error class: timeout', () => {
  it('throws LLMProviderError with code "timeout" when request exceeds timeoutMs', async () => {
    server.use(
      http.post(ENDPOINT, async () => {
        await delay(5_000) // longer than our test timeout
        return HttpResponse.json(makeToolCallResponse())
      }),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
      timeoutMs: 50, // very short — fires immediately
    })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      name: 'LLMProviderError',
      code: 'timeout',
    })
  })
})

describe('error class: rate-limited', () => {
  it('throws LLMProviderError with code "rate-limited" on HTTP 429', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        new HttpResponse(null, {
          status: 429,
          headers: { 'Retry-After': '2' },
        }),
      ),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      name: 'LLMProviderError',
      code: 'rate-limited',
      httpStatus: 429,
    })
  })

  it('surfaces retryAfterMs from Retry-After header on 429', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        new HttpResponse(null, {
          status: 429,
          headers: { 'Retry-After': '3' },
        }),
      ),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    try {
      await provider.decide(DECIDE_INPUT)
      expect.fail('should have thrown')
    } catch (err) {
      const e = err as LLMProviderError
      expect(e.code).toBe('rate-limited')
      expect(e.retryAfterMs).toBe(3_000)
    }
  })
})

describe('error class: auth', () => {
  it('throws LLMProviderError with code "auth" on HTTP 401', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 401 })),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      name: 'LLMProviderError',
      code: 'auth',
      httpStatus: 401,
    })
  })

  it('throws LLMProviderError with code "auth" on HTTP 403', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 403 })),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      name: 'LLMProviderError',
      code: 'auth',
      httpStatus: 403,
    })
  })

  it('error message on 401 does not contain the API key', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 401 })),
    )

    const secretKey = 'super-secret-sk-auth-test'
    const provider = createOpenAICompatServerProvider({
      apiKey: secretKey,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    try {
      await provider.decide(DECIDE_INPUT)
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as Error).message).not.toContain(secretKey)
    }
  })
})

describe('error class: provider-5xx', () => {
  it('throws LLMProviderError with code "provider-5xx" on HTTP 500', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 500 })),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      name: 'LLMProviderError',
      code: 'provider-5xx',
      httpStatus: 500,
    })
  })

  it('throws LLMProviderError with code "provider-5xx" on HTTP 503', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 503 })),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      name: 'LLMProviderError',
      code: 'provider-5xx',
    })
  })
})

describe('error class: schema-invalid', () => {
  it('throws LLMProviderError with code "schema-invalid" when choices array is empty', async () => {
    server.use(
      http.post(ENDPOINT, () => HttpResponse.json({ choices: [] })),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      name: 'LLMProviderError',
      code: 'schema-invalid',
    })
  })

  it('throws "schema-invalid" when AgentCommand kind is unknown', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(makeToolCallResponse('{"kind":"charge","target":"palace"}')),
      ),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      name: 'LLMProviderError',
      code: 'schema-invalid',
    })
  })

  it('throws "schema-invalid" when tool call arguments is malformed JSON', async () => {
    server.use(
      http.post(ENDPOINT, () => HttpResponse.json(makeToolCallResponse('{bad json'))),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    await expect(provider.decide(DECIDE_INPUT)).rejects.toMatchObject({
      name: 'LLMProviderError',
      code: 'schema-invalid',
    })
  })
})

// ---------------------------------------------------------------------------
// ping()
// ---------------------------------------------------------------------------

describe('ping()', () => {
  it('returns ok:true with latency on a 200 response', async () => {
    server.use(
      http.post(ENDPOINT, () => HttpResponse.json({ choices: [] })),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    const result = await provider.ping()

    expect(result.ok).toBe(true)
    expect(typeof result.latencyMs).toBe('number')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(result.error).toBeUndefined()
  })

  it('returns ok:false (no throw) on HTTP 401', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 401 })),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    const result = await provider.ping()

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/401/)
    expect(result.error).not.toContain(API_KEY)
  })

  it('returns ok:false (no throw) on network failure', async () => {
    server.use(
      http.post(ENDPOINT, () => HttpResponse.error()),
    )

    const provider = createOpenAICompatServerProvider({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    })
    const result = await provider.ping()

    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(result.error).not.toContain(API_KEY)
  })
})
