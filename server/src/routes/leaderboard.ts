import { Router, Request, Response } from 'express'
import { getDb } from '../db'

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
