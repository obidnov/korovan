/**
 * Validates required startup configuration. Throws if any required env is absent or invalid.
 * Called from index.ts before app.listen() so the process never starts in a degraded state.
 */
export function validateStartupConfig(): void {
  const secret = process.env.COOKIE_SIGNING_SECRET ?? ''
  if (secret.length < 64) {
    throw new Error(
      'COOKIE_SIGNING_SECRET must be at least 64 hex characters (= 32 bytes). ' +
        'Generate with: openssl rand -hex 32',
    )
  }
}
