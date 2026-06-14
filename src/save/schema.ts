import { z } from 'zod';
import type { ProviderSettings } from '../ai/types.js';

// Placeholder until inventory issue defines the canonical shape
export interface LootItem {
  id: string;
  qty: number;
}

// Mirrors ProviderSettings from ../ai/types — the `satisfies` clause below
// ensures the zod-inferred type stays structurally compatible at compile time
const providerSettingsSchema = z.object({
  id: z.enum(['deepseek', 'anthropic', 'openai-compat']),
  baseUrl: z.string(),
  model: z.string(),
  apiKey: z.string(),
  timeoutMs: z.number().int().positive(),
}) satisfies z.ZodType<ProviderSettings>;

const lootItemSchema = z.object({
  id: z.string(),
  qty: z.number().int().nonnegative(),
});

const saveV1Schema = z.object({
  version: z.literal(1),
  player: z.object({
    hp: z.number().int().nonnegative(),
    position: z.tuple([z.number(), z.number(), z.number()]),
    inventory: z.array(lootItemSchema),
  }),
  world: z.object({
    caravanState: z.unknown(),
  }),
  settings: z.object({
    provider: providerSettingsSchema,
  }),
});

export type SaveV1 = z.infer<typeof saveV1Schema>;

export function validateSaveV1(raw: unknown): SaveV1 {
  return saveV1Schema.parse(raw);
}

// Union of all versioned save types; extend here when SaveV2 ships
export type AnyVersion = SaveV1;

// Identity for v1 — add v2 → v1 conversion here when SaveV2 is defined
export function migrate(prev: AnyVersion): SaveV1 {
  return prev;
}
