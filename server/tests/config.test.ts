import { describe, it, expect, afterEach } from 'vitest'
import { validateStartupConfig } from '../src/config'

describe('validateStartupConfig', () => {
  const original = process.env.COOKIE_SIGNING_SECRET

  afterEach(() => {
    if (original === undefined) {
      delete process.env.COOKIE_SIGNING_SECRET
    } else {
      process.env.COOKIE_SIGNING_SECRET = original
    }
  })

  it('throws when COOKIE_SIGNING_SECRET is absent', () => {
    delete process.env.COOKIE_SIGNING_SECRET
    expect(() => validateStartupConfig()).toThrow(/COOKIE_SIGNING_SECRET/)
  })

  it('throws when COOKIE_SIGNING_SECRET is shorter than 64 hex characters', () => {
    process.env.COOKIE_SIGNING_SECRET = 'a'.repeat(63)
    expect(() => validateStartupConfig()).toThrow(/64 hex characters/)
  })

  it('passes when COOKIE_SIGNING_SECRET is exactly 64 hex characters', () => {
    process.env.COOKIE_SIGNING_SECRET = 'a'.repeat(64)
    expect(() => validateStartupConfig()).not.toThrow()
  })

  it('passes when COOKIE_SIGNING_SECRET is longer than 64 hex characters', () => {
    process.env.COOKIE_SIGNING_SECRET = 'x'.repeat(128)
    expect(() => validateStartupConfig()).not.toThrow()
  })

  it('passes with openssl rand -hex 32 output format (64 lowercase hex chars)', () => {
    // Simulate the output of `openssl rand -hex 32`: 64 lowercase hex characters.
    const opensslOutput = 'a3f8c2d14e7b6059281f3ad09c74be516e82f30d97c1504ab2e68f7d5039c14b'
    expect(opensslOutput).toHaveLength(64)
    process.env.COOKIE_SIGNING_SECRET = opensslOutput
    expect(() => validateStartupConfig()).not.toThrow()
  })
})
