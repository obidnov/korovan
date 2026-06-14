import { describe, it, expect, vi } from 'vitest'
import { createHpComponent } from '../../../src/game/combat/hp'

describe('createHpComponent', () => {
  it('throws on non-positive maxHp', () => {
    expect(() => createHpComponent(0)).toThrow()
    expect(() => createHpComponent(-10)).toThrow()
  })

  it('starts at maxHp with isDead=false', () => {
    const hp = createHpComponent(100)
    expect(hp.hp).toBe(100)
    expect(hp.maxHp).toBe(100)
    expect(hp.isDead).toBe(false)
  })

  describe('takeDamage', () => {
    it('reduces HP by the given amount', () => {
      const hp = createHpComponent(100)
      hp.takeDamage(25)
      expect(hp.hp).toBe(75)
    })

    it('floors HP at 0, not below', () => {
      const hp = createHpComponent(100)
      hp.takeDamage(9999)
      expect(hp.hp).toBe(0)
    })

    it('is a no-op when already dead', () => {
      const hp = createHpComponent(100)
      hp.takeDamage(100)
      expect(hp.isDead).toBe(true)
      hp.takeDamage(50)
      expect(hp.hp).toBe(0) // no change
    })

    it('fires onDeath callback exactly once when HP reaches 0', () => {
      const hp = createHpComponent(100)
      const cb = vi.fn()
      hp.onDeath(cb)
      hp.takeDamage(99)
      expect(cb).not.toHaveBeenCalled()
      hp.takeDamage(1)
      expect(cb).toHaveBeenCalledTimes(1)
      // second damage after death: no re-fire
      hp.takeDamage(10)
      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('fires multiple onDeath callbacks in registration order', () => {
      const hp = createHpComponent(50)
      const order: string[] = []
      hp.onDeath(() => order.push('a'))
      hp.onDeath(() => order.push('b'))
      hp.takeDamage(50)
      expect(order).toEqual(['a', 'b'])
    })

    it('fires death callback on overkill (damage > remaining HP)', () => {
      const hp = createHpComponent(50)
      const cb = vi.fn()
      hp.onDeath(cb)
      hp.takeDamage(200) // overkill
      expect(hp.hp).toBe(0)
      expect(cb).toHaveBeenCalledTimes(1)
    })
  })

  describe('heal', () => {
    it('increases HP by the given amount', () => {
      const hp = createHpComponent(100)
      hp.takeDamage(40)
      hp.heal(15)
      expect(hp.hp).toBe(75)
    })

    it('caps HP at maxHp', () => {
      const hp = createHpComponent(100)
      hp.takeDamage(10)
      hp.heal(9999)
      expect(hp.hp).toBe(100)
    })
  })

  describe('reset', () => {
    it('restores HP to maxHp', () => {
      const hp = createHpComponent(100)
      hp.takeDamage(75)
      hp.reset()
      expect(hp.hp).toBe(100)
      expect(hp.isDead).toBe(false)
    })

    it('allows death callback to fire again after reset + re-damage', () => {
      const hp = createHpComponent(100)
      const cb = vi.fn()
      hp.onDeath(cb)
      hp.takeDamage(100) // first death
      expect(cb).toHaveBeenCalledTimes(1)
      hp.reset()
      hp.takeDamage(100) // second death
      expect(cb).toHaveBeenCalledTimes(2)
    })
  })

  describe('isDead getter', () => {
    it('is false at full HP', () => {
      expect(createHpComponent(1).isDead).toBe(false)
    })

    it('is true at zero HP', () => {
      const hp = createHpComponent(10)
      hp.takeDamage(10)
      expect(hp.isDead).toBe(true)
    })
  })
})
