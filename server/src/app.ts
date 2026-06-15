import express, { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'crypto'
import { accessSync, constants } from 'node:fs'
import { logger, redactRecord } from './logger'
import { leaderboardRouter } from './routes/leaderboard'

const START_MS = Date.now()

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

const app = express()

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

app.use(express.json())

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

app.use('/api/leaderboard', leaderboardRouter)

export { app }
