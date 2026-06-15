import { z } from 'zod';
import type { CaravanSaveState } from '../world/caravan.js';

// Placeholder until inventory issue defines the canonical shape
export interface LootItem {
  id: string;
  qty: number;
}

export const lootItemSchema = z.object({
  id: z.string(),
  qty: z.number().int().nonnegative(),
});

export const caravanSaveStateSchema = z.object({
  stateId: z.enum(['active', 'looted']),
  waypointIdx: z.number().int().nonnegative(),
  cartPosition: z.object({
    x: z.number(),
    z: z.number(),
  }),
  respawnCooldownRemaining: z.number().nonnegative(),
}) satisfies z.ZodType<CaravanSaveState>;

const saveV1Schema = z.object({
  version: z.literal(1),
  player: z.object({
    hp: z.number().int().nonnegative(),
    position: z.tuple([z.number(), z.number(), z.number()]),
    inventory: z.array(lootItemSchema),
  }),
  world: z.object({
    // null accepted for saves predating the caravan feature (BOO-387)
    caravanState: z.union([caravanSaveStateSchema, z.null()]),
  }),
  // settings.provider was client-side in pre-BOO-485 saves; now server-side per P0-3/P0-4.
  // Field kept optional so old saves continue to parse without error.
  settings: z.object({
    provider: z.unknown().optional(),
  }).optional(),
});

export type SaveV1 = z.infer<typeof saveV1Schema>;

export function validateSaveV1(raw: unknown): SaveV1 {
  return saveV1Schema.parse(raw);
}

// Union of all versioned save types; extend here when SaveV2 ships
export type AnyVersion = SaveV1;

// SaveCurrent always points to the latest version — re-alias when SaveVN ships
export type SaveCurrent = SaveV1;

// Identity for v1 — add v1 → v2 upgrade case here when SaveV2 is defined
export function migrate(prev: AnyVersion): SaveCurrent {
  return prev;
}
