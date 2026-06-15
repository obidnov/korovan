import express, { Request, Response, NextFunction } from 'express'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'crypto'
import { accessSync, constants } from 'node:fs'
import { logger, redactRecord } from './logger'
import { identityRouter } from './routes/identity'
import { cookieAuth } from './middleware/cookieAuth'
import { getDb } from './db'
import { leaderboardRouter } from './routes/leaderboard'
import { savesRouter } from './routes/saves'

const START_MS = Date.now()

// H6: set limit BEFORE express.json parses into memory.
// 4× per-payload cap covers wrapper fields; route still enforces the 64 KB payload limit.
const SAVE_MAX_BYTES = parseInt(process.env.SAVE_MAX_BYTES ?? String(64 * 1024), 10)

function probeDatabase(): { ok: boolean; error?: string } {
  const url = process.env.DATABASE_URL
  if (!url) return { ok: true }
  // Strip sqlite: / file: URI prefix to get the filesystem path.
  const dbPath = url.replace(/^(sqlite:|file:)+/i, '')
  try {
    accessSync(dbPath, constants.R_OK | constants.W_OK)
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: `DB unreachable: ${String(err)}` }
  }
}

// PlayerLoader for BOO-470 cookieAuth: reads from the migrated `players` table.
// Lazy: getDb() is not called until the first authed request.
function loadPlayer(playerId: string): Promise<{ id: string; nickname: string | null } | null> {
  const row = getDb()
    .prepare('SELECT player_id, nickname FROM players WHERE player_id = ?')
    .get(playerId) as { player_id: string; nickname: string | null } | undefined
  return Promise.resolve(row ? { id: row.player_id, nickname: row.nickname } : null)
}

const app = express()

// Trust the first proxy hop so req.ip reflects X-Forwarded-For (TLS terminated upstream).
// Per BOO P0-2 decision.
app.set('trust proxy', 1)

app.use((_req: Request, res: Response, next: NextFunction): void => {
  const reqId = randomUUID()
  const start = Date.now()

  res.on('finish', () => {
    const req = _req
    const headers = redactRecord(
      req.headers as Record<string, unknown>,
    )
    logger.info({
      msg: 'request',
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
      reqId,
      headers,
    })
  })

  next()
})

app.use(express.json({ limit: SAVE_MAX_BYTES * 4 }))
app.use(cookieParser())

app.get('/healthz', (_req: Request, res: Response): void => {
  const db = probeDatabase()
  if (!db.ok) {
    res.status(503).json({ ok: false, error: db.error })
    return
  }
  res.json({
    ok: true,
    version: process.env.GIT_SHA ?? 'dev',
    uptime_ms: Date.now() - START_MS,
  })
})

app.use(identityRouter)
app.use(
  '/api/leaderboard',
  cookieAuth(loadPlayer, process.env.COOKIE_SIGNING_SECRET ?? ''),
  leaderboardRouter,
)
app.use(
  '/api/saves',
  cookieAuth(loadPlayer, process.env.COOKIE_SIGNING_SECRET ?? ''),
  savesRouter,
)

export { app }
