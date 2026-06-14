import { describe, it, expect, vi } from 'vitest'
import {
  createInventory,
  fromSave,
  LOOT_GOLD,
  LOOT_WOOD,
  LOOT_IRON_ORE,
} from '../../src/game/inventory'

// ---------------------------------------------------------------------------
// add()
// ---------------------------------------------------------------------------

describe('Inventory — add()', () => {
  it('inserts a new slot when the id is absent', () => {
    const inv = createInventory()
    inv.add({ id: LOOT_GOLD, qty: 10 })
    expect(inv.list()).toEqual([{ id: LOOT_GOLD, qty: 10 }])
  })

  it('stacks qty onto an existing slot', () => {
    const inv = createInventory()
    inv.add({ id: LOOT_GOLD, qty: 10 })
    inv.add({ id: LOOT_GOLD, qty: 5 })
    const slot = inv.list().find((s) => s.id === LOOT_GOLD)
    expect(slot?.qty).toBe(15)
  })

  it('keeps separate slots for different ids', () => {
    const inv = createInventory()
    inv.add({ id: LOOT_GOLD, qty: 10 })
    inv.add({ id: LOOT_WOOD, qty: 3 })
    inv.add({ id: LOOT_IRON_ORE, qty: 1 })
    expect(inv.list()).toHaveLength(3)
  })

  it('list() returns a copy — external mutation does not affect inventory', () => {
    const inv = createInventory()
    inv.add({ id: LOOT_GOLD, qty: 10 })
    const snap = inv.list() as { id: string; qty: number }[]
    snap[0].qty = 9999
    expect(inv.list()[0].qty).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// remove()
// ---------------------------------------------------------------------------

describe('Inventory — remove()', () => {
  it('removes the slot and returns true', () => {
    const inv = createInventory()
    inv.add({ id: LOOT_GOLD, qty: 10 })
    const result = inv.remove(LOOT_GOLD)
    expect(result).toBe(true)
    expect(inv.list()).toHaveLength(0)
  })

  it('returns false when id is not present', () => {
    const inv = createInventory()
    expect(inv.remove(LOOT_GOLD)).toBe(false)
  })

  it('only removes the targeted slot, leaving others intact', () => {
    const inv = createInventory()
    inv.add({ id: LOOT_GOLD, qty: 10 })
    inv.add({ id: LOOT_WOOD, qty: 5 })
    inv.remove(LOOT_GOLD)
    expect(inv.list()).toEqual([{ id: LOOT_WOOD, qty: 5 }])
  })
})

// ---------------------------------------------------------------------------
// onChange()
// ---------------------------------------------------------------------------

describe('Inventory — onChange()', () => {
  it('fires after add()', () => {
    const inv = createInventory()
    const cb = vi.fn()
    inv.onChange(cb)
    inv.add({ id: LOOT_GOLD, qty: 1 })
    expect(cb).toHaveBeenCalledOnce()
    expect(cb).toHaveBeenCalledWith([{ id: LOOT_GOLD, qty: 1 }])
  })

  it('fires after remove()', () => {
    const inv = createInventory([{ id: LOOT_GOLD, qty: 5 }])
    const cb = vi.fn()
    inv.onChange(cb)
    inv.remove(LOOT_GOLD)
    expect(cb).toHaveBeenCalledOnce()
    expect(cb).toHaveBeenCalledWith([])
  })

  it('does not fire after remove() on missing id', () => {
    const inv = createInventory()
    const cb = vi.fn()
    inv.onChange(cb)
    inv.remove(LOOT_GOLD)
    expect(cb).not.toHaveBeenCalled()
  })

  it('unsubscribe stops further notifications', () => {
    const inv = createInventory()
    const cb = vi.fn()
    const unsub = inv.onChange(cb)
    unsub()
    inv.add({ id: LOOT_GOLD, qty: 1 })
    expect(cb).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Serialization: toSave() / fromSave()
// ---------------------------------------------------------------------------

describe('Inventory — toSave() / fromSave() round-trip', () => {
  it('toSave() returns a plain array matching SaveV1.player.inventory shape', () => {
    const inv = createInventory()
    inv.add({ id: LOOT_GOLD, qty: 50 })
    inv.add({ id: LOOT_WOOD, qty: 5 })
    inv.add({ id: LOOT_IRON_ORE, qty: 2 })
    const saved = inv.toSave()
    expect(saved).toEqual([
      { id: LOOT_GOLD, qty: 50 },
      { id: LOOT_WOOD, qty: 5 },
      { id: LOOT_IRON_ORE, qty: 2 },
    ])
  })

  it('round-trips through fromSave() preserving all slots', () => {
    const inv = createInventory()
    inv.add({ id: LOOT_GOLD, qty: 100 })
    inv.add({ id: LOOT_IRON_ORE, qty: 7 })
    const restored = fromSave(inv.toSave())
    expect(restored.list()).toEqual(inv.list())
  })

  it('fromSave() exercises the save schema validator — rejects invalid data', () => {
    expect(() => fromSave([{ id: 'gold', qty: -1 }])).toThrow()
    expect(() => fromSave([{ id: 123, qty: 1 }])).toThrow()
    expect(() => fromSave('not-an-array')).toThrow()
  })

  it('fromSave() accepts an empty array (fresh save)', () => {
    const inv = fromSave([])
    expect(inv.list()).toHaveLength(0)
  })

  it('toSave() returns a copy — mutation does not leak back into inventory', () => {
    const inv = createInventory([{ id: LOOT_GOLD, qty: 10 }])
    const saved = inv.toSave()
    saved[0].qty = 9999
    expect(inv.list()[0].qty).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// Initial slots from createInventory(initial)
// ---------------------------------------------------------------------------

describe('Inventory — initial slots', () => {
  it('accepts pre-populated initial slots', () => {
    const inv = createInventory([
      { id: LOOT_GOLD, qty: 30 },
      { id: LOOT_WOOD, qty: 10 },
    ])
    expect(inv.list()).toHaveLength(2)
    expect(inv.list().find((s) => s.id === LOOT_GOLD)?.qty).toBe(30)
  })

  it('initial slots are independent copies — external array mutation has no effect', () => {
    const initial = [{ id: LOOT_GOLD, qty: 5 }]
    const inv = createInventory(initial)
    initial[0].qty = 9999
    expect(inv.list()[0].qty).toBe(5)
  })
})
