/**
 * LLM output validator — schema-enforces AgentCommand before any game logic runs.
 * Spec: docs/llm-provider.md §2 (BOO-468) / BOO-481.
 *
 * Key design decisions (CSO sign-off required — see BOO-481):
 *  • .strict() on every object variant: extra fields from the LLM are rejected,
 *    not silently passed through. This prevents "backdoor" field injection.
 *  • discriminatedUnion: only the four allowed command kinds are accepted.
 *  • durationSec bounded [1, 300]: prevents absurdly long ambush timers.
 *  • reason capped at 128 chars: prevents unbounded text in idle commands.
 *  • Throws LLMSchemaInvalidError (never swallows errors): callers (EP-3 /
 *    BC-1 DeepSeekAdapter) catch and apply scripted fallback per §3 of spec.
 */

import { z } from 'zod'
import type { AgentCommand } from './types'

// ---------------------------------------------------------------------------
// Per-variant schemas — all .strict() to reject unknown fields
// ---------------------------------------------------------------------------

const PatrolSchema = z
  .object({
    kind: z.literal('patrol'),
    pathId: z.string(),
    speed: z.enum(['slow', 'normal', 'fast']),
  })
  .strict()

const AmbushSchema = z
  .object({
    kind: z.literal('ambush'),
    nodeId: z.string(),
    durationSec: z.number().int().min(1).max(300),
  })
  .strict()

const RetreatSchema = z
  .object({
    kind: z.literal('retreat'),
    nodeId: z.string(),
  })
  .strict()

// reason cap mirrors AgentCommand comment in types.ts ("capped at 128 chars")
const IdleSchema = z
  .object({
    kind: z.literal('idle'),
    reason: z.string().max(128),
  })
  .strict()

// ---------------------------------------------------------------------------
// Public schema export
// ---------------------------------------------------------------------------

/**
 * Zod schema for the AgentCommand discriminated union.
 * Annotated as ZodType<AgentCommand> to surface compile-time mismatches
 * between the Zod inferred type and the canonical TypeScript type.
 */
export const AgentCommandSchema: z.ZodType<AgentCommand> = z.discriminatedUnion(
  'kind',
  [PatrolSchema, AmbushSchema, RetreatSchema, IdleSchema],
)

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/** Thrown when the LLM response does not conform to AgentCommand schema. */
export class LLMSchemaInvalidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LLMSchemaInvalidError'
  }
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Parse and validate raw LLM output against AgentCommandSchema.
 *
 * @param raw  The raw parsed JSON value from the LLM response body.
 * @returns    A fully typed AgentCommand on success.
 * @throws     LLMSchemaInvalidError with a descriptive message on any schema
 *             violation (unknown kind, missing required field, extra field,
 *             out-of-range value, wrong type, enum violation).
 */
export function validateLLMOutput(raw: unknown): AgentCommand {
  const result = AgentCommandSchema.safeParse(raw)
  if (!result.success) {
    const summary = result.error.issues
      .map((i) => `[${i.path.join('.')}] ${i.message}`)
      .join('; ')
    throw new LLMSchemaInvalidError(`LLM output schema invalid: ${summary}`)
  }
  return result.data
}
