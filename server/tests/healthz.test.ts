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
