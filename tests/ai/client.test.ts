import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createProvider, registerProvider, _resetProviderRegistry } from '../../src/ai/client'
import { LLMError } from '../../src/ai/types'
import type { LLMProvider, LLMResponse, ProviderSettings } from '../../src/ai/types'

const baseSettings: ProviderSettings = {
  id: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: 'sk-test-never-log',
  timeoutMs: 500,
}

function fakeProvider(behaviour: () => Promise<LLMResponse>): LLMProvider {
  return { complete: behaviour }
}

// ---------------------------------------------------------------------------
// Factory dispatch
// ---------------------------------------------------------------------------

describe('createProvider — factory dispatch', () => {
  beforeEach(() => {
    _resetProviderRegistry()
    registerProvider('deepseek', () => fakeProvider(() => Promise.resolve({ content: 'ok' })))
  })

  it('returns a provider with .complete() for a registered id', () => {
    const p = createProvider(baseSettings)
    expect(typeof p.complete).toBe('function')
  })

  it('complete() resolves for a registered provider', async () => {
    const p = createProvider(baseSettings)
    const result = await p.complete([{ role: 'user', content: 'tick' }])
    expect(result.content).toBe('ok')
  })

  it('throws LLMError(provider-unreachable) for an unregistered id', () => {
    expect(() => createProvider({ ...baseSettings, id: 'anthropic' })).toThrowError(
      expect.objectContaining({ name: 'LLMError', code: 'provider-unreachable' }),
    )
  })

  it('throws LLMError(provider-unreachable) for an unregistered id (openai-compat)', () => {
    expect(() => createProvider({ ...baseSettings, id: 'openai-compat' })).toThrowError(
      expect.objectContaining({ code: 'provider-unreachable' }),
    )
  })
})

// ---------------------------------------------------------------------------
// Timeout wrapper
// ---------------------------------------------------------------------------

describe('createProvider — timeout wrapper', () => {
  beforeEach(() => {
    _resetProviderRegistry()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects with LLMError(timeout) when provider exceeds timeoutMs', async () => {
    registerProvider('deepseek', () => fakeProvider(() => new Promise(() => {})))
    const provider = createProvider({ ...baseSettings, timeoutMs: 100 })

    const p = provider.complete([{ role: 'user', content: 'tick' }])
    // Attach rejection handler before advancing time to avoid unhandled-rejection warning
    const assertion = expect(p).rejects.toMatchObject({ name: 'LLMError', code: 'timeout' })
    await vi.advanceTimersByTimeAsync(101)
    await assertion
  })

  it('does not fire timeout when provider resolves before the deadline', async () => {
    registerProvider(
      'deepseek',
      () => fakeProvider(() => Promise.resolve({ content: 'fast', tool_calls: undefined })),
    )
    const provider = createProvider({ ...baseSettings, timeoutMs: 1000 })
    const result = await provider.complete([{ role: 'user', content: 'tick' }])
    expect(result.content).toBe('fast')
  })

  it('passes through LLMError(network) from the adapter unchanged', async () => {
    registerProvider(
      'deepseek',
      () => fakeProvider(() => Promise.reject(new LLMError('network', 'DNS failed'))),
    )
    const provider = createProvider(baseSettings)
    await expect(provider.complete([{ role: 'user', content: 'tick' }])).rejects.toMatchObject({
      name: 'LLMError',
      code: 'network',
    })
  })

  it('passes through LLMError(auth) without retrying', async () => {
    const spy = vi.fn().mockRejectedValue(new LLMError('auth', '401'))
    registerProvider('deepseek', () => ({ complete: spy }))
    const provider = createProvider(baseSettings)
    await expect(provider.complete([{ role: 'user', content: 'tick' }])).rejects.toMatchObject({
      code: 'auth',
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('opts.timeoutMs overrides settings.timeoutMs per-call', async () => {
    registerProvider('deepseek', () => fakeProvider(() => new Promise(() => {})))
    const provider = createProvider({ ...baseSettings, timeoutMs: 9999 })

    const p = provider.complete([{ role: 'user', content: 'tick' }], { timeoutMs: 50 })
    const assertion = expect(p).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(51)
    await assertion
  })
})
