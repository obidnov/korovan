/**
 * Identity routes — BOO-470 spec §3.
 *
 * POST /api/identity/bootstrap  — create or recover anonymous player identity
 *
 * Re-bootstrap with valid cookie → returns existing player (no new row).
 * Re-bootstrap with invalid/tampered cookie → drops cookie, creates new player.
 * First-time visit (no cookie) → creates new player.
 */

import { randomUUID, createHmac, timingSafeEqual } from 'crypto'
import type { Router, Request, Response } from 'express'

// ---------------------------------------------------------------------------
// Types & placeholders (EP-2 wires in the real DB/sanitizer)
// ---------------------------------------------------------------------------

interface PlayerRow {
  id: string
  nickname: string | null
}

// DB layer — placeholder; EP-2 replaces with real implementation.
interface IdentityDB {
  getPlayer(id: string): Promise<PlayerRow | null>
  insertPlayer(id: string, nickname: string | null): Promise<PlayerRow>
}

// Nickname sanitizer — must satisfy P0-4 contract:
//   - truncate to ≤ 32 chars
//   - strip control chars (U+0000–U+001F, U+007F–U+009F)
//   - replace jailbreak prefixes with "[redacted]"
//   - return null when result is empty
type NicknameSanitizer = (raw: string | undefined | null) => string | null

// ---------------------------------------------------------------------------
// Cookie helpers (duplicates cookieAuth.ts intentionally — no shared state)
// ---------------------------------------------------------------------------

const COOKIE_NAME = 'kr_pid'
const UUID_LEN = 36
const MAX_AGE = 31536000 // 1 year in seconds

function signCookie(playerId: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(playerId).digest('hex')
  return `${playerId}.${sig}`
}

function setCookie(res: Response, value: string): void {
  res.cookie(COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE * 1000, // express uses ms
  })
}

function dropCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  })
}

function validateHmac(raw: string, secret: string): string | null {
  if (raw.length <= UUID_LEN + 1) return null
  const playerId = raw.slice(0, UUID_LEN)
  const sig = raw.slice(UUID_LEN + 1)
  const expected = createHmac('sha256', secret).update(playerId).digest('hex')
  try {
    const a = Buffer.from(sig, 'hex')
    const b = Buffer.from(expected, 'hex')
    if (a.length === b.length && timingSafeEqual(a, b)) return playerId
  } catch {
    return null
  }
  return null
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function registerIdentityRoutes(
  router: Router,
  db: IdentityDB,
  sanitizeNickname: NicknameSanitizer,
  secret: string,
): void {
  /**
   * POST /api/identity/bootstrap
   * Body: { nickname?: string }
   * Response: { player_id: string, nickname: string | null }
   *
   * Re-bootstrap with valid cookie → returns existing player (no insert).
   * Otherwise → creates new player.
   */
  router.post(
    '/api/identity/bootstrap',
    async (req: Request, res: Response): Promise<void> => {
      const rawCookie: string | undefined = req.cookies?.[COOKIE_NAME]

      // --- Re-bootstrap path: check existing cookie ---
      if (rawCookie) {
        const playerId = validateHmac(rawCookie, secret)
        if (playerId) {
          const player = await db.getPlayer(playerId)
          if (player) {
            // Valid cookie + existing row → return existing identity, no insert.
            res.json({ player_id: player.id, nickname: player.nickname })
            return
          }
          // Row missing → fall through to create new identity.
        } else {
          // Tampered cookie → drop before issuing new one.
          dropCookie(res)
        }
      }

      // --- New identity path ---
      const nickname = sanitizeNickname(
        (req.body as { nickname?: string })?.nickname,
      )
      const playerId = randomUUID()

      const player = await db.insertPlayer(playerId, nickname)
      const cookieValue = signCookie(player.id, secret)
      setCookie(res, cookieValue)

      res.json({ player_id: player.id, nickname: player.nickname })
    },
  )
}
