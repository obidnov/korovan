/**
 * HTTP client for the leaderboard endpoints.
 *
 * GET  /api/leaderboard?zone=<zone>&faction=<faction>&limit=<n>
 * POST /api/leaderboard  { zone, faction, score }  → { rank }
 *
 * All functions throw on network failure; callers should catch and degrade
 * gracefully (non-blocking for gameplay).
 */

export interface LeaderboardEntry {
  rank: number
  nickname: string
  score: number
  /** ISO-8601 timestamp; absent for older entries. */
  submittedAt?: string
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[]
}

export interface SubmitPayload {
  zone: string
  faction: string
  score: number
}

export interface SubmitResponse {
  rank: number
}

const BASE = '/api/leaderboard'

export async function fetchLeaderboard(
  zone: string,
  faction: string,
  limit = 20,
): Promise<LeaderboardResponse> {
  const url = `${BASE}?zone=${encodeURIComponent(zone)}&faction=${encodeURIComponent(faction)}&limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ''))
  return res.json() as Promise<LeaderboardResponse>
}

export async function submitScore(
  payload: SubmitPayload,
  opts: { bootstrap?: () => Promise<void> } = {},
): Promise<SubmitResponse> {
  const res = await _post(payload)
  if (res.status === 401 && opts.bootstrap) {
    // Identity not established — run bootstrap flow then retry once.
    await opts.bootstrap()
    const retry = await _post(payload)
    if (!retry.ok) throw new ApiError(retry.status, await retry.text().catch(() => ''))
    return retry.json() as Promise<SubmitResponse>
  }
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ''))
  return res.json() as Promise<SubmitResponse>
}

async function _post(payload: SubmitPayload): Promise<Response> {
  return fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message || `HTTP ${status}`)
    this.name = 'ApiError'
  }
}
