// Minimal re-export of game-domain types used by decide.ts.
// The full AI provider abstraction (LLMProvider, ProviderSettings, etc.) was
// removed in BOO-485 — this file retains only what the client boundary needs.

export type LLMErrorCode =
  | 'auth'
  | 'rate-limited'
  | 'timeout'
  | 'network'
  | 'provider-unreachable'
  | 'invalid-shape'

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9_\-.]{8,}/gi,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /x-api-key:\s*\S+/gi,
]

function scrubSecrets(s: string): string {
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, '<redacted>'), s)
}

export class LLMError extends Error {
  override readonly name = 'LLMError'
  constructor(
    public readonly code: LLMErrorCode,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(scrubSecrets(message))
  }
}

// Opaque game-command type — the server decides the shape; client passes it through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CommandEnvelope = Record<string, any>
