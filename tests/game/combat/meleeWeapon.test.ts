import { describe, it, expect } from 'vitest'
import { createMeleeWeaponFsm, SWING_TIMING } from '../../../src/game/combat/meleeWeapon'

const { windup, active, recovery } = SWING_TIMING

describe('createMeleeWeaponFsm', () => {
  it('starts in idle state', () => {
    const fsm = createMeleeWeaponFsm()
    expect(fsm.state).toBe('idle')
  })

  it('does not transition without attack input', () => {
    const fsm = createMeleeWeaponFsm()
    fsm.tick(1.0, false)
    expect(fsm.state).toBe('idle')
  })

  it('enters windup on attack press from idle', () => {
    const fsm = createMeleeWeaponFsm()
    const hit = fsm.tick(0.01, true)
    expect(fsm.state).toBe('windup')
    expect(hit).toBe(false) // hit fires on active entry, not windup
  })

  it('transitions idle → windup → active after windup duration', () => {
    const fsm = createMeleeWeaponFsm()
    fsm.tick(0.01, true) // enter windup

    let hitFired = false
    // Advance just past windup threshold
    const hit = fsm.tick(windup + 0.001, false)
    if (hit) hitFired = true

    expect(fsm.state).toBe('active')
    expect(hitFired).toBe(true)
  })

  it('returns true (hitThisFrame) exactly once on active entry', () => {
    const fsm = createMeleeWeaponFsm()
    fsm.tick(0.01, true) // windup

    const results: boolean[] = []
    results.push(fsm.tick(windup + 0.001, false)) // → active, should be true
    results.push(fsm.tick(0.01, false))            // still active, should be false
    results.push(fsm.tick(0.01, false))

    expect(results[0]).toBe(true)
    expect(results[1]).toBe(false)
    expect(results[2]).toBe(false)
  })

  it('transitions active → recovery after active duration', () => {
    const fsm = createMeleeWeaponFsm()
    fsm.tick(0.01, true)             // windup
    fsm.tick(windup + 0.001, false)  // → active
    fsm.tick(active + 0.001, false)  // → recovery

    expect(fsm.state).toBe('recovery')
  })

  it('returns to idle after full swing cycle', () => {
    const fsm = createMeleeWeaponFsm()
    fsm.tick(0.01, true)             // windup
    fsm.tick(windup + 0.001, false)  // → active
    fsm.tick(active + 0.001, false)  // → recovery
    fsm.tick(recovery + 0.001, false) // → idle

    expect(fsm.state).toBe('idle')
  })

  it('can start a new swing after completing recovery', () => {
    const fsm = createMeleeWeaponFsm()
    // First swing
    fsm.tick(0.01, true)
    fsm.tick(windup + 0.001, false)
    fsm.tick(active + 0.001, false)
    fsm.tick(recovery + 0.001, false)
    expect(fsm.state).toBe('idle')

    // Second swing
    fsm.tick(0.01, true)
    expect(fsm.state).toBe('windup')
  })

  it('does not reset during windup/active/recovery even when attackPressed', () => {
    const fsm = createMeleeWeaponFsm()
    fsm.tick(0.01, true)              // → windup
    const hit1 = fsm.tick(windup + 0.001, true)  // → active (hitFired=true)
    expect(fsm.state).toBe('active')
    expect(hit1).toBe(true)
    // Still in active — attack held but no new hit fires
    const hit2 = fsm.tick(0.05, true)
    expect(hit2).toBe(false)
  })

  it('immediately starts new swing if attackPressed when returning to idle', () => {
    const fsm = createMeleeWeaponFsm()
    fsm.tick(0.01, true)
    fsm.tick(windup + 0.001, false)
    fsm.tick(active + 0.001, false)
    // Finish recovery with attack held → should enter windup
    fsm.tick(recovery + 0.001, true)
    expect(fsm.state).toBe('windup')
  })
})
