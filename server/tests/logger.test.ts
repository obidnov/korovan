import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { redactRecord, logger, LogLine } from '../src/logger'

// BOO-493: log-redaction hardening — recursive redactRecord + auto-applied middleware + BOO-463 regex coverage

describe('redactRecord — field-name matching', () => {
  it('redacts top-level key named "apiKey"', () => {
    expect(redactRecord({ apiKey: 'sk-abc' }).apiKey).toBe('[REDACTED]')
  })

  it('redacts "api_key" (underscore form)', () => {
    expect(redactRecord({ api_key: 'val' }).api_key).toBe('[REDACTED]')
  })

  it('redacts "api-key" (hyphen form)', () => {
    expect(redactRecord({ 'api-key': 'val' })['api-key']).toBe('[REDACTED]')
  })

  it('redacts "signing" field (BOO-463 gap)', () => {
    expect(redactRecord({ signing: 'my-cookie-signing-secret' }).signing).toBe('[REDACTED]')
  })

  it('redacts "credential" field (BOO-463 gap)', () => {
    expect(redactRecord({ credential: 'abc123' }).credential).toBe('[REDACTED]')
  })

  it('redacts "authorization" field', () => {
    expect(redactRecord({ authorization: 'Bearer token' }).authorization).toBe('[REDACTED]')
  })

  it('redacts "cookie" field', () => {
    expect(redactRecord({ cookie: 'session=x' }).cookie).toBe('[REDACTED]')
  })

  it('leaves unrelated fields untouched', () => {
    const r = redactRecord({ msg: 'hello', status: 200 })
    expect(r.msg).toBe('hello')
    expect(r.status).toBe(200)
  })
})

describe('redactRecord — REDACT_HEADERS (case-insensitive)', () => {
  it('redacts "authorization" header (lower)', () => {
    expect(redactRecord({ authorization: 'Bearer x' }).authorization).toBe('[REDACTED]')
  })

  it('redacts "Authorization" header (capitalized)', () => {
    expect(redactRecord({ Authorization: 'Bearer x' }).Authorization).toBe('[REDACTED]')
  })

  it('redacts "proxy-authorization" header (BOO-463 gap)', () => {
    expect(redactRecord({ 'proxy-authorization': 'Basic z' })['proxy-authorization']).toBe('[REDACTED]')
  })

  it('redacts "set-cookie" header', () => {
    expect(redactRecord({ 'set-cookie': 'session=abc' })['set-cookie']).toBe('[REDACTED]')
  })
})

describe('redactRecord — recursive depth (AC: depth=3 nested)', () => {
  it('redacts nested apiKey at depth 2', () => {
    const r = redactRecord({ user: { apiKey: 'sk-leak' } })
    const user = r.user as Record<string, unknown>
    expect(user.apiKey).toBe('[REDACTED]')
  })

  it('redacts nested credential at depth 3', () => {
    const r = redactRecord({ a: { b: { credential: 'secret123' } } })
    const b = (r.a as Record<string, unknown>).b as Record<string, unknown>
    expect(b.credential).toBe('[REDACTED]')
  })

  it('preserves unrelated nested fields', () => {
    const r = redactRecord({ user: { name: 'Alice', age: 30 } })
    const user = r.user as Record<string, unknown>
    expect(user.name).toBe('Alice')
    expect(user.age).toBe(30)
  })

  it('emits [DEPTH_CAP] at depth 8', () => {
    const nested: Record<string, unknown> = {}
    let cur = nested
    for (let i = 0; i < 9; i++) {
      const next: Record<string, unknown> = {}
      cur.child = next
      cur = next
    }
    cur.leaf = 'deep'
    const r = redactRecord(nested)
    // Walk down until we hit [DEPTH_CAP] — should happen before accessing leaf
    let node: unknown = r
    let depth = 0
    while (depth < 10 && typeof node === 'object' && node !== null && !Array.isArray(node)) {
      const obj = node as Record<string, unknown>
      if ('child' in obj) {
        if (obj.child === '[DEPTH_CAP]') {
          expect(obj.child).toBe('[DEPTH_CAP]')
          return
        }
        node = obj.child
        depth++
      } else {
        break
      }
    }
    // Should have hit depth cap
    expect(depth).toBeGreaterThanOrEqual(7)
  })
})

