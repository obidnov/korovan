/**
 * Per-identity and per-IP sliding-window rate limiter.
 * BC-4: max 10 req/min per player, 30 req/min per IP.
 * Counters are in-memory — suitable for single-instance demo deployment.
 */

interface Window {
  timestamps: number[]
}

const playerWindows = new Map<string, Window>()
const ipWindows = new Map<string, Window>()

const PLAYER_MAX = 10
const IP_MAX = 30
const WINDOW_MS = 60_000

function countWithin(w: Window, nowMs: number): number {
  const cutoff = nowMs - WINDOW_MS
  w.timestamps = w.timestamps.filter((t) => t > cutoff)
  return w.timestamps.length
}

function record(w: Window, nowMs: number): void {
  w.timestamps.push(nowMs)
}

function getOrCreate(map: Map<string, Window>, key: string): Window {
  let w = map.get(key)
  if (!w) {
    w = { timestamps: [] }
    map.set(key, w)
  }
  return w
}

/**
 * Returns true if the request is within rate limits; false if over limit.
 * Records the hit when allowed.
 */
export function checkAndRecord(playerId: string, ip: string): boolean {
  const now = Date.now()

  const pw = getOrCreate(playerWindows, playerId)
  const iw = getOrCreate(ipWindows, ip)

  if (countWithin(pw, now) >= PLAYER_MAX) return false
  if (countWithin(iw, now) >= IP_MAX) return false

  record(pw, now)
  record(iw, now)
  return true
}

/** Test helper — clears all rate-limit windows. */
export function _resetRateLimiter(): void {
  playerWindows.clear()
  ipWindows.clear()
}
