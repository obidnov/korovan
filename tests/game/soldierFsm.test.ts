import { describe, it, expect } from 'vitest'
import {
  createSoldierFsm,
  DEFAULT_SOLDIER_CONFIG,
  type SoldierFsmConfig,
  type WorldSnapshot,
} from '../../src/game/ai/soldierFsm'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG: SoldierFsmConfig = {
  id: 'test-soldier',
  waypoints: [
    { x: 10, y: 0, z: 0 },
    { x: -10, y: 0, z: 0 },
  ],
  ...DEFAULT_SOLDIER_CONFIG,
}

const ORIGIN = { x: 0, y: 0, z: 0 }

/** Player far away, no LOS — will not trigger chase. */
function farWorld(x = 0, z = 100): WorldSnapshot {
  return { playerPosition: { x, y: 0, z }, playerInLineOfSight: false }
}

/** Player within chaseRange (< 15 m) with LOS. */
function nearWorld(x = 10, z = 0): WorldSnapshot {
  return { playerPosition: { x, y: 0, z }, playerInLineOfSight: true }
}

/** Player within meleeRange (< 1.5 m). */
function meleeWorld(x = 1, z = 0): WorldSnapshot {
  return { playerPosition: { x, y: 0, z }, playerInLineOfSight: true }
}

// ---------------------------------------------------------------------------
// Configuration guard
// ---------------------------------------------------------------------------

describe('createSoldierFsm — config validation', () => {
  it('throws when waypoints array is empty', () => {
    expect(() =>
      createSoldierFsm({ ...BASE_CONFIG, waypoints: [] }, ORIGIN),
    ).toThrow('waypoints must not be empty')
  })

  it('starts in idle state with full HP', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    const snap = fsm.getSnapshot()
    expect(snap.stateId).toBe('idle')
    expect(snap.hp).toBe(BASE_CONFIG.maxHp)
    expect(snap.isDead).toBe(false)
    expect(snap.shouldRemove).toBe(false)
  })

  it('exposes config with correct defaults', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    expect(fsm.config.chaseRange).toBe(15)
    expect(fsm.config.meleeRange).toBe(1.5)
    expect(fsm.config.attackCooldown).toBe(1.2)
    expect(fsm.config.dieDelay).toBe(5)
    expect(fsm.config.moveSpeed).toBe(2.5)
    expect(fsm.config.maxHp).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// Idle / patrol
// ---------------------------------------------------------------------------

describe('idle state — patrol', () => {
  it('moves toward first waypoint while player is out of range', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN) // wp[0] = (10, 0, 0)
    fsm.tick(1.0, farWorld()) // 1 second, moveSpeed=2.5 → should move 2.5 m toward x=10
    const snap = fsm.getSnapshot()
    expect(snap.stateId).toBe('idle')
    expect(snap.position.x).toBeGreaterThan(0)
    expect(snap.position.x).toBeCloseTo(2.5, 1)
  })

  it('advances waypoint index when within arrival threshold (0.4 m)', () => {
    // Start 0.3 m away from wp[0] — within threshold, so index advances this tick
    const fsm = createSoldierFsm(BASE_CONFIG, { x: 9.7, y: 0, z: 0 })
    fsm.tick(0.016, farWorld()) // arrival check: dist=0.3 < 0.4 → advance to wp[1]=(-10,0,0)
    fsm.tick(0.5, farWorld())   // now heading toward (-10, 0, 0)
    const snap = fsm.getSnapshot()
    expect(snap.stateId).toBe('idle')
    // After advancing to wp[1], x should decrease
    expect(snap.position.x).toBeLessThan(9.7)
  })

  it('wraps waypoint index after last waypoint', () => {
    // Place soldier near wp[1] = (-10, 0, 0)
    const fsm = createSoldierFsm(BASE_CONFIG, { x: -9.9, y: 0, z: 0 })
    // Tick to advance to wp[1] arrival (dist < 0.4)
    fsm.tick(0.016, farWorld())  // dist = 0.1 < 0.4 → advance to wp[0] (wrap)
    fsm.tick(1.0, farWorld())    // heading back toward wp[0] = (10, 0, 0)
    const snap = fsm.getSnapshot()
    expect(snap.position.x).toBeGreaterThan(-9.9) // moving right toward x=10
  })

  it('does not chase player out of range (even with LOS)', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    // Player at x=20 — beyond chaseRange=15
    fsm.tick(0.1, { playerPosition: { x: 20, y: 0, z: 0 }, playerInLineOfSight: true })
    expect(fsm.getSnapshot().stateId).toBe('idle')
  })

  it('does not chase player in range without LOS', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    // Player at x=10 (within 15 m), but LOS=false
    fsm.tick(0.1, { playerPosition: { x: 10, y: 0, z: 0 }, playerInLineOfSight: false })
    expect(fsm.getSnapshot().stateId).toBe('idle')
  })
})

