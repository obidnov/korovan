import { describe, it, expect, beforeEach } from 'vitest'
import { createRegistry } from '../../src/llm/registry.js'
import { createFakeProvider, createFailingFakeProvider } from '../../src/llm/fake.js'

describe('createRegistry()', () => {
  let registry: ReturnType<typeof createRegistry>

  beforeEach(() => {
    registry = createRegistry()
  })

  it('starts empty', () => {
    expect(registry.list()).toEqual([])
  })

  it('registers and retrieves a provider', () => {
    const fake = createFakeProvider()
    registry.register(fake)
    expect(registry.get('fake')).toBe(fake)
    expect(registry.list()).toContain('fake')
  })

  it('throws on duplicate registration', () => {
    registry.register(createFakeProvider())
    expect(() => registry.register(createFakeProvider())).toThrow("already registered")
  })

  it('throws on get of unregistered provider', () => {
    expect(() => registry.get('deepseek')).toThrow("not registered")
  })
})

describe('FakeProvider', () => {
  it('returns configured response from decide()', async () => {
    const fakeOutput = {
      command: { kind: 'idle' as const, reason: 'test' },
      updatedSessionState: {
        sessionId: 's1',
        factionId: 'elves' as const,
        ticksSinceStart: 1,
        providerContext: null,
      },
    }
    const fake = createFakeProvider({ response: fakeOutput })
    const input = makeInput()
    const result = await fake.decide(input)
    expect(result).toBe(fakeOutput)
  })

  it('throws configured error from decide()', async () => {
    const fake = createFailingFakeProvider('rate-limited', 'quota exceeded')
    await expect(fake.decide(makeInput())).rejects.toMatchObject({
      code: 'rate-limited',
      message: 'quota exceeded',
    })
  })

  it('ping() returns ok:true by default', async () => {
    const fake = createFakeProvider()
    const result = await fake.ping()
    expect(result.ok).toBe(true)
  })

  it('ping() returns ok:false when errorToThrow is set', async () => {
    const fake = createFailingFakeProvider('timeout')
    const result = await fake.ping()
    expect(result.ok).toBe(false)
  })
})

function makeInput() {
  return {
    playerId: 'p1',
    faction: 'elves' as const,
    snapshot: {
      tickMs: 0,
      faction: 'elves' as const,
      zones: [],
      ownUnits: [],
      knownEnemies: [],
    },
    sessionState: {
      sessionId: 's1',
      factionId: 'elves' as const,
      ticksSinceStart: 0,
      providerContext: null,
    },
  }
}
