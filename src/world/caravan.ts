/**
 * Caravan world state — pure FSM, no Three.js / Rapier deps.
 *
 * Cart follows a looped route through the forest. Player can intercept,
 * defeat escorts, and loot the cart. After a cooldown the caravan respawns.
 *
 * Serializable to SaveV1.world.caravanState via toSaveState() / fromSaveState().
 */

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/** 6-waypoint looped route through the forest (XZ — Y is always 0). */
export const CARAVAN_ROUTE: ReadonlyArray<{ x: number; z: number }> = [
  { x: -20, z: -10 },
  { x: -10, z: -30 },
  { x: 5, z: -42 },
  { x: 20, z: -32 },
  { x: 15, z: -15 },
  { x: -5, z: -4 },
]

// ---------------------------------------------------------------------------
// Config constants
// ---------------------------------------------------------------------------

/** Cart speed (m/s) — slower than player walk (~5 m/s). */
export const CARAVAN_CART_SPEED = 1.5

/** Respawn cooldown seconds (default 5 min). */
export const CARAVAN_RESPAWN_COOLDOWN_DEFAULT = 300

/** Interaction radius (m): player must be within this to trigger loot. */
export const CARAVAN_INTERACT_RANGE = 3

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CaravanStateId = 'active' | 'looted'

/** Serializable caravan snapshot — matches SaveV1.world.caravanState shape. */
export interface CaravanSaveState {
  stateId: CaravanStateId
  waypointIdx: number
  cartPosition: { x: number; z: number }
  respawnCooldownRemaining: number
}

export interface CaravanSnapshot {
  stateId: CaravanStateId
  cartPosition: { x: number; z: number }
  waypointIdx: number
  respawnCooldownRemaining: number
  /**
   * True for exactly one tick when the caravan transitions looted → active.
   * Main loop uses this to re-spawn escort soldiers.
   */
  didRespawn: boolean
}

export interface CaravanFsm {
  /** Advance FSM by dt seconds. */
  tick(dt: number): void
  /**
   * Trigger the loot event. Transitions active → looted and starts the
   * respawn cooldown. No-op if already looted.
   */
  loot(): void
  /** Returns a fresh snapshot. */
  getSnapshot(): CaravanSnapshot
  /** Serialize to save-format-compatible object. */
  toSaveState(): CaravanSaveState
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCaravanFsm(
  initial: Partial<CaravanSaveState> = {},
  respawnCooldown = CARAVAN_RESPAWN_COOLDOWN_DEFAULT,
): CaravanFsm {
  let stateId: CaravanStateId = initial.stateId ?? 'active'
  let waypointIdx = initial.waypointIdx ?? 0
  const cartPos = {
    x: initial.cartPosition?.x ?? CARAVAN_ROUTE[0].x,
    z: initial.cartPosition?.z ?? CARAVAN_ROUTE[0].z,
  }
  let respawnCooldownRemaining = initial.respawnCooldownRemaining ?? 0
  let didRespawn = false

  function tick(dt: number): void {
    didRespawn = false

    if (stateId === 'looted') {
      respawnCooldownRemaining = Math.max(0, respawnCooldownRemaining - dt)
      if (respawnCooldownRemaining <= 0) {
        stateId = 'active'
        waypointIdx = 0
        cartPos.x = CARAVAN_ROUTE[0].x
        cartPos.z = CARAVAN_ROUTE[0].z
        respawnCooldownRemaining = 0
        didRespawn = true
      }
      return
    }

    // active: move cart toward current waypoint along XZ
    const wp = CARAVAN_ROUTE[waypointIdx]
    const dx = wp.x - cartPos.x
    const dz = wp.z - cartPos.z
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d <= 0.4) {
      waypointIdx = (waypointIdx + 1) % CARAVAN_ROUTE.length
    } else {
      const step = Math.min(CARAVAN_CART_SPEED * dt, d)
      cartPos.x += (dx / d) * step
      cartPos.z += (dz / d) * step
    }
  }

  function loot(): void {
    if (stateId === 'looted') return
    stateId = 'looted'
    respawnCooldownRemaining = respawnCooldown
  }

  function getSnapshot(): CaravanSnapshot {
    return {
      stateId,
      cartPosition: { x: cartPos.x, z: cartPos.z },
      waypointIdx,
      respawnCooldownRemaining,
      didRespawn,
    }
  }

  function toSaveState(): CaravanSaveState {
    return {
      stateId,
      waypointIdx,
      cartPosition: { x: cartPos.x, z: cartPos.z },
      respawnCooldownRemaining,
    }
  }

  return { tick, loot, getSnapshot, toSaveState }
}
