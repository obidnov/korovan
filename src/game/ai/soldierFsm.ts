/**
 * Palace soldier scripted AI state machine.
 *
 * Pure logic — zero Three.js / Rapier / DOM dependencies.
 * Testable with a fake clock and fake WorldSnapshot.
 *
 * P2 integration point: AiScheduler (aiScheduler.ts) calls tick() and may
 * inject LLM-driver overrides before the FSM processes them.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SoldierStateId = 'idle' | 'chase' | 'attack' | 'die'

/**
 * Minimal world-state view for one FSM tick. Pure data — no engine types.
 * `playerInLineOfSight` is computed by SoldierEntity (Rapier raycast) so the
 * FSM stays engine-agnostic and fully unit-testable with a boolean flag.
 */
export interface WorldSnapshot {
  playerPosition: { x: number; y: number; z: number }
  /**
   * Unobstructed line of sight from soldier to player.
   * P1: set to `true` when player is within chaseRange (flat terrain, no obstacles).
   * P2: computed via Rapier ray-cast in SoldierEntity.tick().
   */
  playerInLineOfSight: boolean
}

export interface SoldierFsmConfig {
  id: string
  /** XZ patrol waypoints. Y is used for initial spawn height only. */
  waypoints: ReadonlyArray<{ x: number; y: number; z: number }>
  /** Distance (m) that triggers chase (with LOS). Default: 15. */
  chaseRange: number
  /** Distance (m) that triggers melee attack. Default: 1.5. */
  meleeRange: number
  /** Seconds between attack swings. Consumed by the combat system. Default: 1.2. */
  attackCooldown: number
  /** Seconds in die state before shouldRemove is set. Default: 5. */
  dieDelay: number
  /** Horizontal move speed (m/s). Default: 2.5. */
  moveSpeed: number
  /** Starting HP. Default: 50. */
  maxHp: number
}

export const DEFAULT_SOLDIER_CONFIG: Readonly<Omit<SoldierFsmConfig, 'id' | 'waypoints'>> = {
  chaseRange: 15,
  meleeRange: 1.5,
  attackCooldown: 1.2,
  dieDelay: 5,
  moveSpeed: 2.5,
  maxHp: 50,
}

/** Value snapshot — safe to read without locking; returned by getSnapshot(). */
export interface SoldierSnapshot {
  stateId: SoldierStateId
  position: { x: number; y: number; z: number }
  hp: number
  isDead: boolean
  /**
   * True after dieDelay elapses in the die state.
   * Caller (SoldierEntity) should call dispose() and remove from scene.
   */
  shouldRemove: boolean
  /**
   * Seconds remaining on the attack-swing cooldown; 0 means a swing is ready.
   * The combat system (separate issue) reads this to apply damage.
   * On the tick that cooldown hits 0 the FSM resets it to attackCooldown —
   * read the snapshot *before* calling tick() to catch the ready frame.
   */
  attackCooldownRemaining: number
}

export interface SoldierFsm {
  /** Advance FSM by dt seconds with current world view. */
  tick(dt: number, worldSnapshot: WorldSnapshot): void
  /** Apply incoming damage (from player combat). Noop when already dead. */
  takeDamage(amount: number): void
  /** Returns a fresh snapshot (shallow copy) — call as often as needed. */
  getSnapshot(): SoldierSnapshot
  readonly config: Readonly<SoldierFsmConfig>
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function xzDistSq(
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return dx * dx + dz * dz
}

/** Move `pos` toward `target` in the XZ plane by at most `maxStep`. Mutates `pos`. */
function stepToward(
  pos: { x: number; z: number },
  target: { x: number; z: number },
  maxStep: number,
): void {
  const dx = target.x - pos.x
  const dz = target.z - pos.z
  const d = Math.sqrt(dx * dx + dz * dz)
  if (d < 0.001) return
  const t = Math.min(1, maxStep / d)
  pos.x += dx * t
  pos.z += dz * t
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSoldierFsm(
  config: SoldierFsmConfig,
  startPosition: { x: number; y: number; z: number },
): SoldierFsm {
  if (config.waypoints.length === 0) {
    throw new Error(`SoldierFsm "${config.id}": waypoints must not be empty`)
  }

  let stateId: SoldierStateId = 'idle'
  let hp = config.maxHp
  let waypointIdx = 0
  let attackCooldownRemaining = 0
  let dieTimer = 0
  let shouldRemove = false

  // Mutable internal position (Y held at spawn height — no vertical simulation here)
  const pos = { x: startPosition.x, y: startPosition.y, z: startPosition.z }

  function tick(dt: number, world: WorldSnapshot): void {
    // Die state: count down to removal
    if (stateId === 'die') {
      dieTimer += dt
      if (dieTimer >= config.dieDelay) shouldRemove = true
      return
    }

    // HP gate: zero HP transitions to die
    if (hp <= 0) {
      stateId = 'die'
      dieTimer = 0
      return
    }

    const pDist = Math.sqrt(xzDistSq(pos, world.playerPosition))

    switch (stateId) {
      case 'idle': {
        // Patrol: move toward current waypoint; advance when within arrival threshold
        const wp = config.waypoints[waypointIdx]
        if (Math.sqrt(xzDistSq(pos, wp)) <= 0.4) {
          waypointIdx = (waypointIdx + 1) % config.waypoints.length
        } else {
          stepToward(pos, wp, config.moveSpeed * dt)
        }
        // Chase trigger: player within range AND line-of-sight
        if (pDist <= config.chaseRange && world.playerInLineOfSight) {
          stateId = 'chase'
        }
        break
      }

      case 'chase': {
        if (pDist <= config.meleeRange) {
          // Enter attack — first swing is immediately ready (cooldown = 0)
          stateId = 'attack'
          attackCooldownRemaining = 0
        } else if (pDist > config.chaseRange * 1.2) {
          // Hysteresis: player escaped — return to patrol
          stateId = 'idle'
        } else {
          stepToward(pos, world.playerPosition, config.moveSpeed * dt)
        }
        break
      }

      case 'attack': {
        // Decrement cooldown; reset when it hits zero (combat system reads before tick)
        attackCooldownRemaining = Math.max(0, attackCooldownRemaining - dt)
        if (attackCooldownRemaining <= 0) {
          attackCooldownRemaining = config.attackCooldown
        }
        // Break off when player steps back
        if (pDist > config.meleeRange) {
          stateId = 'chase'
        }
        break
      }
    }
  }

  function takeDamage(amount: number): void {
    if (stateId === 'die') return
    hp = Math.max(0, hp - amount)
  }

  function getSnapshot(): SoldierSnapshot {
    return {
      stateId,
      position: { x: pos.x, y: pos.y, z: pos.z },
      hp,
      isDead: hp <= 0,
      shouldRemove,
      attackCooldownRemaining,
    }
  }

  return { tick, takeDamage, getSnapshot, config }
}
