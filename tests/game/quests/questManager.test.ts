import { describe, it, expect, vi } from 'vitest'
import { createQuestManager } from '../../../src/game/quests/questManager'
import { WALK_TO_ANCHOR_QUEST } from '../../../src/game/quests/questFixtures'

const DEF = WALK_TO_ANCHOR_QUEST

// ---------------------------------------------------------------------------
// register + initial state
// ---------------------------------------------------------------------------

describe('QuestManager — register()', () => {
  it('makes quest available after registration', () => {
    const mgr = createQuestManager()
    mgr.register(DEF)
    const views = mgr.getAll()
    expect(views).toHaveLength(1)
    expect(views[0].status).toBe('available')
    expect(views[0].tracked).toBe(false)
  })

  it('is idempotent — re-registering same id is a no-op', () => {
    const mgr = createQuestManager()
    mgr.register(DEF)
    mgr.register(DEF)
    expect(mgr.getAll()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// available → active → completed flow
// ---------------------------------------------------------------------------

describe('QuestManager — accept / complete flow', () => {
  it('accept() transitions available → active', () => {
    const mgr = createQuestManager()
    mgr.register(DEF)
    mgr.accept(DEF.id)
    expect(mgr.getAll()[0].status).toBe('active')
  })

  it('complete() transitions active → completed and clears track', () => {
    const mgr = createQuestManager()
    mgr.register(DEF)
    mgr.accept(DEF.id)
    mgr.toggleTrack(DEF.id)
    mgr.complete(DEF.id)
    const view = mgr.getAll()[0]
    expect(view.status).toBe('completed')
    expect(view.tracked).toBe(false)
  })

  it('accept() is a no-op when already active', () => {
    const mgr = createQuestManager()
    mgr.register(DEF)
    mgr.accept(DEF.id)
    mgr.accept(DEF.id) // second call
    expect(mgr.getAll()[0].status).toBe('active')
  })

  it('complete() is a no-op when not active', () => {
    const mgr = createQuestManager()
    mgr.register(DEF)
    mgr.complete(DEF.id) // still available
    expect(mgr.getAll()[0].status).toBe('available')
  })
})

// ---------------------------------------------------------------------------
// decline
// ---------------------------------------------------------------------------

describe('QuestManager — decline()', () => {
  it('removes the quest from visible list', () => {
    const mgr = createQuestManager()
    mgr.register(DEF)
    mgr.decline(DEF.id)
    expect(mgr.getAll()).toHaveLength(0)
  })

  it('decline is a no-op when quest is active', () => {
    const mgr = createQuestManager()
    mgr.register(DEF)
    mgr.accept(DEF.id)
    mgr.decline(DEF.id) // can't decline active quest
    expect(mgr.getAll()[0].status).toBe('active')
  })
})

// ---------------------------------------------------------------------------
// track toggle
// ---------------------------------------------------------------------------

describe('QuestManager — toggleTrack()', () => {
  it('toggles tracked flag on active quest', () => {
    const mgr = createQuestManager()
    mgr.register(DEF)
    mgr.accept(DEF.id)
    mgr.toggleTrack(DEF.id)
    expect(mgr.getAll()[0].tracked).toBe(true)
    mgr.toggleTrack(DEF.id)
    expect(mgr.getAll()[0].tracked).toBe(false)
  })

  it('toggleTrack is a no-op when quest is available', () => {
    const mgr = createQuestManager()
    mgr.register(DEF)
    mgr.toggleTrack(DEF.id)
    expect(mgr.getAll()[0].tracked).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// onChange
// ---------------------------------------------------------------------------

describe('QuestManager — onChange()', () => {
  it('fires on accept', () => {
    const mgr = createQuestManager()
    mgr.register(DEF)
    const cb = vi.fn()
    mgr.onChange(cb)
    mgr.accept(DEF.id)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('fires on register', () => {
    const mgr = createQuestManager()
    const cb = vi.fn()
    mgr.onChange(cb)
    mgr.register(DEF)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// save round-trip
// ---------------------------------------------------------------------------

describe('QuestManager — save round-trip', () => {
  it('toSave() captures current status', () => {
    const mgr = createQuestManager()
    mgr.register(DEF)
    mgr.accept(DEF.id)
    const saved = mgr.toSave()
    expect(saved).toEqual([{ id: DEF.id, status: 'active', tracked: false }])
  })

  it('restores state from savedStates', () => {
    const mgr = createQuestManager([{ id: DEF.id, status: 'active', tracked: true }])
    mgr.register(DEF)
    const view = mgr.getAll()[0]
    expect(view.status).toBe('active')
    expect(view.tracked).toBe(true)
  })

  it('available → active → save → reload → still active', () => {
    const mgr1 = createQuestManager()
    mgr1.register(DEF)
    mgr1.accept(DEF.id)
    const snapshot = mgr1.toSave()

    const mgr2 = createQuestManager(snapshot)
    mgr2.register(DEF)
    expect(mgr2.getAll()[0].status).toBe('active')
  })
})

// ---------------------------------------------------------------------------
// save schema validation (quest state embedded in SaveV1)
// ---------------------------------------------------------------------------

describe('Save schema — quests field', () => {
  it('validates quest state via questStateSchema', async () => {
    const { questStateSchema } = await import('../../../src/save/schema')
    expect(() =>
      questStateSchema.parse({ id: 'test', status: 'active', tracked: false }),
    ).not.toThrow()
    expect(() =>
      questStateSchema.parse({ id: 'test', status: 'invalid', tracked: false }),
    ).toThrow()
  })

  it('SaveV1 parses without quests field (backward compat)', async () => {
    const { validateSaveV1 } = await import('../../../src/save/schema')
    const legacy = {
      version: 1,
      player: { hp: 100, position: [0, 0, 0] as [number, number, number], inventory: [] },
      world: { caravanState: null },
    }
    expect(() => validateSaveV1(legacy)).not.toThrow()
  })

  it('SaveV1 parses with quests field', async () => {
    const { validateSaveV1 } = await import('../../../src/save/schema')
    const save = {
      version: 1,
      player: { hp: 100, position: [0, 0, 0] as [number, number, number], inventory: [] },
      world: { caravanState: null },
      quests: [{ id: 'walk-to-anchor', status: 'active', tracked: false }],
    }
    const result = validateSaveV1(save)
    expect(result.quests).toHaveLength(1)
    expect(result.quests![0].status).toBe('active')
  })
})
