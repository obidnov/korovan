import { Router, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { getDb } from '../db'
import { createRateLimiter, ENDPOINT_PROFILES } from '../middleware/rateLimit'

// ---------------------------------------------------------------------------
// Enums (keep in sync with game world definitions)
// ---------------------------------------------------------------------------

const VALID_ZONES = new Set(['forest', 'ruins', 'village', 'mountains', 'desert'])
const VALID_FACTIONS = new Set(['bandits', 'wolves', 'guards', 'merchants', 'undead'])

// ---------------------------------------------------------------------------
// In-memory cache  (30 s TTL, per zone+faction+limit key)
// ---------------------------------------------------------------------------

interface CacheEntry {
  payload: LeaderboardResponse
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

// Exported so tests can inject a fake clock / inspect hit counts.
export let _queryCount = 0
export function _resetQueryCount(): void {
  _queryCount = 0
}
export function _clearCache(): void {
  cache.clear()
}

const CACHE_TTL_MS = 30_000

// ---------------------------------------------------------------------------
// DB types
// ---------------------------------------------------------------------------

interface LeaderboardRow {
  player_id: string
  nickname_snapshot: string | null
  score: number
  submitted_at: number
}

interface LeaderboardEntry {
  rank: number
  nickname: string
  score: number
  submitted_at: number
}

interface LeaderboardResponse {
  zone: string
  faction: string
  entries: LeaderboardEntry[]
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const leaderboardRouter = Router()

leaderboardRouter.get('/', (req: Request, res: Response): void => {
  const { zone, faction } = req.query
  const rawLimit = req.query.limit

  // --- validate zone ---
  if (typeof zone !== 'string' || !VALID_ZONES.has(zone)) {
    res.status(400).json({ error: 'invalid_zone', validZones: [...VALID_ZONES] })
    return
  }

  // --- validate faction ---
  if (typeof faction !== 'string' || !VALID_FACTIONS.has(faction)) {
    res.status(400).json({ error: 'invalid_faction', validFactions: [...VALID_FACTIONS] })
    return
  }

  // --- validate limit ---
  let limit = 20
  if (rawLimit !== undefined) {
    const parsed = Number(rawLimit)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      res.status(400).json({ error: 'invalid_limit', message: 'limit must be 1–100' })
      return
    }
    limit = parsed
  }

  const cacheKey = `${zone}:${faction}:${limit}`
  const now = Date.now()

  // --- cache hit? ---
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    res.json(cached.payload)
    return
  }

  // --- DB query ---
  _queryCount++
  const rows = getDb()
    .prepare<[string, string, number]>(
      `SELECT player_id, nickname_snapshot, score, submitted_at
         FROM leaderboard_entries
        WHERE zone = ? AND faction = ?
        ORDER BY score DESC
        LIMIT ?`,
    )
    .all(zone, faction, limit) as LeaderboardRow[]

  const entries: LeaderboardEntry[] = rows.map((row, i) => ({
    rank: i + 1,
    nickname:
      row.nickname_snapshot ?? `Anonymous #${row.player_id.slice(0, 6)}`,
    score: row.score,
    submitted_at: row.submitted_at,
  }))

  const payload: LeaderboardResponse = { zone, faction, entries }

  // --- store in cache ---
  cache.set(cacheKey, { payload, expiresAt: now + CACHE_TTL_MS })

  res.json(payload)
})

// ---------------------------------------------------------------------------
// POST /api/leaderboard — submit run result (BOO-478)
// ---------------------------------------------------------------------------

const MAX_SCORE = 1_000_000_000 // 1e9 per spec §P1 cap
const MAX_METADATA_BYTES = 4096

interface ExistingEntryRow {
  entry_id: string
  score: number
}

interface RankRow {
  rank: number
}

// Per-identity + per-IP rate limiter using canonical BOO-482 middleware.
const postLimiter = createRateLimiter(ENDPOINT_PROFILES['POST /api/leaderboard'])

leaderboardRouter.post('/', postLimiter, (req: Request, res: Response): void => {
  if (!req.player) {
    res.status(401).json({ error: 'authentication_required' })
    return
  }

  const body = req.body as {
    zone?: unknown
    faction?: unknown
    score?: unknown
    run_metadata?: unknown
  }
  const { zone, faction, score, run_metadata } = body

  if (typeof zone !== 'string' || !VALID_ZONES.has(zone)) {
    res.status(400).json({ error: 'invalid_zone', validZones: [...VALID_ZONES] })
    return
  }

  if (typeof faction !== 'string' || !VALID_FACTIONS.has(faction)) {
    res.status(400).json({ error: 'invalid_faction', validFactions: [...VALID_FACTIONS] })
    return
  }

  if (
    typeof score !== 'number' ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > MAX_SCORE
  ) {
    res.status(400).json({
      error: 'invalid_score',
      detail: `score must be an integer in [0, ${MAX_SCORE}]`,
    })
    return
  }

  let metaJson: string | null = null
  if (run_metadata !== undefined) {
    metaJson = JSON.stringify(run_metadata)
    if (Buffer.byteLength(metaJson, 'utf8') > MAX_METADATA_BYTES) {
      res.status(400).json({ error: 'run_metadata_too_large', max_bytes: MAX_METADATA_BYTES })
      return
    }
  }

  const now = Date.now()
  const { id: playerId, nickname } = req.player

  const existing = getDb()
    .prepare(
      `SELECT entry_id, score FROM leaderboard_entries
       WHERE player_id = ? AND zone = ? AND faction = ?`,
    )
    .get(playerId, zone, faction) as ExistingEntryRow | undefined

  if (existing && score <= existing.score) {
    const rankRow = getDb()
      .prepare(
        `SELECT COUNT(*) + 1 AS rank FROM leaderboard_entries
         WHERE zone = ? AND faction = ? AND score > ?`,
      )
      .get(zone, faction, existing.score) as RankRow
    res.status(409).json({ kept: 'existing', rank: rankRow.rank })
    return
  }

  let entryId: string
  if (existing) {
    entryId = existing.entry_id
    getDb()
      .prepare(
        `UPDATE leaderboard_entries
         SET score = ?, nickname_snapshot = ?, submitted_at = ?, run_metadata = ?
         WHERE entry_id = ?`,
      )
      .run(score, nickname ?? null, now, metaJson, entryId)
  } else {
    entryId = randomUUID()
    getDb()
      .prepare(
        `INSERT INTO leaderboard_entries
           (entry_id, player_id, zone, faction, score, nickname_snapshot, submitted_at, run_metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(entryId, playerId, zone, faction, score, nickname ?? null, now, metaJson)
  }

  const rankRow = getDb()
    .prepare(
      `SELECT COUNT(*) + 1 AS rank FROM leaderboard_entries
       WHERE zone = ? AND faction = ? AND score > ?`,
    )
    .get(zone, faction, score) as RankRow

  res.status(201).json({ entry_id: entryId, rank: rankRow.rank })
})
