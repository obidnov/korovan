import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // BOO-507: three root causes of cross-file flakes, all fixed here or in test helpers:
    //   1. supertest(app) per-call listen/close → rapid port churn → TIME_WAIT exhaustion
    //      → fixed by sharing ONE listener per file via helpers/listen.ts
    //   2. Rate-limit Date.now() non-determinism under CPU load → fixed with vi.spyOn(Date,'now')
    //      in the burst test
    //   3. Module-evaluation races between parallel vitest workers (pnpm dep resolution
    //      + Node module cache + process.env mutations) → fixed by singleThread: true below
    pool: 'threads',
    poolOptions: {
      threads: { singleThread: true },
    },
    env: {
      // cookieAuth (BOO-470/498) throws at module-load if secret is absent or < 64 chars.
      // 64 lowercase hex chars = 32 bytes (openssl rand -hex 32 output format).
      // Set a fixed 64-hex-char test value so app.ts can be imported by all test files.
      // IMPORTANT: do NOT override this in test files (even temporarily) without restoring
      // it in afterEach — with singleThread, env mutations persist across file evaluations.
      COOKIE_SIGNING_SECRET: 'deadbeefcafebabe0123456789abcdeffedcba9876543210deadbeefcafebabe',
    },
  },
})
