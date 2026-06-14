import { describe, it, expect } from 'vitest'
import {
  createCartEscortFsm,
  DEFAULT_ESCORT_CONFIG,
  type EscortWorldSnapshot,
} from '../../../src/game/ai/cartEscortFsm'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CART_POS = { x: 0, z: 0 }
const FAR_PLAYER = { x: 100, z: 100 }

const neutralWorld = (cartPos = CART_POS): EscortWorldSnapshot => ({
  playerPosition: FAR_PLAYER,
  cartPosition: cartPos,
})

function makeEscort(overrides: Partial<typeof DEFAULT_ESCORT_CONFIG> = {}) {
  return createCartEscortFsm(
    {
      id: 'test-escort',
      offset: { x: 0, z: 0 },
      ...DEFAULT_ESCORT_CONFIG,
      ...overrides,
    },
    { x: 0, y: 0, z: 0 },
  )
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('CartEscortFsm — initial state', () => {
  it('starts in escort state', () => {
    const fsm = makeEscort()
    expect(fsm.getSnapshot().stateId).toBe('escort')
  })

  it('starts at full HP', () => {
    const fsm = makeEscort()
    expect(fsm.getSnapshot().hp).toBe(DEFAULT_ESCORT_CONFIG.maxHp)
    expect(fsm.getSnapshot().isDead).toBe(false)
  })

  it('shouldRemove is false initially', () => {
    const fsm = makeEscort()
    expect(fsm.getSnapshot().shouldRemove).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Escort mode
// ---------------------------------------------------------------------------

describe('CartEscortFsm — escort state', () => {
  it('moves toward cart + offset when far from follow target', () => {
    const fsm = createCartEscortFsm(
      { id: 'e', offset: { x: 3, z: 0 }, ...DEFAULT_ESCORT_CONFIG },
      { x: 0, y: 0, z: 0 },
    )
    const world: EscortWorldSnapshot = { playerPosition: FAR_PLAYER, cartPosition: { x: 10, z: 0 } }
    fsm.tick(0.1, world)
    const snap = fsm.getSnapshot()
    // Should have moved toward (10 + 3, 0) = (13, 0)
    expect(snap.position.x).toBeGreaterThan(0)
  })

  it('stays near follow target when already close', () => {
    const fsm = createCartEscortFsm(
      { id: 'e', offset: { x: 0, z: 0 }, ...DEFAULT_ESCORT_CONFIG },
      { x: 5, y: 0, z: 0 },
    )
    const world: EscortWorldSnapshot = {
      playerPosition: FAR_PLAYER,
      cartPosition: { x: 5, z: 0 },
    }
    fsm.tick(0.016, world)
    const snap = fsm.getSnapshot()
    // Should not overshoot
    expect(Math.abs(snap.position.x - 5)).toBeLessThan(0.1)
  })

  it('does not aggro on far player', () => {
    const fsm = makeEscort()
    fsm.tick(0.016, neutralWorld())
    expect(fsm.getSnapshot().stateId).toBe('escort')
  })
})

// ---------------------------------------------------------------------------
// Chase transition
// ---------------------------------------------------------------------------

describe('CartEscortFsm — escort → chase', () => {
  it('transitions to chase when player enters chaseRange', () => {
    const fsm = makeEscort({ chaseRange: 15 })
    const world: EscortWorldSnapshot = {
      playerPosition: { x: 10, z: 0 }, // within 15 m
      cartPosition: CART_POS,
    }
    fsm.tick(0.016, world)
    expect(fsm.getSnapshot().stateId).toBe('chase')
  })

  it('moves toward player in chase state', () => {
    const fsm = makeEscort()
    // Position escort at 0,0; player at (10, 0)
    const world: EscortWorldSnapshot = {
      playerPosition: { x: 10, z: 0 },
      cartPosition: CART_POS,
    }
    fsm.tick(0.016, world) // enters chase
    const before = fsm.getSnapshot()
    fsm.tick(0.1, world)
    const after = fsm.getSnapshot()
    expect(after.position.x).toBeGreaterThan(before.position.x)
  })

  it('returns to escort when player escapes past hysteresis', () => {
    const fsm = makeEscort({ chaseRange: 12 })
    // Aggro
    fsm.tick(0.016, { playerPosition: { x: 10, z: 0 }, cartPosition: CART_POS })
    expect(fsm.getSnapshot().stateId).toBe('chase')
    // Player runs far away (beyond 12 * 1.2 = 14.4 m)
    fsm.tick(0.016, { playerPosition: { x: 20, z: 0 }, cartPosition: CART_POS })
    expect(fsm.getSnapshot().stateId).toBe('escort')
  })
})

// ---------------------------------------------------------------------------
// Attack transition
// ---------------------------------------------------------------------------

describe('CartEscortFsm — attack state', () => {
  it('enters attack when in melee range', () => {
    // State machine steps: escort → chase (tick 1) → attack (tick 2).
    // The escort state only transitions to chase; melee check is in the chase state.
    const escort = createCartEscortFsm(
      { id: 'e', offset: { x: 0, z: 0 }, ...DEFAULT_ESCORT_CONFIG, chaseRange: 15, meleeRange: 1.5 },
      { x: 0.5, y: 0, z: 0 }, // within 1.5 m of player at (1,0)
    )
    const world: EscortWorldSnapshot = { playerPosition: { x: 1, z: 0 }, cartPosition: CART_POS }
    escort.tick(0.016, world) // escort → chase (player within chaseRange)
    expect(escort.getSnapshot().stateId).toBe('chase')
    escort.tick(0.016, world) // chase → attack (player within meleeRange)
    expect(escort.getSnapshot().stateId).toBe('attack')
  })

  it('resets attackCooldownRemaining on first attack swing frame', () => {
    const escort = createCartEscortFsm(
      { id: 'e', offset: { x: 0, z: 0 }, ...DEFAULT_ESCORT_CONFIG, chaseRange: 15, meleeRange: 1.5, attackCooldown: 1.2 },
      { x: 0.5, y: 0, z: 0 },
    )
    const world: EscortWorldSnapshot = { playerPosition: { x: 1, z: 0 }, cartPosition: CART_POS }
    escort.tick(0.016, world) // escort → chase
    escort.tick(0.016, world) // chase → attack, cooldown = 0
    // After third tick: cooldown should be reset to attackCooldown
    escort.tick(0.016, world)
    const snap = escort.getSnapshot()
    expect(snap.stateId).toBe('attack')
    expect(snap.attackCooldownRemaining).toBeGreaterThan(0)
  })

  it('returns to chase when player moves out of melee range', () => {
    const escort = createCartEscortFsm(
      { id: 'e', offset: { x: 0, z: 0 }, ...DEFAULT_ESCORT_CONFIG, chaseRange: 15, meleeRange: 1.5 },
      { x: 0.5, y: 0, z: 0 },
    )
    const world: EscortWorldSnapshot = { playerPosition: { x: 1, z: 0 }, cartPosition: CART_POS }
    escort.tick(0.016, world) // escort → chase
    escort.tick(0.016, world) // chase → attack (player 0.5 m away)
    expect(escort.getSnapshot().stateId).toBe('attack')
    // Player runs to 10 m away
    escort.tick(0.016, { playerPosition: { x: 10, z: 0 }, cartPosition: CART_POS })
    expect(escort.getSnapshot().stateId).toBe('chase')
  })
})

// ---------------------------------------------------------------------------
// Damage + death
// ---------------------------------------------------------------------------

describe('CartEscortFsm — damage and death', () => {
  it('takeDamage reduces HP', () => {
    const fsm = makeEscort()
    fsm.takeDamage(20)
    expect(fsm.getSnapshot().hp).toBe(DEFAULT_ESCORT_CONFIG.maxHp - 20)
  })

  it('HP does not go below 0', () => {
    const fsm = makeEscort()
    fsm.takeDamage(9999)
    expect(fsm.getSnapshot().hp).toBe(0)
  })

  it('transitions to die when HP reaches 0', () => {
    const fsm = makeEscort()
    fsm.takeDamage(DEFAULT_ESCORT_CONFIG.maxHp)
    fsm.tick(0.016, neutralWorld())
    expect(fsm.getSnapshot().stateId).toBe('die')
    expect(fsm.getSnapshot().isDead).toBe(true)
  })

  it('takeDamage is a no-op after death', () => {
    const fsm = makeEscort()
    fsm.takeDamage(DEFAULT_ESCORT_CONFIG.maxHp)
    fsm.tick(0.016, neutralWorld())
    fsm.takeDamage(1)
    expect(fsm.getSnapshot().hp).toBe(0)
  })

  it('sets shouldRemove after dieDelay', () => {
    const fsm = makeEscort({ dieDelay: 2 })
    fsm.takeDamage(DEFAULT_ESCORT_CONFIG.maxHp)
    for (let i = 0; i < 30; i++) fsm.tick(0.1, neutralWorld()) // 3 s > 2 s
    expect(fsm.getSnapshot().shouldRemove).toBe(true)
  })

  it('shouldRemove is false before dieDelay', () => {
    const fsm = makeEscort({ dieDelay: 5 })
    fsm.takeDamage(DEFAULT_ESCORT_CONFIG.maxHp)
    for (let i = 0; i < 10; i++) fsm.tick(0.1, neutralWorld()) // 1 s < 5 s
    expect(fsm.getSnapshot().shouldRemove).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

describe('CartEscortFsm — config', () => {
  it('exposes config readonly', () => {
    const fsm = makeEscort()
    expect(fsm.config.id).toBe('test-escort')
    expect(fsm.config.moveSpeed).toBe(DEFAULT_ESCORT_CONFIG.moveSpeed)
  })
})
