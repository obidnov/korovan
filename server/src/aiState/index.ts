import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

// Opaque JSON blobs stored per player×faction session.
// EP-3 owns the concrete shapes; AIStateStore treats them as opaque records.
export type AgentSessionState = Record<string, unknown>
export type AgentCommand = Record<string, unknown>

const MAX_STATE_BYTES = 16 * 1024 // 16 KB

export class AIStateTooLargeError extends Error {
  readonly byteLength: number
  constructor(byteLength: number) {
    super(`AI state too large: ${byteLength} bytes (max ${MAX_STATE_BYTES})`)
    this.name = 'AIStateTooLargeError'
    this.byteLength = byteLength
  }
}

export interface AIStateStore {
  load(playerId: string, faction: string): Promise<AgentSessionState | null>
  upsert(
    playerId: string,
    faction: string,
    next: { state: AgentSessionState; lastCommand: AgentCommand },
  ): Promise<{ decisionCount: number }>
  recentDecisions(playerId: string, faction: string, sinceMs: number): Promise<number>
}

interface SessionRow {
  state: string
  decision_count: number
  last_decision_at: number | null
}

export function createAIStateStore(db: Database.Database): AIStateStore {
  // Prepare statements once — reused across calls for perf + type safety.
  const stmtLoad = db.prepare<[string, string], SessionRow>(
    'SELECT state, decision_count, last_decision_at FROM ai_sessions WHERE player_id = ? AND faction = ?',
  )

  const stmtUpsert = db.prepare<
    [string, string, string, string, string, number],
    { decision_count: number }
  >(`
    INSERT INTO ai_sessions
      (session_id, player_id, faction, state, last_command, last_decision_at, decision_count)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(player_id, faction) DO UPDATE SET
      state            = excluded.state,
      last_command     = excluded.last_command,
      last_decision_at = excluded.last_decision_at,
      decision_count   = decision_count + 1
    RETURNING decision_count
  `)

  const stmtRecentDecisions = db.prepare<[string, string, number], { decision_count: number }>(
    'SELECT decision_count FROM ai_sessions WHERE player_id = ? AND faction = ? AND last_decision_at > ?',
  )

  return {
    async load(playerId, faction) {
      const row = stmtLoad.get(playerId, faction)
      if (!row) return null
      return JSON.parse(row.state) as AgentSessionState
    },

    async upsert(playerId, faction, next) {
      const stateJson = JSON.stringify(next.state)
      const byteLength = Buffer.byteLength(stateJson, 'utf8')
      if (byteLength > MAX_STATE_BYTES) {
        throw new AIStateTooLargeError(byteLength)
      }
      const lastCommandJson = JSON.stringify(next.lastCommand)
      const now = Date.now()

      const result = stmtUpsert.get(
        randomUUID(),
        playerId,
        faction,
        stateJson,
        lastCommandJson,
        now,
      )!
      return { decisionCount: result.decision_count }
    },

    async recentDecisions(playerId, faction, sinceMs) {
      const since = Date.now() - sinceMs
      const row = stmtRecentDecisions.get(playerId, faction, since)
      return row?.decision_count ?? 0
    },
  }
}
