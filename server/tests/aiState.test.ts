import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  createAIStateStore,
  AIStateTooLargeError,
  type AgentSessionState,
  type AgentCommand,
} from '../src/aiState/index'

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Bootstrap the schema exactly as the migration runner would do it.
  // We need a minimal players table for FK constraint, plus ai_sessions.
  db.exec(`
    CREATE TABLE players (
      player_id      TEXT    PRIMARY KEY NOT NULL,
      nickname       TEXT,
      created_at     INTEGER NOT NULL,
      last_seen_at   INTEGER NOT NULL,
      cookie_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE ai_sessions (
      session_id       TEXT    PRIMARY KEY NOT NULL,
      player_id        TEXT    NOT NULL,
      faction          TEXT    NOT NULL,
      state            TEXT    NOT NULL,
      last_command     TEXT,
      last_decision_at INTEGER,
      decision_count   INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (player_id) REFERENCES players (player_id) ON DELETE CASCADE,
      UNIQUE (player_id, faction)
    );
  `)
  return db
}

function seedPlayer(db: Database.Database, playerId: string): void {
  db.prepare(
    `INSERT INTO players (player_id, created_at, last_seen_at) VALUES (?, ?, ?)`,
  ).run(playerId, Date.now(), Date.now())
}

const PLAYER_A = 'player-a'
const PLAYER_B = 'player-b'
const FACTION_ELVES = 'elves'
const FACTION_GUARDS = 'palace_guard'

const STATE_V1: AgentSessionState = { phase: 'patrol', turn: 1 }
const STATE_V2: AgentSessionState = { phase: 'raid', turn: 2 }
const CMD_1: AgentCommand = { type: 'patrol', targetZone: 'elf-forest', units: ['u1'] }

