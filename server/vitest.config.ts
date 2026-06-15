import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      // cookieAuth (BOO-470) throws at module-load if secret is absent or < 32 chars.
      // Set a fixed test value so app.ts can be imported by all test files.
      COOKIE_SIGNING_SECRET: 'test-signing-secret-min-32-bytes!!',
    },
  },
})
