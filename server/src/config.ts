/**
 * Validates required startup configuration. Throws if any required env is absent or invalid.
 * Called from index.ts before app.listen() so the process never starts in a degraded state.
 */
export function validateStartupConfig(): void {
  const secret = process.env.COOKIE_SIGNING_SECRET ?? ''
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error(
      'COOKIE_SIGNING_SECRET must be at least 32 bytes. ' +
        'Set it to a cryptographically random string of ≥32 characters.',
    )
  }
}
