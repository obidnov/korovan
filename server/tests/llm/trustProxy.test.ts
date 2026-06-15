/**
 * Trust-proxy + req.ip tests (BOO-509).
 *
 * Verifies two properties of the Express trust-proxy config:
 *   1. Proxy-inserted X-Forwarded-For is honored: req.ip = the client IP forwarded
 *      by the trusted proxy, NOT the socket address.
 *   2. Attacker-prepended X-Forwarded-For is rejected: when a client sends a spoofed
 *      IP at the front of the XFF chain, req.ip returns the real client IP inserted
 *      by the proxy — not the spoofed leading value.
 *
 * These tests are independent of the llmDecide route; they validate the Express
 * framework layer that makes per-IP rate-limiting spoof-resistant.
 */

import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'

// ---------------------------------------------------------------------------
// Helper — minimal probe app that exposes req.ip as JSON
// ---------------------------------------------------------------------------

function makeProbeApp(trustProxy: number | boolean | string): express.Express {
  const app = express()
  app.set('trust proxy', trustProxy)
  app.get('/ip', (req, res) => {
    res.json({ ip: req.ip })
  })
  return app
}

// ---------------------------------------------------------------------------
// Baseline: without trust proxy, req.ip is the socket address
// ---------------------------------------------------------------------------

describe('trust proxy disabled — req.ip = socket address regardless of XFF', () => {
  it('ignores X-Forwarded-For when trust proxy is false', async () => {
    const app = makeProbeApp(false)
    const res = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.1')
    expect(res.status).toBe(200)
    // Without trust proxy, Express ignores XFF and returns the loopback socket addr.
    const ip = (res.body as { ip: string }).ip
    expect(ip).toMatch(/127\.0\.0\.1|::1/)
  })
})

// ---------------------------------------------------------------------------
// With trust proxy=1 (production setting): proxy-inserted XFF is honored
// ---------------------------------------------------------------------------

describe('trust proxy=1 — proxy-forwarded IP is used as req.ip', () => {
  it('honors single-value XFF inserted by trusted proxy', async () => {
    const app = makeProbeApp(1)
    const res = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.42')
    expect(res.status).toBe(200)
    // Supertest connects from ::1/127.0.0.1 (treated as the trusted proxy hop).
    // Express trusts the XFF value it inserted → req.ip = the forwarded client IP.
    expect((res.body as { ip: string }).ip).toBe('203.0.113.42')
  })
})

// ---------------------------------------------------------------------------
// Spoof prevention: attacker-prepended XFF is rejected
//
// Attack scenario (production):
//   1. Attacker at real IP 5.5.5.5 sends "X-Forwarded-For: 1.1.1.1" in their request.
//   2. Fly.io proxy appends their actual IP: XFF becomes "1.1.1.1, 5.5.5.5".
//   3. Server with trust proxy=1 takes the rightmost trusted value → req.ip = 5.5.5.5.
//   4. The spoofed "1.1.1.1" at the front is ignored.
//
// Without trust proxy (broken getClientIp): XFF.split(',')[0] = '1.1.1.1' → spoofed!
// With req.ip + trust proxy=1: Express peels exactly 1 hop → 5.5.5.5 (real IP).
// ---------------------------------------------------------------------------

describe('trust proxy=1 — leading spoofed XFF is rejected', () => {
  it('req.ip = rightmost XFF value, not the attacker-prepended leftmost', async () => {
    const app = makeProbeApp(1)
    // Simulate a two-hop XFF chain: "spoofed, real-client-ip".
    // With trust proxy=1, Express trusts the socket (1 hop) and peels one XFF entry
    // from the right → rightmost = '5.5.5.5' (real), leftmost = '1.1.1.1' (spoofed).
    const res = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '1.1.1.1, 5.5.5.5')
    expect(res.status).toBe(200)
    const ip = (res.body as { ip: string }).ip
    // Must be the rightmost (real) IP, not the leading spoofed value.
    expect(ip).toBe('5.5.5.5')
    expect(ip).not.toBe('1.1.1.1')
  })

  it('direct XFF parsing (broken pattern) WOULD return the spoofed value', () => {
    // Documents why the old getClientIp was vulnerable.
    // This is the code path BOO-509 closes; kept as a regression anchor.
    const xff = '1.1.1.1, 5.5.5.5'
    const brokenGetClientIp = (h: string) => h.split(',')[0]?.trim() ?? 'unknown'
    expect(brokenGetClientIp(xff)).toBe('1.1.1.1') // spoofed!
  })
})

// ---------------------------------------------------------------------------
// Rate-limit middleware consistency: req.ip key matches across both checks
// ---------------------------------------------------------------------------

describe('rate-limit key stability — req.ip is consistent within a request', () => {
  it('same IP appears as req.ip for repeated requests from the same forwarded address', async () => {
    const app = makeProbeApp(1)
    const ip1 = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.7')
      .then((r) => (r.body as { ip: string }).ip)
    const ip2 = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.7')
      .then((r) => (r.body as { ip: string }).ip)
    expect(ip1).toBe('198.51.100.7')
    expect(ip2).toBe('198.51.100.7')
    expect(ip1).toBe(ip2)
  })

  it('different forwarded IPs produce different req.ip values', async () => {
    const app = makeProbeApp(1)
    const ipA = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '192.0.2.1')
      .then((r) => (r.body as { ip: string }).ip)
    const ipB = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '192.0.2.2')
      .then((r) => (r.body as { ip: string }).ip)
    expect(ipA).toBe('192.0.2.1')
    expect(ipB).toBe('192.0.2.2')
    expect(ipA).not.toBe(ipB)
  })
})
