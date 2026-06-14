import { z } from 'zod';

export const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

export const LLMResponseSchema = z.object({
  content: z.string().nullable(),
  tool_calls: z.array(ToolCallSchema).optional(),
});

const ZoneSchema = z.enum(['elf-forest', 'palace', 'neutral', 'villain-fort']);

export const FactionCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('patrol'),
    targetZone: ZoneSchema,
    units: z.array(z.string()),
  }),
  z.object({
    type: z.literal('raid'),
    targetZone: ZoneSchema,
    units: z.array(z.string()),
  }),
  z.object({
    type: z.literal('noop'),
    reason: z.string(),
  }),
]);

export const CommandEnvelopeSchema = z.object({
  issuedAtTickMs: z.number(),
  commands: z.array(FactionCommandSchema),
});

export const CommandEnvelopeJsonSchema: Record<string, unknown> = {
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
              type: { const: 'patrol' },
              targetZone: { enum: ['elf-forest', 'palace', 'neutral', 'villain-fort'] },
              units: { type: 'array', items: { type: 'string' } },
            },
          },
          {
            type: 'object',
            required: ['type', 'targetZone', 'units'],
            properties: {
              type: { const: 'raid' },
              targetZone: { enum: ['elf-forest', 'palace', 'neutral', 'villain-fort'] },
              units: { type: 'array', items: { type: 'string' } },
            },
          },
          {
            type: 'object',
            required: ['type', 'reason'],
            properties: {
              type: { const: 'noop' },
              reason: { type: 'string' },
            },
          },
        ],
      },
    },
  },
};
