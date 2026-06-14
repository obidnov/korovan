import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentRouter } from '../../src/ai/agentRouter'
import { LLMError } from '../../src/ai/types'
import type { CommandEnvelope, LLMProvider, LLMResponse, ProviderSettings } from '../../src/ai/types'
import type { GameStateSnapshot, ScriptedFallbackFn } from '../../src/ai/agentRouter'

const settings: ProviderSettings = {
  id: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: 'sk-test-never-log',
  timeoutMs: 15_000,
}

const snapshot: GameStateSnapshot = { tickMs: 12345, factionId: 'elf' }

const SCRIPTED_ENVELOPE: CommandEnvelope = {
  issuedAtTickMs: 12345,
  commands: [{ type: 'noop', reason: 'scripted' }],
}

const scriptedFallback: ScriptedFallbackFn = () => ({ ...SCRIPTED_ENVELOPE })

function makeEnvelope(tickMs = snapshot.tickMs): CommandEnvelope {
  return { issuedAtTickMs: tickMs, commands: [{ type: 'patrol', targetZone: 'elf-forest', units: ['u1'] }] }
}

function toolCallResponse(envelope: CommandEnvelope): LLMResponse {
  return {
    content: null,
    tool_calls: [
      {
        id: 'tc-1',
        type: 'function',
        function: { name: 'issue_commands', arguments: JSON.stringify(envelope) },
      },
    ],
  }
}

function makeProvider(behaviour: () => Promise<LLMResponse>): LLMProvider {
  return { complete: () => behaviour() }
}

