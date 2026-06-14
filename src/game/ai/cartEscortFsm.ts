/**
 * Cart escort AI state machine.
 *
 * Pure logic — zero Three.js / Rapier / DOM dependencies.
 * Testable with a fake clock and WorldSnapshot.
 *
 * Mirrors SoldierFsm structure but replaces fixed-waypoint patrol with a
 * dynamic follow-target derived from the cart's current position + an offset.
 * When the player enters chaseRange the escort breaks off and engages.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EscortStateId = 'escort' | 'chase' | 'attack' | 'die'

export interface EscortWorldSnapshot {
  playerPosition: { x: number; z: number }
  /** Current cart XZ position — updated by the caravan FSM each frame. */
  cartPosition: { x: number; z: number }
}

export interface CartEscortFsmConfig {
  id: string
  /** XZ offset from cart centre (e.g. left-flank: { x: -2, z: 0 }). */
  offset: { x: number; z: number }
  /** Distance (m) that triggers player-chase. Default: 12. */
  chaseRange: number
  /** Distance (m) that triggers melee attack. Default: 1.5. */
  meleeRange: number
  /** Seconds between attack swings. Default: 1.2. */
  attackCooldown: number
  /** Seconds in die state before shouldRemove. Default: 5. */
  dieDelay: number
  /** Move speed (m/s). Default: 2.8 — fast enough to keep up with cart. */
  moveSpeed: number
  /** Starting HP. Default: 50. */
  maxHp: number
}

export const DEFAULT_ESCORT_CONFIG: Readonly<Omit<CartEscortFsmConfig, 'id' | 'offset'>> = {
  chaseRange: 12,
  meleeRange: 1.5,
  attackCooldown: 1.2,
  dieDelay: 5,
  moveSpeed: 2.8,
  maxHp: 50,
}

export interface EscortSnapshot {
  stateId: EscortStateId
  position: { x: number; y: number; z: number }
  hp: number
  isDead: boolean
  shouldRemove: boolean
  /**
   * Seconds remaining on the swing cooldown; 0 means a swing is ready.
   * Read BEFORE calling tick() to catch the ready frame (mirrors SoldierFsm).
   */
  attackCooldownRemaining: number
}

export interface CartEscortFsm {
  tick(dt: number, world: EscortWorldSnapshot): void
  takeDamage(amount: number): void
  getSnapshot(): EscortSnapshot
  readonly config: Readonly<CartEscortFsmConfig>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function xzDistSq(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return dx * dx + dz * dz
}

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

export function createCartEscortFsm(
  config: CartEscortFsmConfig,
  startPosition: { x: number; y: number; z: number },
): CartEscortFsm {
  let stateId: EscortStateId = 'escort'
  let hp = config.maxHp
  let attackCooldownRemaining = 0
  let dieTimer = 0
  let shouldRemove = false

  const pos = { x: startPosition.x, y: startPosition.y, z: startPosition.z }

  function tick(dt: number, world: EscortWorldSnapshot): void {
    if (stateId === 'die') {
      dieTimer += dt
      if (dieTimer >= config.dieDelay) shouldRemove = true
      return
    }

    if (hp <= 0) {
      stateId = 'die'
      dieTimer = 0
      return
    }

    const pDist = Math.sqrt(xzDistSq(pos, world.playerPosition))

    switch (stateId) {
      case 'escort': {
        // Follow cart + configured offset
        const followTarget = {
          x: world.cartPosition.x + config.offset.x,
          z: world.cartPosition.z + config.offset.z,
        }
        if (xzDistSq(pos, followTarget) > 0.16) {
          // 0.16 = 0.4² arrival threshold
          stepToward(pos, followTarget, config.moveSpeed * dt)
        }
        // Aggro when player enters chase range
        if (pDist <= config.chaseRange) {
          stateId = 'chase'
        }
        break
      }

      case 'chase': {
        if (pDist <= config.meleeRange) {
          stateId = 'attack'
          attackCooldownRemaining = 0
        } else if (pDist > config.chaseRange * 1.2) {
          // Hysteresis: player escaped — return to escort
          stateId = 'escort'
        } else {
          stepToward(pos, { x: world.playerPosition.x, z: world.playerPosition.z }, config.moveSpeed * dt)
        }
        break
      }

      case 'attack': {
        attackCooldownRemaining = Math.max(0, attackCooldownRemaining - dt)
        if (attackCooldownRemaining <= 0) {
          attackCooldownRemaining = config.attackCooldown
        }
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

  function getSnapshot(): EscortSnapshot {
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
