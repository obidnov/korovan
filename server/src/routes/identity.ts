import { Router, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { getDb } from '../db'
import { sanitizeNickname } from '../sanitizer'
import { COOKIE_NAME, signPlayerId, verifyCookieValue, dropCookie } from '../middleware/cookieAuth'

const COOKIE_MAX_AGE = 31536000

function setCookie(res: Response, playerId: string): void {
  const sig = signPlayerId(playerId)
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${playerId}.${sig}; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}; Path=/`,
  )
}

const router = Router()

router.post('/api/identity/bootstrap', (req: Request, res: Response): void => {
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

export { router as identityRouter }
