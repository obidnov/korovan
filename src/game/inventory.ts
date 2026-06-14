/**
 * In-memory loot inventory with save-serialization helpers.
 *
 * Subscribable via onChange() so the HUD can react to item changes.
 * Serializes to / from the SaveV1.player.inventory slot format.
 */

import { z } from 'zod'
import { lootItemSchema } from '../save/schema'

// Re-export canonical LootItem type (defined in save schema)
export type { LootItem } from '../save/schema'
import type { LootItem } from '../save/schema'

// ---------------------------------------------------------------------------
// Placeholder loot kind IDs for caravan drops
// ---------------------------------------------------------------------------

export const LOOT_GOLD = 'gold'
export const LOOT_WOOD = 'wood'
export const LOOT_IRON_ORE = 'ironOre'

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface Inventory {
  /** Add qty to an existing slot or insert a new slot. */
  add(item: LootItem): void
  /** Remove the slot for the given id. Returns false if not found. */
  remove(id: string): boolean
  /** Snapshot of current inventory slots. */
  list(): ReadonlyArray<LootItem>
  /** Subscribe to any inventory change. Returns an unsubscribe function. */
  onChange(cb: (items: ReadonlyArray<LootItem>) => void): () => void
  /** Serialize to save-format array (SaveV1.player.inventory). */
  toSave(): LootItem[]
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createInventory(initial: LootItem[] = []): Inventory {
  const slots: LootItem[] = initial.map(({ id, qty }) => ({ id, qty }))
  const listeners = new Set<(items: ReadonlyArray<LootItem>) => void>()

  function snapshot(): ReadonlyArray<LootItem> {
    return slots.map((s) => ({ ...s }))
  }

  function notify(): void {
    const snap = snapshot()
    for (const cb of listeners) cb(snap)
  }

  function add(item: LootItem): void {
    const slot = slots.find((s) => s.id === item.id)
    if (slot) {
      slot.qty += item.qty
    } else {
      slots.push({ id: item.id, qty: item.qty })
    }
    notify()
  }

  function remove(id: string): boolean {
    const idx = slots.findIndex((s) => s.id === id)
    if (idx === -1) return false
    slots.splice(idx, 1)
    notify()
    return true
  }

  function list(): ReadonlyArray<LootItem> {
    return snapshot()
  }

  function onChange(cb: (items: ReadonlyArray<LootItem>) => void): () => void {
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  }

  function toSave(): LootItem[] {
    return slots.map((s) => ({ ...s }))
  }

  return { add, remove, list, onChange, toSave }
}

// ---------------------------------------------------------------------------
// Restore from save data (validates via save schema slice)
// ---------------------------------------------------------------------------

/** Parse and validate raw save data, then restore an Inventory instance. */
export function fromSave(raw: unknown): Inventory {
  const items = z.array(lootItemSchema).parse(raw)
  return createInventory(items)
}
