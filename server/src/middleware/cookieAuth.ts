/**
 * Cookie authentication middleware — BOO-470 identity spec §4.
 *
 * Reads `kr_pid` cookie, validates HMAC-SHA256 signature, loads player record.
 * Sets req.player on success; drops cookie + 401 on tamper.
 *
 * Dependency: `cookie-parser` must be registered before this middleware.
 * Add to package.json: "cookie-parser": "^1.4.7", "@types/cookie-parser": "^1.4.9"
 */

import { createHmac, timingSafeEqual } from 'crypto'
import type { Request, Response, NextFunction } from 'express'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlayerRow {
  id: string
  nickname: string | null
}

// db.getPlayer is a placeholder — EP-2 will wire in the actual DB layer.
type PlayerLoader = (id: string) => Promise<PlayerRow | null>

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

const COOKIE_NAME = 'kr_pid'
const UUID_LEN = 36 // "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"

function computeHmac(playerId: string, secret: string): string {
  return createHmac('sha256', secret).update(playerId).digest('hex')
}

function dropCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  })
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Returns an Express middleware that authenticates via `kr_pid` cookie.
 *
 * @param loadPlayer  async function to load a player row by ID (DB layer)
 * @param secret      COOKIE_SIGNING_SECRET env var value; reject startup if empty
 */
export function cookieAuth(
  loadPlayer: PlayerLoader,
  secret: string,
): (req: Request, res: Response, next: NextFunction) => void {
  if (!secret || secret.length < 32) {
    throw new Error(
      'COOKIE_SIGNING_SECRET must be at least 32 characters — refusing to start',
    )
  }

  return function cookieAuthMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const raw: string | undefined = req.cookies?.[COOKIE_NAME]

    if (!raw) {
      // No cookie — endpoint decides whether to require auth.
      next()
      return
    }

    // Split: first 36 chars = UUID, char 36 = dot, rest = hex sig.
    if (raw.length <= UUID_LEN + 1) {
      dropCookie(res)
      res.status(401).json({ error: 'invalid_cookie' })
      return
    }

    const playerId = raw.slice(0, UUID_LEN)
    const sig = raw.slice(UUID_LEN + 1) // skip the dot at index 36

    const expected = computeHmac(playerId, secret)

    // Constant-time compare — prevents timing-based HMAC oracle attacks.
    let match = false
    try {
      const sigBuf = Buffer.from(sig, 'hex')
      const expBuf = Buffer.from(expected, 'hex')
      match =
        sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)
    } catch {
      // Buffer.from throws on invalid hex — treat as mismatch.
      match = false
    }

    if (!match) {
      dropCookie(res)
      res.status(401).json({ error: 'invalid_cookie' })
      return
    }

    // HMAC valid — load player from DB.
    loadPlayer(playerId)
      .then((player) => {
        if (!player) {
          // Row missing (deleted after cookie was issued) — drop and pass through.
          dropCookie(res)
          next()
          return
        }
        req.player = { id: player.id, nickname: player.nickname }
        next()
      })
      .catch((err: unknown) => next(err))
  }
}
