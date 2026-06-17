/**
 * Quest manager — tracks runtime quest state and provides accept/decline/complete/track APIs.
 *
 * Usage:
 *   const manager = createQuestManager(savedQuests)
 *   manager.register(definition)          // D2 calls this to add the commander quest
 *   manager.accept('quest-id')
 *   const views = manager.getAll()        // quest panel reads this
 *   const save  = manager.toSave()        // buildSaveData() calls this
 */

import type { QuestDefinition, QuestState, QuestView } from './questTypes'

export interface QuestManager {
  /** Register a quest definition (idempotent — re-registering the same id is a no-op). */
  register(def: QuestDefinition): void
  /** Accept an available quest. No-op if not in 'available' state. */
  accept(id: string): void
  /** Decline an available quest — removes it from the visible list. */
  decline(id: string): void
  /** Mark an active quest completed. */
  complete(id: string): void
  /** Toggle the tracked marker on an active quest. */
  toggleTrack(id: string): void
  /** All quests visible in the panel (excludes declined). */
  getAll(): ReadonlyArray<QuestView>
  /** Snapshot for save payload. */
  toSave(): QuestState[]
  /** onChange callback — fired after any state mutation. */
  onChange(fn: () => void): void
}

export function createQuestManager(savedStates: QuestState[] = []): QuestManager {
  const definitions = new Map<string, QuestDefinition>()
  const states = new Map<string, QuestState>()
  const listeners: Array<() => void> = []

  // Restore from save
  for (const s of savedStates) {
    states.set(s.id, { ...s })
  }

  function notify(): void {
    for (const fn of listeners) fn()
  }

  return {
    register(def) {
      if (definitions.has(def.id)) return
      definitions.set(def.id, def)
      if (!states.has(def.id)) {
        states.set(def.id, { id: def.id, status: 'available', tracked: false })
      }
      notify()
    },

    accept(id) {
      const s = states.get(id)
      if (!s || s.status !== 'available') return
      s.status = 'active'
      notify()
    },

    decline(id) {
      const s = states.get(id)
      if (!s || s.status !== 'available') return
      states.delete(id)
      notify()
    },

    complete(id) {
      const s = states.get(id)
      if (!s || s.status !== 'active') return
      s.status = 'completed'
      s.tracked = false
      notify()
    },

    toggleTrack(id) {
      const s = states.get(id)
      if (!s || s.status !== 'active') return
      s.tracked = !s.tracked
      notify()
    },

    getAll() {
      const out: QuestView[] = []
      for (const [id, def] of definitions) {
        const s = states.get(id)
        if (!s) continue
        out.push({ ...def, status: s.status, tracked: s.tracked })
      }
      return out
    },

    toSave() {
      return [...states.values()].map((s) => ({ ...s }))
    },

    onChange(fn) {
      listeners.push(fn)
    },
  }
}
