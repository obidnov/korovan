import { Router, Request, Response, NextFunction } from 'express'
import { randomUUID } from 'crypto'
import { getDb } from '../db'
import { sanitizeNickname } from '../sanitizer'
import { COOKIE_NAME, signPlayerId, verifyCookieValue, dropCookie } from '../middleware/cookieAuth'
import { createRateLimiter, ENDPOINT_PROFILES } from '../middleware/rateLimit'

const COOKIE_MAX_AGE = 31536000

function setCookie(res: Response, playerId: string): void {
  const sig = signPlayerId(playerId)
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${playerId}.${sig}; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}; Path=/`,
  )
}

const router = Router()

// bootstrapLimiter is first — cookieAuth is intentionally absent; per-IP rate limiting must reach all anonymous requests.
const bootstrapLimiter = createRateLimiter(ENDPOINT_PROFILES['POST /api/identity/bootstrap'])

// patchMeLimiter runs after auth so req.playerId is populated for per-identity keying.
const patchMeLimiter = createRateLimiter(ENDPOINT_PROFILES['PATCH /api/identity/me'])

router.post('/api/identity/bootstrap', bootstrapLimiter, (req: Request, res: Response): void => {
  const db = getDb()
  const rawCookie: string | undefined = req.cookies?.[COOKIE_NAME]
  const rawNickname: unknown = req.body?.nickname
  const hasNickname = typeof rawNickname === 'string'
  const nickname = sanitizeNickname(hasNickname ? (rawNickname as string) : null)

  if (rawCookie) {
    const playerId = verifyCookieValue(rawCookie)

    if (playerId) {
      const player = db
        .prepare('SELECT player_id, nickname FROM players WHERE player_id = ?')
        .get(playerId) as { player_id: string; nickname: string | null } | undefined

      if (player) {
        // Re-bootstrap: refresh last_seen_at; overwrite nickname only if body provides one
        const newNickname = hasNickname ? nickname : player.nickname
        db.prepare(
          'UPDATE players SET last_seen_at = ?, nickname = ? WHERE player_id = ?',
        ).run(Date.now(), newNickname, player.player_id)
        res.json({ player_id: player.player_id, nickname: newNickname })
        return
      }
      // Row missing → fall through to create new player
    } else {
      // Tampered / malformed cookie — drop it, then create new player
      dropCookie(res)
    }
  }

  // New player
  const playerId = randomUUID()
  const now = Date.now()
  db.prepare(
    'INSERT INTO players (player_id, nickname, created_at, last_seen_at) VALUES (?, ?, ?, ?)',
  ).run(playerId, nickname, now, now)

  setCookie(res, playerId)
  res.json({ player_id: playerId, nickname })
})

// Auth guard: verifies cookie + player existence, sets req.playerId for rate limiter.
// Does NOT create a player — returns 401 for any unauthenticated state.
function requireBootstrappedPlayer(req: Request, res: Response, next: NextFunction): void {
  const rawCookie: string | undefined = req.cookies?.[COOKIE_NAME]
  if (!rawCookie) {
    res.status(401).json({ error: 'not_bootstrapped' })
    return
  }
  const playerId = verifyCookieValue(rawCookie)
  if (!playerId) {
    res.status(401).json({ error: 'not_bootstrapped' })
    return
  }
  const player = getDb()
    .prepare('SELECT player_id FROM players WHERE player_id = ?')
    .get(playerId) as { player_id: string } | undefined
  if (!player) {
    res.status(401).json({ error: 'not_bootstrapped' })
    return
  }
  req.playerId = playerId
  next()
}

router.patch(
  '/api/identity/me',
  requireBootstrappedPlayer,
  patchMeLimiter,
  (req: Request, res: Response): void => {
    const rawNickname: unknown = req.body?.nickname
    if (typeof rawNickname !== 'string') {
      res.status(400).json({ error: 'invalid_nickname' })
      return
    }
    const nickname = sanitizeNickname(rawNickname)
    if (nickname === null) {
      res.status(400).json({ error: 'invalid_nickname' })
      return
    }
    const playerId = req.playerId!
    getDb()
      .prepare('UPDATE players SET nickname = ?, last_seen_at = ? WHERE player_id = ?')
      .run(nickname, Date.now(), playerId)
    res.json({ player_id: playerId, nickname })
  },
)

export { router as identityRouter }