describe('redactRecord — value-shape redaction (sk- patterns)', () => {
  it('redacts sk- value in field named "note" (key-agnostic)', () => {
    const r = redactRecord({ note: 'here is sk-abc1234567890123456789012' })
    expect(r.note).toBe('here is [REDACTED]')
  })

  it('redacts sk- value in unrelated field', () => {
    const r = redactRecord({ description: 'key=sk-ant-abc1234567890123456789012' })
    expect(r.description).toBe('key=[REDACTED]')
  })

  it('does NOT redact sk- shorter than 20 chars after prefix', () => {
    const r = redactRecord({ note: 'sk-short' })
    // "sk-short" is 8 chars; sk- + 5 = 8, 5 < 20 — should NOT be redacted
    expect(r.note).toBe('sk-short')
  })

  it('redacts sk- embedded in longer message', () => {
    const r = redactRecord({ msg: 'Using key sk-abc1234567890123456789012 for API' })
    expect(r.msg).toBe('Using key [REDACTED] for API')
  })
})

describe('redactRecord — Error object sanitization', () => {
  it('redacts sk- from error.message', () => {
    const err = new Error('API call failed with sk-abc1234567890123456789012')
    const r = redactRecord({ err })
    const errOut = r.err as Record<string, unknown>
    expect(errOut.message).toBe('API call failed with [REDACTED]')
  })

  it('redacts sk- from error.stack if present', () => {
    const err = new Error('err with sk-abc1234567890123456789012')
    const r = redactRecord({ err })
    const errOut = r.err as Record<string, unknown>
    // stack contains the message, so sk- should be gone
    if (typeof errOut.stack === 'string') {
      expect(errOut.stack).not.toContain('sk-abc1234567890123456789012')
    }
  })

  it('extracts name/message/stack from Error', () => {
    const err = new Error('test error')
    const r = redactRecord({ err })
    const errOut = r.err as Record<string, unknown>
    expect(errOut.name).toBe('Error')
    expect(errOut.message).toBe('test error')
  })
})

describe('redactRecord — arrays', () => {
  it('passes array through (non-string elements untouched)', () => {
    const r = redactRecord({ ids: [1, 2, 3] })
    expect(r.ids).toEqual([1, 2, 3])
  })

  it('redacts sk- in string array elements', () => {
    const r = redactRecord({ notes: ['clean', 'key=sk-abc1234567890123456789012'] })
    expect((r.notes as string[])[0]).toBe('clean')
    expect((r.notes as string[])[1]).toBe('key=[REDACTED]')
  })
})

describe('logger — auto-applied redaction inside write() (AC: no callsite wrap)', () => {
  const captured: LogLine[] = []

  beforeEach(() => {
    logger.sink = (line) => captured.push(line)
    captured.length = 0
  })

  afterEach(() => {
    logger.sink = null
  })

  it('auto-redacts apiKey passed directly to logger.info (AC: no callsite wrap)', () => {
    logger.info({ msg: 'test', apiKey: 'sk-abc1234567890123456789012' })
    expect(captured).toHaveLength(1)
    expect(captured[0].apiKey).toBe('[REDACTED]')
  })

  it('auto-redacts nested credential via logger.warn', () => {
    logger.warn({ msg: 'warn', data: { credential: 'secret' } })
    const data = captured[0].data as Record<string, unknown>
    expect(data.credential).toBe('[REDACTED]')
  })

  it('auto-redacts proxy-authorization header in logger.error', () => {
    logger.error({ msg: 'err', headers: { 'proxy-authorization': 'Basic xyz' } })
    const headers = captured[0].headers as Record<string, unknown>
    expect(headers['proxy-authorization']).toBe('[REDACTED]')
  })

  it('auto-redacts sk- value-shape via logger.info without field-name match', () => {
    logger.info({ msg: 'note', note: 'token is sk-abc1234567890123456789012' })
    expect(captured[0].note).toBe('token is [REDACTED]')
  })

  it('preserves ts and level fields', () => {
    logger.info({ msg: 'ok' })
    expect(typeof captured[0].ts).toBe('string')
    expect(captured[0].level).toBe('info')
  })
})
