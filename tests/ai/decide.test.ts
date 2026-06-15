import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  requestAgentDecision,
  setBootstrapHook,
  AgentRateLimitedError,
} from '../../src/ai/decide'
import type { StrategicStateSnapshot } from '../../src/ai/decide'

const snapshot: StrategicStateSnapshot = { tickMs: 1000, factionId: 'elf' }

const PATROL_COMMAND = {
  issuedAtTickMs: 1000,
  commands: [{ type: 'patrol', targetZone: 'elf-forest', units: ['u1'] }],
}

// Use vi.fn() + vi.stubGlobal to avoid fetch overload signature issues.
let fetchMock: ReturnType<typeof vi.fn>

function makeFetchStub(responses: Array<Response | Promise<Response>>): void {
  let call = 0
  fetchMock = vi.fn().mockImplementation(() => {
    const r = responses[call] ?? responses[responses.length - 1]
    call++
    return Promise.resolve(r)
  })
  vi.stubGlobal('fetch', fetchMock)
}

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body !== undefined ? JSON.stringify(body) : null, {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockFetch(status: number, body?: unknown): void {
  makeFetchStub([jsonResponse(status, body)])
}

function mockFetchSequence(...responses: Array<Response | (() => Response)>): void {
  makeFetchStub(responses.map((r) => (typeof r === 'function' ? r() : r)))
}

function mockFetchNetworkError(): void {
  fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
  vi.stubGlobal('fetch', fetchMock)
}

beforeEach(() => {
  setBootstrapHook(null as unknown as () => Promise<void>)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Happy path — 200
// ---------------------------------------------------------------------------

describe('requestAgentDecision — 200', () => {
  it('returns { command, source } on successful server response', async () => {
    mockFetch(200, { command: PATROL_COMMAND, source: 'llm' })
    const result = await requestAgentDecision({ faction: 'elf', snapshot })
    expect(result.source).toBe('llm')
    expect(result.command).toEqual(PATROL_COMMAND)
  })

  it('accepts source:"fallback" from server', async () => {
    mockFetch(200, { command: PATROL_COMMAND, source: 'fallback' })
    const result = await requestAgentDecision({ faction: 'elf', snapshot })
    expect(result.source).toBe('fallback')
  })

  it('POSTs to /api/llm/decide with faction and snapshot in body', async () => {
    mockFetch(200, { command: PATROL_COMMAND, source: 'llm' })
    await requestAgentDecision({ faction: 'elf', snapshot })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/llm/decide')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.faction).toBe('elf')
    expect(body.snapshot).toMatchObject({ tickMs: 1000, factionId: 'elf' })
  })

  it('sends credentials:include', async () => {
    mockFetch(200, { command: PATROL_COMMAND, source: 'llm' })
    await requestAgentDecision({ faction: 'elf', snapshot })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.credentials).toBe('include')
  })
})

// ---------------------------------------------------------------------------
// 401 — bootstrap re-flow + single retry
// ---------------------------------------------------------------------------

describe('requestAgentDecision — 401', () => {
  it('calls bootstrap hook then retries on 401', async () => {
    const hook = vi.fn().mockResolvedValue(undefined)
    setBootstrapHook(hook)

    mockFetchSequence(
      jsonResponse(401),
      jsonResponse(200, { command: PATROL_COMMAND, source: 'llm' }),
    )

    const result = await requestAgentDecision({ faction: 'elf', snapshot })
    expect(hook).toHaveBeenCalledOnce()
    expect(result.source).toBe('llm')
  })

  it('throws LLMError(auth) on 401 with no bootstrap hook', async () => {
    mockFetch(401)
    await expect(requestAgentDecision({ faction: 'elf', snapshot })).rejects.toMatchObject({
      name: 'LLMError',
      code: 'auth',
    })
  })

  it('throws LLMError(auth) on 401 even after bootstrap hook (no infinite retry)', async () => {
    setBootstrapHook(vi.fn().mockResolvedValue(undefined))
    mockFetch(401)
    await expect(requestAgentDecision({ faction: 'elf', snapshot })).rejects.toMatchObject({
      code: 'auth',
    })
  })
})

// ---------------------------------------------------------------------------
// 429 — AgentRateLimitedError
// ---------------------------------------------------------------------------

describe('requestAgentDecision — 429', () => {
  it('throws AgentRateLimitedError on 429', async () => {
    mockFetch(429)
    await expect(requestAgentDecision({ faction: 'elf', snapshot })).rejects.toBeInstanceOf(
      AgentRateLimitedError,
    )
  })
})

// ---------------------------------------------------------------------------
// 4xx other — LLMError(provider-unreachable)
// ---------------------------------------------------------------------------

describe('requestAgentDecision — 4xx', () => {
  it('throws LLMError(provider-unreachable) on 403', async () => {
    mockFetch(403)
    await expect(requestAgentDecision({ faction: 'elf', snapshot })).rejects.toMatchObject({
      name: 'LLMError',
      code: 'provider-unreachable',
    })
  })

  it('throws LLMError(provider-unreachable) on 400', async () => {
    mockFetch(400)
    await expect(requestAgentDecision({ faction: 'elf', snapshot })).rejects.toMatchObject({
      code: 'provider-unreachable',
    })
  })
})

// ---------------------------------------------------------------------------
// 5xx — LLMError(network)
// ---------------------------------------------------------------------------

describe('requestAgentDecision — 5xx', () => {
  it('throws LLMError(network) on 500', async () => {
    mockFetch(500)
    await expect(requestAgentDecision({ faction: 'elf', snapshot })).rejects.toMatchObject({
      name: 'LLMError',
      code: 'network',
    })
  })

  it('throws LLMError(network) on 503', async () => {
    mockFetch(503)
    await expect(requestAgentDecision({ faction: 'elf', snapshot })).rejects.toMatchObject({
      code: 'network',
    })
  })
})

// ---------------------------------------------------------------------------
// Network error (fetch throws)
// ---------------------------------------------------------------------------

describe('requestAgentDecision — network error', () => {
  it('throws LLMError(network) when fetch rejects', async () => {
    mockFetchNetworkError()
    await expect(requestAgentDecision({ faction: 'elf', snapshot })).rejects.toMatchObject({
      name: 'LLMError',
      code: 'network',
    })
  })
})

// ---------------------------------------------------------------------------
// Invalid response shapes
// ---------------------------------------------------------------------------

describe('requestAgentDecision — invalid shapes', () => {
  it('throws LLMError(invalid-shape) when response is not JSON', async () => {
    makeFetchStub([new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } })])
    await expect(requestAgentDecision({ faction: 'elf', snapshot })).rejects.toMatchObject({
      code: 'invalid-shape',
    })
  })

  it('throws LLMError(invalid-shape) when response is missing command', async () => {
    mockFetch(200, { source: 'llm' })
    await expect(requestAgentDecision({ faction: 'elf', snapshot })).rejects.toMatchObject({
      code: 'invalid-shape',
    })
  })

  it('throws LLMError(invalid-shape) when source is not "llm" or "fallback"', async () => {
    mockFetch(200, { command: PATROL_COMMAND, source: 'unknown' })
    await expect(requestAgentDecision({ faction: 'elf', snapshot })).rejects.toMatchObject({
      code: 'invalid-shape',
    })
  })
})

// ---------------------------------------------------------------------------
// Snapshot test — no third-party API URLs called
// ---------------------------------------------------------------------------

describe('no-third-party-url snapshot', () => {
  it('requestAgentDecision only calls /api/llm/decide, never a third-party LLM URL', async () => {
    mockFetch(200, { command: PATROL_COMMAND, source: 'llm' })
    await requestAgentDecision({ faction: 'elf', snapshot })
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/llm/decide')
    expect(url).not.toMatch(/deepseek\.com|anthropic\.com|openai\.com/)
  })
})
