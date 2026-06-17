/**
 * Dev fixture: single 'walk to anchor' quest used by acceptance tests and dev builds.
 * D2 will register the real commander quest; this fixture confirms the full flow in isolation.
 */

import type { QuestDefinition } from './questTypes'

export const WALK_TO_ANCHOR_QUEST: QuestDefinition = {
  id: 'walk-to-anchor',
  title: 'Walk to the Anchor',
  description: 'Find the old anchor stone near the eastern shore and report your position.',
  reward: {
    currency: 25,
    items: [{ id: 'ironOre', qty: 1 }],
  },
}
