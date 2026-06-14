/**
 * AI strategic-tick scheduler.
 *
 * P1: noop wrapper — FSM ticks every frame driven by the game loop.
 * P2: LLM provider substitutes here, issuing strategic overrides on a slower
 *     cadence (e.g., once per second) via the provider interface in ai/types.ts.
 *
 * Callers invoke onStrategicTick() each frame; the scheduler decides whether
 * to act (P2: rate-limit to N ms intervals). This way, switching from P1 → P2
 * only requires swapping the scheduler — SoldierEntity and main.ts are unchanged.
 */

import type { SoldierFsm, WorldSnapshot } from './soldierFsm'

export interface AiScheduler {
  /**
   * Called every game-loop frame. P1: noop. P2: LLM driver samples this at
   * a strategic interval (e.g., 1 s) and may override FSM state.
   */
  onStrategicTick(soldiers: readonly SoldierFsm[], snapshot: WorldSnapshot): void
}

/** P1 noop scheduler — passes through without modification. */
export function createNoopAiScheduler(): AiScheduler {
  return {
    onStrategicTick(
      _soldiers: readonly SoldierFsm[],
      _snapshot: WorldSnapshot,
    ): void {
      // noop — P2 LLM driver substitutes strategic commands here
    },
  }
}
