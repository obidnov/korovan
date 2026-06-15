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

  it('throws when COOKIE_SIGNING_SECRET is shorter than 32 bytes', () => {
    process.env.COOKIE_SIGNING_SECRET = 'a'.repeat(31)
    expect(() => validateStartupConfig()).toThrow(/32 bytes/)
  })

  it('passes when COOKIE_SIGNING_SECRET is exactly 32 bytes', () => {
    process.env.COOKIE_SIGNING_SECRET = 'a'.repeat(32)
    expect(() => validateStartupConfig()).not.toThrow()
  })

  it('passes when COOKIE_SIGNING_SECRET is longer than 32 bytes', () => {
    process.env.COOKIE_SIGNING_SECRET = 'x'.repeat(64)
    expect(() => validateStartupConfig()).not.toThrow()
  })
})
