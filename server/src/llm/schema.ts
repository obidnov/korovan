import { z } from 'zod'
import { sanitizeIdleReason } from './sanitize.js'

// ---------------------------------------------------------------------------
// Faction enum (server-controlled — request body faction must be one of these)
// ---------------------------------------------------------------------------

export const FACTION_IDS = ['elves', 'palace-guard', 'villain'] as const

// ---------------------------------------------------------------------------
// Request body schema (EP-3: POST /api/llm/decide)
// ---------------------------------------------------------------------------

const ZoneIdSchema = z.enum(['elf-forest', 'palace', 'neutral', 'villain-fort'])
const FactionIdSchema = z.enum(FACTION_IDS)
const UnitClassSchema = z.enum(['infantry', 'archer', 'cavalry', 'commander'])

// Explicit object (not z.record) so inferred type is Record<FactionId, number>, not Partial.
const UnitCountSchema = z.object({
  elves: z.number().int().nonnegative(),
  'palace-guard': z.number().int().nonnegative(),
  villain: z.number().int().nonnegative(),
})

const ZoneStateSchema = z.object({
  zoneId: ZoneIdSchema,
  controlledBy: FactionIdSchema.nullable(),
  unitCount: UnitCountSchema,
  hasCaravan: z.boolean(),
})

const UnitGroupSummarySchema = z.object({
  unitClass: UnitClassSchema,
  count: z.number().int().nonnegative(),
  avgHpPercent: z.number().int().min(0).max(100),
})

const KnownEnemySchema = z.object({
  faction: FactionIdSchema,
  nearestZone: ZoneIdSchema,
  estimatedStrength: z.number().nonnegative(),
})

export const StrategicStateSnapshotSchema = z.object({
  tickMs: z.number().nonnegative(),
  faction: FactionIdSchema,
  zones: z.array(ZoneStateSchema),
  ownUnits: z.array(UnitGroupSummarySchema),
  knownEnemies: z.array(KnownEnemySchema),
})

export const DecideRequestSchema = z.object({
  faction: FactionIdSchema,
  snapshot: StrategicStateSnapshotSchema,
})

export type DecideRequestBody = z.infer<typeof DecideRequestSchema>

// ---------------------------------------------------------------------------
// AgentCommand output schema — mirrors the TS discriminated union in types.ts.
// Used by deepseek.ts (tool-call arg validation) and EP-3 (LLM output check).
// idle.reason runs sanitizeIdleReason (BOO-481) as a parse-time transform so the
// deepseek hot path strips Unicode bidi controls, zero-width chars, C1 controls,
// and template/jailbreak patterns before the value reaches game logic.
// Defense-in-depth: validate.ts AgentCommandSchema applies the same transform on
// the EP-3 path; both schemas must stay in sync until consolidated (BOO-510 note).
// ---------------------------------------------------------------------------

export const AgentCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('patrol'),
    pathId: z.string().min(1).max(128),
    speed: z.enum(['slow', 'normal', 'fast']),
  }),
  z.object({
    kind: z.literal('ambush'),
    nodeId: z.string().min(1).max(128),
    durationSec: z.number().int().min(1).max(300),
  }),
  z.object({
    kind: z.literal('retreat'),
    nodeId: z.string().min(1).max(128),
  }),
  z.object({
    kind: z.literal('idle'),
    reason: z.string().max(128).transform(sanitizeIdleReason),
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
        pathId: { type: 'string', minLength: 1, maxLength: 128 },
        speed: { type: 'string', enum: ['slow', 'normal', 'fast'] },
      },
    },
    {
      type: 'object',
      required: ['kind', 'nodeId', 'durationSec'],
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'ambush' },
        nodeId: { type: 'string', minLength: 1, maxLength: 128 },
        durationSec: { type: 'integer', minimum: 1, maximum: 300 },
      },
    },
    {
      type: 'object',
      required: ['kind', 'nodeId'],
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'retreat' },
        nodeId: { type: 'string', minLength: 1, maxLength: 128 },
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