// ---------------------------------------------------------------------------
// Idle → Chase
// ---------------------------------------------------------------------------

describe('idle → chase transition', () => {
  it('enters chase when player is within chaseRange with LOS', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    fsm.tick(0.016, nearWorld(10, 0)) // dist=10 < 15, LOS=true
    expect(fsm.getSnapshot().stateId).toBe('chase')
  })

  it('moves toward player while chasing', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    // Trigger chase
    fsm.tick(0.016, nearWorld(10, 0))
    const prevX = fsm.getSnapshot().position.x
    // Chase for 1 second
    fsm.tick(1.0, nearWorld(10, 0))
    const snap = fsm.getSnapshot()
    expect(snap.stateId).toBe('chase')
    expect(snap.position.x).toBeGreaterThan(prevX) // moved toward player
  })

  it('initial position is not moved on the chase-entry tick itself', () => {
    // On the tick where idle→chase transition fires, the idle branch already
    // tried to move toward the waypoint. Position should still change, but
    // state becomes chase.
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    fsm.tick(1.0, nearWorld(10, 0))
    expect(fsm.getSnapshot().stateId).toBe('chase')
  })
})

// ---------------------------------------------------------------------------
// Chase → Attack
// ---------------------------------------------------------------------------

describe('chase → attack transition', () => {
  it('enters attack when player is within meleeRange', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    fsm.tick(0.016, nearWorld(10, 0)) // → chase
    fsm.tick(0.016, meleeWorld(1, 0)) // player at dist=1 < meleeRange=1.5 → attack
    expect(fsm.getSnapshot().stateId).toBe('attack')
  })

  it('enters attack with attackCooldownRemaining = 0 (first swing is immediately ready)', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    fsm.tick(0.016, nearWorld(10, 0))
    fsm.tick(0.016, meleeWorld(1, 0))
    expect(fsm.getSnapshot().attackCooldownRemaining).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Attack state
// ---------------------------------------------------------------------------

describe('attack state', () => {
  function setupInAttack() {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    fsm.tick(0.016, nearWorld(10, 0)) // idle → chase
    fsm.tick(0.016, meleeWorld(1, 0)) // chase → attack (cooldown=0)
    return fsm
  }

  it('resets cooldown to attackCooldown on the first attack tick', () => {
    const fsm = setupInAttack()
    // First attack tick: cooldown was 0 → Math.max(0, 0-dt)=0 → reset to 1.2 (full cooldown)
    // The full dt is absorbed into the clamping, so result is exactly 1.2 (not 1.2-dt)
    fsm.tick(0.016, meleeWorld(1, 0))
    const snap = fsm.getSnapshot()
    expect(snap.stateId).toBe('attack')
    expect(snap.attackCooldownRemaining).toBe(1.2)
  })

  it('counts down cooldown each tick after the initial reset', () => {
    const fsm = setupInAttack()
    // First attack tick: detect cooldown=0, reset to 1.2
    fsm.tick(0.016, meleeWorld(1, 0))
    expect(fsm.getSnapshot().attackCooldownRemaining).toBe(1.2)
    // Subsequent tick: decrement normally
    fsm.tick(0.5, meleeWorld(1, 0))
    expect(fsm.getSnapshot().attackCooldownRemaining).toBeCloseTo(0.7, 2)
  })

  it('cycles back to fresh cooldown after attackCooldown seconds elapse', () => {
    const fsm = setupInAttack()
    // First tick: reset to 1.2
    fsm.tick(0.016, meleeWorld(1, 0))
    // Drain 0.9 s → 0.3 remaining
    fsm.tick(0.9, meleeWorld(1, 0))
    expect(fsm.getSnapshot().attackCooldownRemaining).toBeCloseTo(0.3, 2)
    // Drain 0.35 s → goes below 0, clamps to 0, immediately resets to 1.2 again
    fsm.tick(0.35, meleeWorld(1, 0))
    expect(fsm.getSnapshot().attackCooldownRemaining).toBe(1.2)
  })

  it('stays in attack while player remains in melee range', () => {
    const fsm = setupInAttack()
    for (let i = 0; i < 10; i++) {
      fsm.tick(0.1, meleeWorld(1, 0))
    }
    expect(fsm.getSnapshot().stateId).toBe('attack')
  })

  it('breaks out to chase when player moves beyond meleeRange', () => {
    const fsm = setupInAttack()
    fsm.tick(0.016, nearWorld(5, 0)) // player moved to x=5, dist=5 > meleeRange=1.5
    expect(fsm.getSnapshot().stateId).toBe('chase')
  })
})

// ---------------------------------------------------------------------------
// Chase → Idle (hysteresis)
// ---------------------------------------------------------------------------

describe('chase → idle hysteresis', () => {
  it('returns to idle when player escapes beyond chaseRange * 1.2 (18 m)', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    fsm.tick(0.016, nearWorld(10, 0)) // → chase
    // Player escapes to x=19 (> 18 m = 15 * 1.2)
    fsm.tick(0.016, { playerPosition: { x: 19, y: 0, z: 0 }, playerInLineOfSight: true })
    expect(fsm.getSnapshot().stateId).toBe('idle')
  })

  it('stays in chase within hysteresis band (15 m < dist < 18 m)', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    fsm.tick(0.016, nearWorld(10, 0)) // → chase
    // Player at x=16 — within hysteresis (15 < 16 < 18), stays in chase
    fsm.tick(0.016, { playerPosition: { x: 16, y: 0, z: 0 }, playerInLineOfSight: true })
    expect(fsm.getSnapshot().stateId).toBe('chase')
  })
})

