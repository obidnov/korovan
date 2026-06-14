import { describe, it, expect } from 'vitest'
import { parseCommandEnvelope, parseLLMResponse, COMMAND_ENVELOPE_JSON_SCHEMA } from '../../src/ai/schema'

// ---------------------------------------------------------------------------
// parseCommandEnvelope — happy paths
// ---------------------------------------------------------------------------

describe('parseCommandEnvelope — valid input', () => {
  it('parses a patrol command', () => {
    const result = parseCommandEnvelope({
      issuedAtTickMs: 100,
      commands: [{ type: 'patrol', targetZone: 'elf-forest', units: ['u1', 'u2'] }],
    })
    expect(result.issuedAtTickMs).toBe(100)
    expect(result.commands[0]).toMatchObject({ type: 'patrol', targetZone: 'elf-forest' })
  })

  it('parses a raid command', () => {
    const result = parseCommandEnvelope({
      issuedAtTickMs: 200,
      commands: [{ type: 'raid', targetZone: 'palace', units: ['u3'] }],
    })
    expect(result.commands[0].type).toBe('raid')
  })

  it('parses a noop command', () => {
    const result = parseCommandEnvelope({
      issuedAtTickMs: 300,
      commands: [{ type: 'noop', reason: 'No valid targets.' }],
    })
    expect(result.commands[0]).toMatchObject({ type: 'noop', reason: 'No valid targets.' })
  })

  it('parses an empty commands array', () => {
    const result = parseCommandEnvelope({ issuedAtTickMs: 0, commands: [] })
    expect(result.commands).toHaveLength(0)
  })

  it('parses multiple mixed commands', () => {
    const result = parseCommandEnvelope({
      issuedAtTickMs: 999,
      commands: [
        { type: 'patrol', targetZone: 'neutral', units: [] },
        { type: 'noop', reason: 'holding' },
      ],
    })
    expect(result.commands).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// parseCommandEnvelope — invalid input
// ---------------------------------------------------------------------------

describe('parseCommandEnvelope — invalid input throws LLMError(invalid-shape)', () => {
  it('throws on null', () => {
    expect(() => parseCommandEnvelope(null)).toThrow(
      expect.objectContaining({ name: 'LLMError', code: 'invalid-shape' }),
    )
  })

  it('throws when issuedAtTickMs is missing', () => {
    expect(() => parseCommandEnvelope({ commands: [] })).toThrow(
      expect.objectContaining({ code: 'invalid-shape' }),
    )
  })

  it('throws when commands is not an array', () => {
    expect(() => parseCommandEnvelope({ issuedAtTickMs: 1, commands: 'bad' })).toThrow(
      expect.objectContaining({ code: 'invalid-shape' }),
    )
  })

  it('throws on unknown command type', () => {
    expect(() =>
      parseCommandEnvelope({ issuedAtTickMs: 1, commands: [{ type: 'charge', units: [] }] }),
    ).toThrow(expect.objectContaining({ code: 'invalid-shape' }))
  })

  it('throws on invalid targetZone', () => {
    expect(() =>
      parseCommandEnvelope({
        issuedAtTickMs: 1,
        commands: [{ type: 'patrol', targetZone: 'moon', units: [] }],
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-shape' }))
  })

  it('throws when units contains a non-string', () => {
    expect(() =>
      parseCommandEnvelope({
        issuedAtTickMs: 1,
        commands: [{ type: 'patrol', targetZone: 'palace', units: [42] }],
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-shape' }))
  })

  it('throws when noop is missing reason', () => {
    expect(() =>
      parseCommandEnvelope({ issuedAtTickMs: 1, commands: [{ type: 'noop' }] }),
    ).toThrow(expect.objectContaining({ code: 'invalid-shape' }))
  })
})

// ---------------------------------------------------------------------------
// parseLLMResponse
// ---------------------------------------------------------------------------

describe('parseLLMResponse', () => {
  it('parses content-only response', () => {
    const result = parseLLMResponse({ content: 'hello', tool_calls: undefined })
    expect(result.content).toBe('hello')
    expect(result.tool_calls).toBeUndefined()
  })

  it('parses null content', () => {
    const result = parseLLMResponse({ content: null })
    expect(result.content).toBeNull()
  })

  it('throws on non-object', () => {
    expect(() => parseLLMResponse('string')).toThrow(
      expect.objectContaining({ code: 'invalid-shape' }),
    )
  })

  it('throws when content is neither string nor null', () => {
    expect(() => parseLLMResponse({ content: 42 })).toThrow(
      expect.objectContaining({ code: 'invalid-shape' }),
    )
  })
})

// ---------------------------------------------------------------------------
// JSON schema export
// ---------------------------------------------------------------------------

describe('COMMAND_ENVELOPE_JSON_SCHEMA', () => {
  it('is an object with required fields', () => {
    expect(COMMAND_ENVELOPE_JSON_SCHEMA['type']).toBe('object')
    expect(COMMAND_ENVELOPE_JSON_SCHEMA['required']).toContain('issuedAtTickMs')
    expect(COMMAND_ENVELOPE_JSON_SCHEMA['required']).toContain('commands')
  })
})
