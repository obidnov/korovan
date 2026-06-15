import { createHmac, timingSafeEqual } from 'crypto'
import type { Request, Response, NextFunction } from 'express'

interface PlayerRow {
  id: string
  nickname: string | null
}

type PlayerLoader = (id: string) => Promise<PlayerRow | null>

export const COOKIE_NAME = 'kr_pid'
const UUID_LEN = 36

function computeHmac(playerId: string, secret: string): string {
  return createHmac('sha256', secret).update(playerId).digest('hex')
}

export function signPlayerId(playerId: string): string {
  const secret = process.env.COOKIE_SIGNING_SECRET ?? ''
  return computeHmac(playerId, secret)
}

export function verifyCookieValue(raw: string): string | null {
  if (raw.length <= UUID_LEN + 1) return null
  const playerId = raw.slice(0, UUID_LEN)
  const sig = raw.slice(UUID_LEN + 1)
  const expected = computeHmac(playerId, process.env.COOKIE_SIGNING_SECRET ?? '')
  try {
    const sigBuf = Buffer.from(sig, 'hex')
    const expBuf = Buffer.from(expected, 'hex')
    return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)
      ? playerId
      : null
  } catch {
    return null
  }
}

export function dropCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  })
}

/**
 * Returns an Express middleware that authenticates via `kr_pid` cookie.
 * Pass-through (no 401) when no cookie is present — endpoint decides auth requirement.
 * Per-IP rate-limiters mounted downstream depend on this: turning this into a 401 would
 * silently disable anonymous-traffic IP rate limiting at `/api/saves` and `/api/identity/bootstrap`.
 */
export function cookieAuth(
  loadPlayer: PlayerLoader,
  secret: string,
): (req: Request, res: Response, next: NextFunction) => void {
  if (!secret || secret.length < 32) {
    throw new Error('COOKIE_SIGNING_SECRET must be at least 32 characters')
  }

  return function cookieAuthMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const raw: string | undefined = req.cookies?.[COOKIE_NAME]

    if (!raw) {
      next()
      return
    }

    if (raw.length <= UUID_LEN + 1) {
      dropCookie(res)
      res.status(401).json({ error: 'invalid_cookie' })
      return
    }

    const playerId = raw.slice(0, UUID_LEN)
    const sig = raw.slice(UUID_LEN + 1)
    const expected = computeHmac(playerId, secret)

    let match = false
    try {
      const sigBuf = Buffer.from(sig, 'hex')
      const expBuf = Buffer.from(expected, 'hex')
      match = sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)
    } catch {
      match = false
    }

    if (!match) {
      dropCookie(res)
      res.status(401).json({ error: 'invalid_cookie' })
      return
    }

    loadPlayer(playerId)
      .then((player) => {
        if (!player) {
          dropCookie(res)
          next()
          return
        }
        req.player = { id: player.id, nickname: player.nickname }
        req.playerId = player.id // consumed by rateLimit.ts per-identity check (BOO-482)
        next()
      })
      .catch((err: unknown) => next(err))
  }
}
