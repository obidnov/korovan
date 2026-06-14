import { describe, it, expect } from 'vitest'
import {
  createCaravanFsm,
  CARAVAN_ROUTE,
  CARAVAN_CART_SPEED,
} from '../../src/world/caravan'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function advanceTicks(fsm: ReturnType<typeof createCaravanFsm>, dt: number, ticks: number) {
  for (let i = 0; i < ticks; i++) fsm.tick(dt)
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('CaravanFsm — initial state', () => {
  it('starts at route[0] in active state', () => {
    const fsm = createCaravanFsm()
    const snap = fsm.getSnapshot()
    expect(snap.stateId).toBe('active')
    expect(snap.cartPosition.x).toBeCloseTo(CARAVAN_ROUTE[0].x)
    expect(snap.cartPosition.z).toBeCloseTo(CARAVAN_ROUTE[0].z)
    expect(snap.waypointIdx).toBe(0)
  })

  it('didRespawn is false on first tick', () => {
    const fsm = createCaravanFsm()
    fsm.tick(0.016)
    expect(fsm.getSnapshot().didRespawn).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Cart movement
// ---------------------------------------------------------------------------

describe('CaravanFsm — movement', () => {
  it('cart moves toward first waypoint', () => {
    // Cart starts exactly at route[0]; first tick advances waypointIdx to 1
    // (arrival threshold met) without moving. Second tick begins movement.
    const fsm = createCaravanFsm()
    fsm.tick(0.016) // advance waypointIdx to 1
    const before = fsm.getSnapshot()
    fsm.tick(1) // move toward route[1]
    const after = fsm.getSnapshot()
    const moved =
      Math.abs(after.cartPosition.x - before.cartPosition.x) > 0.01 ||
      Math.abs(after.cartPosition.z - before.cartPosition.z) > 0.01
    expect(moved).toBe(true)
  })

  it('cart speed does not exceed CARAVAN_CART_SPEED * dt', () => {
    const fsm = createCaravanFsm()
    const dt = 0.016
    const before = fsm.getSnapshot()
    fsm.tick(dt)
    const after = fsm.getSnapshot()
    const dx = after.cartPosition.x - before.cartPosition.x
    const dz = after.cartPosition.z - before.cartPosition.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    expect(dist).toBeLessThanOrEqual(CARAVAN_CART_SPEED * dt + 0.0001)
  })

  it('advances to next waypoint after reaching current one', () => {
    const fsm = createCaravanFsm()
    // Simulate long enough for cart to reach waypoint 0 and advance to 1
    advanceTicks(fsm, 0.1, 500)
    const snap = fsm.getSnapshot()
    expect(snap.waypointIdx).toBeGreaterThan(0)
  })

  it('loops back to waypoint 0 after reaching the last waypoint', () => {
    const fsm = createCaravanFsm()
    // Run long enough to complete a full loop (rough upper bound: 400 m route / 1.5 m/s ≈ 267 s)
    advanceTicks(fsm, 0.5, 700)
    const snap = fsm.getSnapshot()
    // waypointIdx wraps — should still be valid (0 to route length - 1)
    expect(snap.waypointIdx).toBeGreaterThanOrEqual(0)
    expect(snap.waypointIdx).toBeLessThan(CARAVAN_ROUTE.length)
  })
})

// ---------------------------------------------------------------------------
// Loot transition
// ---------------------------------------------------------------------------

describe('CaravanFsm — loot()', () => {
  it('transitions active → looted', () => {
    const fsm = createCaravanFsm()
    fsm.loot()
    expect(fsm.getSnapshot().stateId).toBe('looted')
  })

  it('cart does not move when looted', () => {
    const fsm = createCaravanFsm()
    fsm.loot()
    const before = fsm.getSnapshot()
    advanceTicks(fsm, 0.016, 60)
    const after = fsm.getSnapshot()
    expect(after.cartPosition.x).toBeCloseTo(before.cartPosition.x)
    expect(after.cartPosition.z).toBeCloseTo(before.cartPosition.z)
  })

  it('loot() is idempotent — calling twice does not restart cooldown', () => {
    const fsm = createCaravanFsm({}, 100)
    fsm.loot()
    fsm.tick(10) // consume 10 s of cooldown
    const mid = fsm.getSnapshot().respawnCooldownRemaining
    fsm.loot() // second call — should no-op
    const after = fsm.getSnapshot().respawnCooldownRemaining
    expect(after).toBeCloseTo(mid)
  })

  it('starts respawn cooldown countdown', () => {
    const COOLDOWN = 60
    const fsm = createCaravanFsm({}, COOLDOWN)
    fsm.loot()
    const before = fsm.getSnapshot().respawnCooldownRemaining
    fsm.tick(5)
    const after = fsm.getSnapshot().respawnCooldownRemaining
    expect(before).toBeCloseTo(COOLDOWN)
    expect(after).toBeCloseTo(COOLDOWN - 5)
  })
})

// ---------------------------------------------------------------------------
// Respawn
// ---------------------------------------------------------------------------

describe('CaravanFsm — respawn', () => {
  it('transitions looted → active after cooldown', () => {
    const COOLDOWN = 10
    const fsm = createCaravanFsm({}, COOLDOWN)
    fsm.loot()
    advanceTicks(fsm, 1, 11) // 11 s > 10 s cooldown
    expect(fsm.getSnapshot().stateId).toBe('active')
  })

  it('sets didRespawn=true on the respawn tick', () => {
    const COOLDOWN = 5
    const fsm = createCaravanFsm({}, COOLDOWN)
    fsm.loot()
    advanceTicks(fsm, 1, 4) // still looted
    expect(fsm.getSnapshot().stateId).toBe('looted')
    fsm.tick(2) // crosses the cooldown boundary
    expect(fsm.getSnapshot().didRespawn).toBe(true)
  })

  it('didRespawn is false on subsequent ticks after respawn', () => {
    const fsm = createCaravanFsm({}, 5)
    fsm.loot()
    advanceTicks(fsm, 1, 6)
    fsm.tick(0.016)
    expect(fsm.getSnapshot().didRespawn).toBe(false)
  })

  it('resets cart to route[0] on respawn', () => {
    const COOLDOWN = 5
    const fsm = createCaravanFsm({}, COOLDOWN)
    // Move cart: first tick advances waypointIdx, subsequent ticks move it
    advanceTicks(fsm, 0.016, 200) // move cart well past route[0]
    fsm.loot()
    // Tick through exactly the cooldown duration — respawn fires on the last tick
    // (early-return path: waypointIdx=0 set before returning, movement skipped)
    advanceTicks(fsm, 1, COOLDOWN)
    const snap = fsm.getSnapshot()
    expect(snap.stateId).toBe('active')
    expect(snap.cartPosition.x).toBeCloseTo(CARAVAN_ROUTE[0].x)
    expect(snap.cartPosition.z).toBeCloseTo(CARAVAN_ROUTE[0].z)
    expect(snap.waypointIdx).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe('CaravanFsm — toSaveState() / fromSaveState()', () => {
  it('round-trips active state', () => {
    const fsm = createCaravanFsm()
    advanceTicks(fsm, 0.1, 100)
    const saved = fsm.toSaveState()
    const restored = createCaravanFsm(saved)
    expect(restored.getSnapshot().stateId).toBe('active')
    expect(restored.getSnapshot().waypointIdx).toBe(saved.waypointIdx)
    expect(restored.getSnapshot().cartPosition.x).toBeCloseTo(saved.cartPosition.x)
  })

  it('round-trips looted state with cooldown', () => {
    const fsm = createCaravanFsm({}, 300)
    fsm.loot()
    fsm.tick(60)
    const saved = fsm.toSaveState()
    const restored = createCaravanFsm(saved, 300)
    const snap = restored.getSnapshot()
    expect(snap.stateId).toBe('looted')
    expect(snap.respawnCooldownRemaining).toBeCloseTo(saved.respawnCooldownRemaining)
  })
})