// ---------------------------------------------------------------------------
// Damage and die
// ---------------------------------------------------------------------------

describe('takeDamage', () => {
  it('reduces HP', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    fsm.takeDamage(20)
    expect(fsm.getSnapshot().hp).toBe(30)
  })

  it('clamps HP to 0 (no negative HP)', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    fsm.takeDamage(999)
    expect(fsm.getSnapshot().hp).toBe(0)
  })

  it('is a noop when already in die state', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    fsm.takeDamage(50) // kill
    fsm.tick(0.016, farWorld())  // → die
    fsm.takeDamage(100) // should be noop
    expect(fsm.getSnapshot().hp).toBe(0) // unchanged
  })
})

describe('die state', () => {
  function setupDead() {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    fsm.takeDamage(50) // HP = 0
    fsm.tick(0.016, farWorld()) // → stateId = 'die'
    return fsm
  }

  it('transitions to die on next tick after HP hits 0', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    fsm.takeDamage(50)
    expect(fsm.getSnapshot().hp).toBe(0)
    expect(fsm.getSnapshot().isDead).toBe(true)
    expect(fsm.getSnapshot().stateId).not.toBe('die') // not yet
    fsm.tick(0.016, farWorld())
    expect(fsm.getSnapshot().stateId).toBe('die')
  })

  it('sets isDead immediately when HP hits 0 via takeDamage', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    fsm.takeDamage(50)
    expect(fsm.getSnapshot().isDead).toBe(true)
  })

  it('shouldRemove is false before dieDelay elapses', () => {
    const fsm = setupDead()
    // Tick for 4.9 s (just under dieDelay=5)
    fsm.tick(4.9, farWorld())
    expect(fsm.getSnapshot().shouldRemove).toBe(false)
  })

  it('shouldRemove becomes true after dieDelay elapses', () => {
    const fsm = setupDead()
    // dieDelay = 5 s; first tick was 0.016 s
    fsm.tick(5.0, farWorld()) // total 5.016 s > 5 s
    expect(fsm.getSnapshot().shouldRemove).toBe(true)
  })

  it('does not move position while in die state', () => {
    const fsm = setupDead()
    const posBeforeDie = fsm.getSnapshot().position
    fsm.tick(2.0, farWorld())
    const posAfterDie = fsm.getSnapshot().position
    expect(posAfterDie.x).toBe(posBeforeDie.x)
    expect(posAfterDie.z).toBe(posBeforeDie.z)
  })

  it('does not transition out of die state', () => {
    const fsm = setupDead()
    // Throw everything at it — should stay in die
    fsm.tick(0.1, meleeWorld(0, 0))
    expect(fsm.getSnapshot().stateId).toBe('die')
  })
})

// ---------------------------------------------------------------------------
// getSnapshot isolation
// ---------------------------------------------------------------------------

describe('getSnapshot', () => {
  it('returns a fresh copy each call (mutations do not leak back)', () => {
    const fsm = createSoldierFsm(BASE_CONFIG, ORIGIN)
    const snap1 = fsm.getSnapshot()
    // Mutate position on the copy
    ;(snap1.position as { x: number }).x = 999
    const snap2 = fsm.getSnapshot()
    expect(snap2.position.x).toBe(0) // internal state unchanged
  })
})

// ---------------------------------------------------------------------------
// DEFAULT_SOLDIER_CONFIG
// ---------------------------------------------------------------------------

describe('DEFAULT_SOLDIER_CONFIG', () => {
  it('has the canonical P1 values', () => {
    expect(DEFAULT_SOLDIER_CONFIG.chaseRange).toBe(15)
    expect(DEFAULT_SOLDIER_CONFIG.meleeRange).toBe(1.5)
    expect(DEFAULT_SOLDIER_CONFIG.attackCooldown).toBe(1.2)
    expect(DEFAULT_SOLDIER_CONFIG.dieDelay).toBe(5)
    expect(DEFAULT_SOLDIER_CONFIG.moveSpeed).toBe(2.5)
    expect(DEFAULT_SOLDIER_CONFIG.maxHp).toBe(50)
  })
})
