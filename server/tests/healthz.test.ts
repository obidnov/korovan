import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import supertest from 'supertest'
import { app } from '../src/app'
import { logger, LogLine } from '../src/logger'

describe('GET /healthz', () => {
  it('returns 200 with ok:true', async () => {
    const res = await supertest(app).get('/healthz')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true })
  })

  it('includes version field', async () => {
    const res = await supertest(app).get('/healthz')
    expect(typeof res.body.version).toBe('string')
  })

  it('includes uptime_ms as a non-negative number', async () => {
    const res = await supertest(app).get('/healthz')
    expect(typeof res.body.uptime_ms).toBe('number')
    expect(res.body.uptime_ms).toBeGreaterThanOrEqual(0)
  })

  it('returns 200 when DATABASE_URL is not set', async () => {
    const original = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      const res = await supertest(app).get('/healthz')
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
    } finally {
      if (original !== undefined) process.env.DATABASE_URL = original
    }
  })

  it('returns 503 when DATABASE_URL points to an inaccessible path', async () => {
    const original = process.env.DATABASE_URL
    // /dev/null/nonexistent guarantees ENOTDIR / ENOENT on all POSIX systems
    process.env.DATABASE_URL = '/dev/null/nonexistent-korovan.db'
    try {
      const res = await supertest(app).get('/healthz')
      expect(res.status).toBe(503)
      expect(res.body.ok).toBe(false)
      expect(typeof res.body.error).toBe('string')
    } finally {
      if (original === undefined) {
        delete process.env.DATABASE_URL
      } else {
        process.env.DATABASE_URL = original
      }
    }
  })
})

describe('request logging redaction', () => {
  const captured: LogLine[] = []

  beforeEach(() => {
    logger.sink = (line) => captured.push(line)
    captured.length = 0
  })

  afterEach(() => {
    logger.sink = null
  })

  it('redacts Authorization header in request log', async () => {
    await supertest(app).get('/healthz').set('Authorization', 'Bearer foo')

    const reqLog = captured.find((l) => l['msg'] === 'request')
    expect(reqLog).toBeDefined()
    const headers = reqLog?.['headers'] as Record<string, unknown>
    expect(headers?.['authorization']).toBe('[REDACTED]')
  })

  it('logs structured request fields', async () => {
    await supertest(app).get('/healthz')

    const reqLog = captured.find((l) => l['msg'] === 'request')
    expect(reqLog).toBeDefined()
    expect(reqLog?.['method']).toBe('GET')
    expect(reqLog?.['path']).toBe('/healthz')
    expect(reqLog?.['status']).toBe(200)
    expect(typeof reqLog?.['ms']).toBe('number')
    expect(typeof reqLog?.['reqId']).toBe('string')
    expect(typeof reqLog?.['ts']).toBe('string')
  })
})
