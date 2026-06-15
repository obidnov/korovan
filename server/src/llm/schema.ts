import { z } from 'zod'

// Zod schema for AgentCommand — mirrors the TS discriminated union in types.ts.
// Used by deepseek.ts to validate tool-call arguments before they leave the adapter.
export const AgentCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('patrol'),
    pathId: z.string().min(1),
    speed: z.enum(['slow', 'normal', 'fast']),
  }),
  z.object({
    kind: z.literal('ambush'),
    nodeId: z.string().min(1),
    durationSec: z.number().int().min(1).max(300),
  }),
  z.object({
    kind: z.literal('retreat'),
    nodeId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('idle'),
    reason: z.string().max(128),
  }),
])

export type ValidatedAgentCommand = z.infer<typeof AgentCommandSchema>

// JSON Schema representation — passed as the tool's `parameters` in DeepSeek tool-calling.
export const AGENT_COMMAND_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  oneOf: [
    {
      type: 'object',
      required: ['kind', 'pathId', 'speed'],
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'patrol' },
        pathId: { type: 'string', minLength: 1 },
        speed: { type: 'string', enum: ['slow', 'normal', 'fast'] },
      },
    },
    {
      type: 'object',
      required: ['kind', 'nodeId', 'durationSec'],
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'ambush' },
        nodeId: { type: 'string', minLength: 1 },
        durationSec: { type: 'integer', minimum: 1, maximum: 300 },
      },
    },
    {
      type: 'object',
      required: ['kind', 'nodeId'],
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'retreat' },
        nodeId: { type: 'string', minLength: 1 },
      },
    },
    {
      type: 'object',
      required: ['kind', 'reason'],
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'idle' },
        reason: { type: 'string', maxLength: 128 },
      },
    },
  ],
}
