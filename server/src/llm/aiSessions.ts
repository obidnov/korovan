import { randomUUID } from 'crypto'
import type { AgentCommand, AgentSessionState, FactionId } from './types'

// In-memory session store keyed on "playerId:factionId".
// EP-2 DB integration (BOO-473/BOO-469) will replace this with SQLite.
const _store = new Map<string, AgentSessionState>()

function sessionKey(playerId: string, faction: FactionId): string {
  return `${playerId}:${faction}`
}

export function getOrCreateSession(playerId: string, faction: FactionId): AgentSessionState {
  const key = sessionKey(playerId, faction)
  const existing = _store.get(key)
  if (existing) return existing

  const fresh: AgentSessionState = {
    sessionId: randomUUID(),
    factionId: faction,
    ticksSinceStart: 0,
    decisionCount: 0,
    lastCommand: null,
    providerContext: null,
  }
  _store.set(key, fresh)
  return fresh
}

export function persistSession(
  playerId: string,
  faction: FactionId,
  updated: AgentSessionState,
  lastCommand: AgentCommand,
): void {
  const key = sessionKey(playerId, faction)
  _store.set(key, {
    ...updated,
    ticksSinceStart: updated.ticksSinceStart + 1,
    decisionCount: updated.decisionCount + 1,
    lastCommand,
  })
}

/** Test helper — clears all sessions between test cases. */
export function _resetSessions(): void {
  _store.clear()
}
