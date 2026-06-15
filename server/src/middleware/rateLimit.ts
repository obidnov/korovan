import type { Request, RequestHandler, Response } from 'express'

// Augment Express Request to pick up playerId set by identity middleware (P0-6).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      playerId?: string
    }
  }
}

export interface RateLimitProfile {
  identityPerMin: number
  ipPerMin: number
}

// Default profiles per endpoint (BD-picked P1 numbers per BC-4 brief).
export const ENDPOINT_PROFILES: Record<string, RateLimitProfile> = {
  'POST /api/llm/decide': { identityPerMin: 60, ipPerMin: 600 },
  'POST /api/saves': { identityPerMin: 30, ipPerMin: 300 },
  'POST /api/leaderboard': { identityPerMin: 6, ipPerMin: 60 },
  'POST /api/identity/bootstrap': { identityPerMin: 10, ipPerMin: 30 },
}

// --- Fixed-window counter ---
// Key: `${identity|ip}:${path}`, value: { count, windowStart }
// Resets on process restart (acceptable for MVP; multi-instance store in P2).

interface WindowEntry {
  count: number
  windowStart: number // unix ms rounded to start of 60-s window
}

const _store = new Map<string, WindowEntry>()

const WINDOW_MS = 60_000

function _windowStart(nowMs: number): number {
  return Math.floor(nowMs / WINDOW_MS) * WINDOW_MS
}

/**
 * Check and increment the counter for a key.
 * Returns true if the request is within the limit, false if rate-limited.
 */
export function checkAndIncrement(key: string, limit: number, nowMs = Date.now()): boolean {
  const ws = _windowStart(nowMs)
  const entry = _store.get(key)

  if (!entry || entry.windowStart !== ws) {
    _store.set(key, { count: 1, windowStart: ws })
    return true
  }
  if (entry.count >= limit) {
    return false
  }
  entry.count++
  return true
}

/** Seconds until the current 60-s window resets. */
export function retryAfterSeconds(nowMs = Date.now()): number {
  const ws = _windowStart(nowMs)
  return Math.ceil((ws + WINDOW_MS - nowMs) / 1000)
}

/** Reset all counters (test helper). */
export function _resetStore(): void {
  _store.clear()
}

/**
 * Creates an Express middleware that enforces per-identity and per-IP rate limits
 * for the given profile. Mount this directly on the route handler.
 *
 * Identity is read from `req.playerId` (set by identity middleware).
 * IP is read from `req.ip` (trust proxy must be configured on the app).
 */
export function createRateLimiter(profile: RateLimitProfile): RequestHandler {
  return (req: Request, res: Response, next): void => {
    // req.path inside a sub-router is always "/" — use originalUrl (stripped of query
    // string) so counters stay isolated when the same limiter is wired to multiple mounts.
    const path = `${req.method} ${req.originalUrl.split('?')[0]}`
    const now = Date.now()

    // Per-IP check (always applies)
    const ip = req.ip ?? 'unknown'
    const ipKey = `ip:${ip}:${path}`
    if (!checkAndIncrement(ipKey, profile.ipPerMin, now)) {
      res.set('Retry-After', String(retryAfterSeconds(now)))
      res.status(429).json({ error: 'Too Many Requests', retryAfter: retryAfterSeconds(now) })
      return
    }

    // Per-identity check (only when playerId is available)
    const playerId = req.playerId
    if (playerId) {
      const identityKey = `identity:${playerId}:${path}`
      if (!checkAndIncrement(identityKey, profile.identityPerMin, now)) {
        res.set('Retry-After', String(retryAfterSeconds(now)))
        res.status(429).json({ error: 'Too Many Requests', retryAfter: retryAfterSeconds(now) })
        return
      }
    }

    next()
  }
}

// --- Daily token-budget hook ---

/**
 * Minimal interface BC-4 depends on from BC-2 (AIStateStore).
 * BC-2 implements this with the actual SQLite query.
 */
export interface DailyBudgetStore {
  recentDecisions(playerId: string, faction: string, sinceMs: number): Promise<number>
}

const DAILY_BUDGET_MS = 86_400_000

/**
 * Aggregates LLM decision counts across all supplied factions for a player
 * within the last 24 h. In P1, `over` is informational only — callers log and continue.
 *
 * @param playerId  The player's identity (from cookie).
 * @param store     BC-2 AIStateStore (or a compatible mock in tests).
 * @param factions  Exhaustive list of faction IDs that exist in the game.
 */
export async function checkDailyBudget(
  playerId: string,
  store: DailyBudgetStore,
  factions: string[],
): Promise<{ over: boolean; usedToday: number }> {
  const counts = await Promise.all(
    factions.map((f) => store.recentDecisions(playerId, f, DAILY_BUDGET_MS)),
  )
  const usedToday = counts.reduce((sum, c) => sum + c, 0)
  // P1: no hard cap — "over" is advisory only. EP-3 logs and continues.
  // P2: replace threshold with a configurable env var and return 429.
  const DAILY_BUDGET_THRESHOLD = Number(process.env.DAILY_BUDGET_THRESHOLD ?? 10_000)
  return { over: usedToday > DAILY_BUDGET_THRESHOLD, usedToday }
}