function makeRouter(provider: LLMProvider): AgentRouter {
  return new AgentRouter({ provider, settings, scriptedFallback })
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('AgentRouter — happy path', () => {
  it('returns CommandEnvelope from tool_call response', async () => {
    const router = makeRouter(makeProvider(() => Promise.resolve(toolCallResponse(makeEnvelope()))))
    const result = await router.tick(snapshot)
    expect(result.commands[0].type).toBe('patrol')
    expect(result.issuedAtTickMs).toBe(snapshot.tickMs)
  })

  it('returns CommandEnvelope from JSON content (schema-fallback path)', async () => {
    const envelope = makeEnvelope()
    const router = makeRouter(
      makeProvider(() => Promise.resolve({ content: JSON.stringify(envelope) })),
    )
    const result = await router.tick(snapshot)
    expect(result.commands[0].type).toBe('patrol')
  })

  it('calls LLM with a system + user message', async () => {
    const spy = vi.fn().mockResolvedValue(toolCallResponse(makeEnvelope()))
    const router = new AgentRouter({ provider: { complete: spy }, settings, scriptedFallback })
    await router.tick(snapshot)
    const [messages] = spy.mock.calls[0]
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    // User content must be valid JSON (prevents prompt injection)
    expect(() => JSON.parse(messages[1].content)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Fallback: timeout (1 tick total → retry on next)
// ---------------------------------------------------------------------------

describe('AgentRouter — timeout fallback', () => {
  it('routes to scripted fallback on timeout, retries LLM on next tick', async () => {
    const spy = vi
      .fn()
      .mockRejectedValueOnce(new LLMError('timeout', 'Timed out'))
      .mockResolvedValue(toolCallResponse(makeEnvelope()))
    const router = new AgentRouter({ provider: { complete: spy }, settings, scriptedFallback })

    const r1 = await router.tick(snapshot)
    expect(r1.commands[0]).toMatchObject({ type: 'noop', reason: 'scripted' })
    expect(router.fallbackTicksRemaining).toBe(0)

    const r2 = await router.tick(snapshot)
    expect(r2.commands[0].type).toBe('patrol')
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Fallback: invalid-shape (1 tick total → retry on next)
// ---------------------------------------------------------------------------

describe('AgentRouter — invalid-shape fallback', () => {
  it('falls back on invalid JSON content, retries LLM on next tick', async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce({ content: 'not json {{', tool_calls: undefined })
      .mockResolvedValue(toolCallResponse(makeEnvelope()))
    const router = new AgentRouter({ provider: { complete: spy }, settings, scriptedFallback })

    const r1 = await router.tick(snapshot)
    expect(r1.commands[0]).toMatchObject({ type: 'noop', reason: 'scripted' })

    const r2 = await router.tick(snapshot)
    expect(r2.commands[0].type).toBe('patrol')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('falls back when CommandEnvelope shape is invalid', async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce({ content: JSON.stringify({ bad: true }) })
      .mockResolvedValue(toolCallResponse(makeEnvelope()))
    const router = new AgentRouter({ provider: { complete: spy }, settings, scriptedFallback })

    const r1 = await router.tick(snapshot)
    expect(r1.commands[0]).toMatchObject({ type: 'noop', reason: 'scripted' })
  })
})

// ---------------------------------------------------------------------------
// Fallback: provider-unreachable (3 ticks total)
// ---------------------------------------------------------------------------

describe('AgentRouter — provider-unreachable fallback', () => {
  it('falls back for 3 ticks then retries LLM', async () => {
    const spy = vi
      .fn()
      .mockRejectedValueOnce(new LLMError('provider-unreachable', '503'))
      .mockResolvedValue(toolCallResponse(makeEnvelope()))
    const router = new AgentRouter({ provider: { complete: spy }, settings, scriptedFallback })

    // Error tick → 2 extra fallback ticks queued
    const r0 = await router.tick(snapshot)
    expect(r0.commands[0]).toMatchObject({ type: 'noop', reason: 'scripted' })
    expect(router.fallbackTicksRemaining).toBe(2)

    // 2 additional scripted ticks drain the counter
    await router.tick(snapshot)
    expect(router.fallbackTicksRemaining).toBe(1)
    await router.tick(snapshot)
    expect(router.fallbackTicksRemaining).toBe(0)

    // LLM retried
    const r3 = await router.tick(snapshot)
    expect(r3.commands[0].type).toBe('patrol')
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Auth error — permanent session disable, no retry
// ---------------------------------------------------------------------------

describe('AgentRouter — auth error', () => {
  it('disables LLM for the entire session on auth failure', async () => {
    const spy = vi.fn().mockRejectedValue(new LLMError('auth', '401'))
    const router = new AgentRouter({ provider: { complete: spy }, settings, scriptedFallback })

    const r1 = await router.tick(snapshot)
    expect(r1.commands[0]).toMatchObject({ type: 'noop', reason: 'scripted' })
    expect(router.isAuthDisabled).toBe(true)

    // Subsequent ticks never call LLM again
    await router.tick(snapshot)
    await router.tick(snapshot)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Retry cadence — network (2 ticks total)
// ---------------------------------------------------------------------------

describe('AgentRouter — retry cadence (network)', () => {
  it('waits 2 ticks before retrying after network error', async () => {
    const spy = vi
      .fn()
      .mockRejectedValueOnce(new LLMError('network', 'ECONNREFUSED'))
      .mockResolvedValue(toolCallResponse(makeEnvelope()))
    const router = new AgentRouter({ provider: { complete: spy }, settings, scriptedFallback })

    // Error tick → 1 extra fallback tick
    await router.tick(snapshot)
    expect(router.fallbackTicksRemaining).toBe(1)

    // Still in fallback
    await router.tick(snapshot)
    expect(router.fallbackTicksRemaining).toBe(0)

    // LLM retried on third tick
    const r = await router.tick(snapshot)
    expect(r.commands[0].type).toBe('patrol')
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// start / stop interval
// ---------------------------------------------------------------------------

describe('AgentRouter — start/stop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires tick on the configured interval', async () => {
    const spy = vi.fn().mockResolvedValue(toolCallResponse(makeEnvelope()))
    const router = new AgentRouter({
      provider: { complete: spy },
      settings,
      scriptedFallback,
      tickIntervalMs: 10_000,
    })
    router.start(() => snapshot)
    await vi.advanceTimersByTimeAsync(25_000)
    router.stop()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('stop() cancels further ticks', async () => {
    const spy = vi.fn().mockResolvedValue(toolCallResponse(makeEnvelope()))
    const router = new AgentRouter({
      provider: { complete: spy },
      settings,
      scriptedFallback,
      tickIntervalMs: 5_000,
    })
    router.start(() => snapshot)
    await vi.advanceTimersByTimeAsync(5_000)
    router.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
