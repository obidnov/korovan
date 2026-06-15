import express, { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'crypto'
import { logger, redactRecord } from './logger'

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
  res.json({ ok: true, version: process.env.GIT_SHA ?? 'dev' })
})

export { app }
