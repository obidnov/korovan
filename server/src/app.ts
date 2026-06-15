import express, { Request, Response, NextFunction } from 'express'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'crypto'
import { accessSync, constants } from 'node:fs'
import { logger, redactRecord } from './logger'
import { identityRouter } from './routes/identity'
import { cookieAuth } from './middleware/cookieAuth'
import { createRateLimiter, ENDPOINT_PROFILES } from './middleware/rateLimit'
import { getDb } from './db'
import { leaderboardRouter } from './routes/leaderboard'
import { savesRouter } from './routes/saves'
import { registerLlmDecideRoute } from './routes/llmDecide'
import type { LLMProvider } from './llm/types'
import { createScriptedProvider } from './llm/scripted'

const START_MS = Date.now()

// H6: set limit BEFORE express.json parses into memory.
// 4× per-payload cap covers wrapper fields; route still enforces the 64 KB payload limit.
const SAVE_MAX_BYTES = parseInt(process.env.SAVE_MAX_BYTES ?? String(64 * 1024), 10)

export type PlayerLoader = (id: string) => Promise<{ id: string; nickname: string | null } | null>

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
function defaultPlayerLoader(playerId: string): Promise<{ id: string; nickname: string | null } | null> {
  const row = getDb()
    .prepare('SELECT player_id, nickname FROM players WHERE player_id = ?')
    .get(playerId) as { player_id: string; nickname: string | null } | undefined
  return Promise.resolve(row ? { id: row.player_id, nickname: row.nickname } : null)
}

/**
 * Creates the Express app. Accepts injectable dependencies so tests can pass
 * a fake LLM provider and a mock player loader without needing a real DB.
 */
export function createApp(
  provider: LLMProvider,
  cookieSecret?: string,
  playerLoader?: PlayerLoader,
): express.Express {
  const COOKIE_SECRET = cookieSecret ?? process.env.COOKIE_SIGNING_SECRET ?? ''
  const loader = playerLoader ?? defaultPlayerLoader
  const app = express()

  // Trust the first proxy hop so req.ip reflects X-Forwarded-For (TLS terminated upstream).
  // Per BOO P0-2 decision. Required for per-IP rate-limiting to be spoof-resistant (BOO-509).
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
    cookieAuth(loader, COOKIE_SECRET),
    leaderboardRouter,
  )
  // cookieAuth must pass-through (not 401) on missing cookie — per-IP rate limiters mounted downstream depend on this.
  app.use(
    '/api/saves',
    cookieAuth(loader, COOKIE_SECRET),
    // Bridge: cookieAuth sets req.player; rate limiter reads req.playerId.
    (req: Request, _res: Response, next: NextFunction): void => {
      req.playerId = req.player?.id
      next()
    },
    createRateLimiter(ENDPOINT_PROFILES['POST /api/saves']),
    savesRouter,
  )

  // Auth gate for /api/llm/decide — cookieAuth populates req.player before route handler.
  app.use('/api/llm/decide', cookieAuth(loader, COOKIE_SECRET))
  registerLlmDecideRoute(app, provider)

  return app
}

// Production singleton — ScriptedProvider is the safe default (no network calls).
// Tests call createApp(fakeProvider, testSecret, mockLoader) directly.
export const app = createApp(createScriptedProvider())
