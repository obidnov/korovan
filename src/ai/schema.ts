import type { CommandEnvelope, FactionCommand, LLMResponse, Zone } from './types'
import { LLMError } from './types'

// JSON schema for CommandEnvelope — embedded in tool parameters and opts.schema fallback
export const COMMAND_ENVELOPE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['issuedAtTickMs', 'commands'],
  properties: {
    issuedAtTickMs: { type: 'number' },
    commands: {
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            required: ['type', 'targetZone', 'units'],
            properties: {
              type: { type: 'string', const: 'patrol' },
              targetZone: {
                type: 'string',
                enum: ['elf-forest', 'palace', 'neutral', 'villain-fort'],
              },
              units: { type: 'array', items: { type: 'string' } },
            },
          },
          {
            type: 'object',
            required: ['type', 'targetZone', 'units'],
            properties: {
              type: { type: 'string', const: 'raid' },
              targetZone: {
                type: 'string',
                enum: ['elf-forest', 'palace', 'neutral', 'villain-fort'],
              },
              units: { type: 'array', items: { type: 'string' } },
            },
          },
          {
            type: 'object',
            required: ['type', 'reason'],
            properties: {
              type: { type: 'string', const: 'noop' },
              reason: { type: 'string' },
            },
          },
        ],
      },
    },
  },
}

const VALID_ZONES = new Set<Zone>(['elf-forest', 'palace', 'neutral', 'villain-fort'])

function parseCommand(value: unknown, index: number): FactionCommand {
  if (!value || typeof value !== 'object') {
    throw new LLMError('invalid-shape', `commands[${index}] is not an object`)
  }
  const cmd = value as Record<string, unknown>
  const type = cmd['type']

  if (type === 'noop') {
    if (typeof cmd['reason'] !== 'string') {
      throw new LLMError('invalid-shape', `commands[${index}].reason must be a string`)
    }
    return { type: 'noop', reason: cmd['reason'] }
  }

  if (type === 'patrol' || type === 'raid') {
    const zone = cmd['targetZone']
    if (typeof zone !== 'string' || !VALID_ZONES.has(zone as Zone)) {
      throw new LLMError('invalid-shape', `commands[${index}].targetZone "${zone}" is invalid`)
    }
    if (!Array.isArray(cmd['units']) || cmd['units'].some((u) => typeof u !== 'string')) {
      throw new LLMError('invalid-shape', `commands[${index}].units must be string[]`)
    }
    return { type, targetZone: zone as Zone, units: cmd['units'] as string[] }
  }

  throw new LLMError('invalid-shape', `commands[${index}].type "${type}" is unrecognised`)
}

export function parseCommandEnvelope(value: unknown): CommandEnvelope {
  if (!value || typeof value !== 'object') {
    throw new LLMError('invalid-shape', 'CommandEnvelope must be an object')
  }
  const obj = value as Record<string, unknown>
  if (typeof obj['issuedAtTickMs'] !== 'number') {
    throw new LLMError('invalid-shape', 'CommandEnvelope.issuedAtTickMs must be a number')
  }
  if (!Array.isArray(obj['commands'])) {
    throw new LLMError('invalid-shape', 'CommandEnvelope.commands must be an array')
  }
  return {
    issuedAtTickMs: obj['issuedAtTickMs'],
    commands: (obj['commands'] as unknown[]).map(parseCommand),
  }
}

export function parseLLMResponse(value: unknown): LLMResponse {
  if (!value || typeof value !== 'object') {
    throw new LLMError('invalid-shape', 'LLMResponse must be an object')
  }
  const obj = value as Record<string, unknown>
  if (obj['content'] !== null && typeof obj['content'] !== 'string') {
    throw new LLMError('invalid-shape', 'LLMResponse.content must be string | null')
  }
  return {
    content: obj['content'] as string | null,
    tool_calls: obj['tool_calls'] as LLMResponse['tool_calls'],
  }
}
