import { Request, Response, NextFunction } from 'express'
import { createHmac, timingSafeEqual } from 'crypto'
import { getDb } from '../db'

export const COOKIE_NAME = 'kr_pid'

export function signPlayerId(playerId: string): string {
  const secret = process.env.COOKIE_SIGNING_SECRET ?? ''
  return createHmac('sha256', secret).update(playerId).digest('hex')
}

export function verifyCookieValue(raw: string): string | null {
  // Format: <36-char UUID>.<64-char hex HMAC>
  if (raw.length < 38) return null
  const playerId = raw.slice(0, 36)
  const sig = raw.slice(37)
  const expected = signPlayerId(playerId)
  const sigBuf = Buffer.from(sig, 'hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  if (sigBuf.length === 0 || sigBuf.length !== expectedBuf.length) return null
  return timingSafeEqual(sigBuf, expectedBuf) ? playerId : null
}

export function dropCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
  )
}

// Middleware for cookie-authenticated endpoints (returns 401 on bad cookie).
// The bootstrap endpoint does NOT use this — it handles cookie validation inline.
export function cookieAuth(req: Request, res: Response, next: NextFunction): void {
  const raw: string | undefined = req.cookies?.[COOKIE_NAME]
  if (!raw) {
    next()
    return
  }

  const playerId = verifyCookieValue(raw)
  if (!playerId) {
    dropCookie(res)
    res.status(401).json({ error: 'invalid_cookie' })
    return
  }

  const db = getDb()
  const player = db
    .prepare('SELECT player_id, nickname FROM players WHERE player_id = ?')
    .get(playerId) as { player_id: string; nickname: string | null } | undefined

  if (!player) {
    dropCookie(res)
    next()
    return
  }

  req.player = { id: player.player_id, nickname: player.nickname }
  next()
}
