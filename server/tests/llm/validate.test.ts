import { describe, it, expect } from 'vitest'
import { validateLLMOutput, LLMSchemaInvalidError } from '../../src/llm/validate'

describe('validateLLMOutput — valid commands', () => {
  it('accepts a valid patrol command and returns typed object', () => {
    const result = validateLLMOutput({
      kind: 'patrol',
      pathId: 'path-north',
      speed: 'normal',
    })
    expect(result).toEqual({ kind: 'patrol', pathId: 'path-north', speed: 'normal' })
  })

  it('accepts patrol with speed "slow"', () => {
    const result = validateLLMOutput({ kind: 'patrol', pathId: 'p1', speed: 'slow' })
    expect(result).toMatchObject({ kind: 'patrol', speed: 'slow' })
  })

  it('accepts patrol with speed "fast"', () => {
    const result = validateLLMOutput({ kind: 'patrol', pathId: 'p2', speed: 'fast' })
    expect(result).toMatchObject({ kind: 'patrol', speed: 'fast' })
  })

  it('accepts valid ambush command', () => {
    const result = validateLLMOutput({ kind: 'ambush', nodeId: 'node-1', durationSec: 30 })
    expect(result).toEqual({ kind: 'ambush', nodeId: 'node-1', durationSec: 30 })
  })

  it('accepts ambush at boundary durationSec = 1', () => {
    const result = validateLLMOutput({ kind: 'ambush', nodeId: 'n', durationSec: 1 })
    expect(result).toMatchObject({ kind: 'ambush', durationSec: 1 })
  })

  it('accepts ambush at boundary durationSec = 300', () => {
    const result = validateLLMOutput({ kind: 'ambush', nodeId: 'n', durationSec: 300 })
    expect(result).toMatchObject({ kind: 'ambush', durationSec: 300 })
  })

  it('accepts valid retreat command', () => {
    const result = validateLLMOutput({ kind: 'retreat', nodeId: 'base-camp' })
    expect(result).toEqual({ kind: 'retreat', nodeId: 'base-camp' })
  })

  it('accepts valid idle command', () => {
    const result = validateLLMOutput({ kind: 'idle', reason: 'no threats detected' })
    expect(result).toEqual({ kind: 'idle', reason: 'no threats detected' })
  })
})

describe('validateLLMOutput — rejection: extra fields', () => {
  it('rejects patrol with extra field "backdoor: true"', () => {
    expect(() =>
      validateLLMOutput({
        kind: 'patrol',
        pathId: 'path-north',
        speed: 'normal',
        backdoor: true,
      }),
    ).toThrow(LLMSchemaInvalidError)
  })

  it('rejects idle with extra field', () => {
    expect(() =>
      validateLLMOutput({ kind: 'idle', reason: 'ok', extraField: 'evil' }),
    ).toThrow(LLMSchemaInvalidError)
  })
})

describe('validateLLMOutput — rejection: unknown kind', () => {
  it('rejects kind "exec_shell"', () => {
    expect(() =>
      validateLLMOutput({ kind: 'exec_shell', cmd: 'rm -rf /' }),
    ).toThrow(LLMSchemaInvalidError)
  })

  it('rejects kind "prompt_leak"', () => {
    expect(() => validateLLMOutput({ kind: 'prompt_leak' })).toThrow(
      LLMSchemaInvalidError,
    )
  })

  it('rejects null kind', () => {
    expect(() => validateLLMOutput({ kind: null })).toThrow(LLMSchemaInvalidError)
  })
})

describe('validateLLMOutput — rejection: enum violations', () => {
  it('rejects patrol speed "ludicrous"', () => {
    expect(() =>
      validateLLMOutput({ kind: 'patrol', pathId: 'p', speed: 'ludicrous' }),
    ).toThrow(LLMSchemaInvalidError)
  })

  it('rejects patrol speed "FAST" (wrong case)', () => {
    expect(() =>
      validateLLMOutput({ kind: 'patrol', pathId: 'p', speed: 'FAST' }),
    ).toThrow(LLMSchemaInvalidError)
  })
})

describe('validateLLMOutput — rejection: out-of-range values', () => {
  it('rejects ambush durationSec = 0 (below min)', () => {
    expect(() =>
      validateLLMOutput({ kind: 'ambush', nodeId: 'n', durationSec: 0 }),
    ).toThrow(LLMSchemaInvalidError)
  })

  it('rejects ambush durationSec = 301 (above max)', () => {
    expect(() =>
      validateLLMOutput({ kind: 'ambush', nodeId: 'n', durationSec: 301 }),
    ).toThrow(LLMSchemaInvalidError)
  })

  it('rejects idle reason longer than 128 chars', () => {
    expect(() =>
      validateLLMOutput({ kind: 'idle', reason: 'x'.repeat(129) }),
    ).toThrow(LLMSchemaInvalidError)
  })
})

describe('validateLLMOutput — rejection: wrong types / malformed', () => {
  it('rejects non-object input (string)', () => {
    expect(() => validateLLMOutput('patrol')).toThrow(LLMSchemaInvalidError)
  })

  it('rejects null input', () => {
    expect(() => validateLLMOutput(null)).toThrow(LLMSchemaInvalidError)
  })

  it('rejects missing required field (patrol without pathId)', () => {
    expect(() =>
      validateLLMOutput({ kind: 'patrol', speed: 'slow' }),
    ).toThrow(LLMSchemaInvalidError)
  })

  it('throws LLMSchemaInvalidError (not a generic Error)', () => {
    let caught: unknown
    try {
      validateLLMOutput({ kind: 'exec_shell' })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(LLMSchemaInvalidError)
    expect((caught as LLMSchemaInvalidError).name).toBe('LLMSchemaInvalidError')
  })
})