describe('AIStateStore', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    seedPlayer(db, PLAYER_A)
    seedPlayer(db, PLAYER_B)
  })

  describe('load', () => {
    it('returns null for unknown player+faction', async () => {
      const store = createAIStateStore(db)
      const result = await store.load(PLAYER_A, FACTION_ELVES)
      expect(result).toBeNull()
    })

    it('returns parsed state after upsert', async () => {
      const store = createAIStateStore(db)
      await store.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V1, lastCommand: CMD_1 })
      const loaded = await store.load(PLAYER_A, FACTION_ELVES)
      expect(loaded).toEqual(STATE_V1)
    })

    it('returns null for a different faction of the same player', async () => {
      const store = createAIStateStore(db)
      await store.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V1, lastCommand: CMD_1 })
      const loaded = await store.load(PLAYER_A, FACTION_GUARDS)
      expect(loaded).toBeNull()
    })
  })

  describe('upsert — create', () => {
    it('creates a row on first call and returns decisionCount 1', async () => {
      const store = createAIStateStore(db)
      const { decisionCount } = await store.upsert(PLAYER_A, FACTION_ELVES, {
        state: STATE_V1,
        lastCommand: CMD_1,
      })
      expect(decisionCount).toBe(1)
    })

    it('persists state that survives a new store instance (same db)', async () => {
      const store1 = createAIStateStore(db)
      await store1.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V1, lastCommand: CMD_1 })

      const store2 = createAIStateStore(db)
      const loaded = await store2.load(PLAYER_A, FACTION_ELVES)
      expect(loaded).toEqual(STATE_V1)
    })
  })

  describe('upsert — update', () => {
    it('overwrites state on subsequent call', async () => {
      const store = createAIStateStore(db)
      await store.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V1, lastCommand: CMD_1 })
      await store.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V2, lastCommand: CMD_1 })
      const loaded = await store.load(PLAYER_A, FACTION_ELVES)
      expect(loaded).toEqual(STATE_V2)
    })

    it('increments decisionCount monotonically', async () => {
      const store = createAIStateStore(db)
      const r1 = await store.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V1, lastCommand: CMD_1 })
      const r2 = await store.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V2, lastCommand: CMD_1 })
      const r3 = await store.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V1, lastCommand: CMD_1 })
      expect(r1.decisionCount).toBe(1)
      expect(r2.decisionCount).toBe(2)
      expect(r3.decisionCount).toBe(3)
    })
  })

  describe('two factions for same player — independent rows', () => {
    it('upserts independently per faction', async () => {
      const store = createAIStateStore(db)
      await store.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V1, lastCommand: CMD_1 })
      await store.upsert(PLAYER_A, FACTION_GUARDS, { state: STATE_V2, lastCommand: CMD_1 })

      expect(await store.load(PLAYER_A, FACTION_ELVES)).toEqual(STATE_V1)
      expect(await store.load(PLAYER_A, FACTION_GUARDS)).toEqual(STATE_V2)
    })

    it('decisionCount increments separately per faction', async () => {
      const store = createAIStateStore(db)
      await store.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V1, lastCommand: CMD_1 })
      await store.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V2, lastCommand: CMD_1 })
      const { decisionCount: elvesCount } = await store.upsert(PLAYER_A, FACTION_ELVES, {
        state: STATE_V1,
        lastCommand: CMD_1,
      })
      const { decisionCount: guardsCount } = await store.upsert(PLAYER_A, FACTION_GUARDS, {
        state: STATE_V1,
        lastCommand: CMD_1,
      })
      expect(elvesCount).toBe(3)
      expect(guardsCount).toBe(1)
    })
  })

  describe('size cap (AIStateTooLargeError)', () => {
    it('throws AIStateTooLargeError for state > 16 KB', async () => {
      const store = createAIStateStore(db)
      // 20 KB string value (>16384 bytes when JSON-stringified)
      const bigState: AgentSessionState = { payload: 'x'.repeat(20 * 1024) }
      await expect(
        store.upsert(PLAYER_A, FACTION_ELVES, { state: bigState, lastCommand: CMD_1 }),
      ).rejects.toThrow(AIStateTooLargeError)
    })

    it('leaves the row unchanged when size cap is exceeded', async () => {
      const store = createAIStateStore(db)
      await store.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V1, lastCommand: CMD_1 })

      const bigState: AgentSessionState = { payload: 'x'.repeat(20 * 1024) }
      await expect(
        store.upsert(PLAYER_A, FACTION_ELVES, { state: bigState, lastCommand: CMD_1 }),
      ).rejects.toThrow(AIStateTooLargeError)

      // Row must still hold the original state
      const loaded = await store.load(PLAYER_A, FACTION_ELVES)
      expect(loaded).toEqual(STATE_V1)
    })

    it('error includes the actual byte length', async () => {
      const store = createAIStateStore(db)
      const bigState: AgentSessionState = { payload: 'x'.repeat(20 * 1024) }
      let caught: unknown
      try {
        await store.upsert(PLAYER_A, FACTION_ELVES, { state: bigState, lastCommand: CMD_1 })
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(AIStateTooLargeError)
      expect((caught as AIStateTooLargeError).byteLength).toBeGreaterThan(16 * 1024)
    })
  })

  describe('recentDecisions', () => {
    it('returns 0 when no session exists', async () => {
      const store = createAIStateStore(db)
      const count = await store.recentDecisions(PLAYER_A, FACTION_ELVES, 60_000)
      expect(count).toBe(0)
    })

    it('returns decision_count when last_decision_at is within the window', async () => {
      const store = createAIStateStore(db)
      await store.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V1, lastCommand: CMD_1 })
      await store.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V2, lastCommand: CMD_1 })
      // Both decisions happened just now, so a 1-minute window should include them
      const count = await store.recentDecisions(PLAYER_A, FACTION_ELVES, 60_000)
      expect(count).toBe(2)
    })

    it('returns 0 when last_decision_at is outside the window', async () => {
      const store = createAIStateStore(db)
      await store.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V1, lastCommand: CMD_1 })
      // Use a 0 ms window — last_decision_at === now(), not strictly greater
      const count = await store.recentDecisions(PLAYER_A, FACTION_ELVES, 0)
      expect(count).toBe(0)
    })

    it('is scoped per player×faction', async () => {
      const store = createAIStateStore(db)
      await store.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V1, lastCommand: CMD_1 })
      await store.upsert(PLAYER_A, FACTION_ELVES, { state: STATE_V2, lastCommand: CMD_1 })
      const elvesCount = await store.recentDecisions(PLAYER_A, FACTION_ELVES, 60_000)
      const guardsCount = await store.recentDecisions(PLAYER_A, FACTION_GUARDS, 60_000)
      expect(elvesCount).toBe(2)
      expect(guardsCount).toBe(0)
    })
  })
})
