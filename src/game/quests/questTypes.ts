/**
 * Quest system type definitions.
 * D2 (commander quest) plugs in by providing QuestDefinition entries to the registry.
 */

export type QuestStatus = 'available' | 'active' | 'completed' | 'failed'

/** Pass-through reward structure; faction-rep is a P3+ stub. */
export interface QuestReward {
  currency?: number
  items?: Array<{ id: string; qty: number }>
  factionRep?: Record<string, number>
}

/** Static, immutable definition registered at startup. */
export interface QuestDefinition {
  id: string
  title: string
  description: string
  reward: QuestReward
}

/** Runtime state for one quest instance — persisted in save payload. */
export interface QuestState {
  id: string
  status: QuestStatus
  tracked: boolean
}

/** Full runtime view used by the quest panel. */
export interface QuestView extends QuestDefinition {
  status: QuestStatus
  tracked: boolean
}
