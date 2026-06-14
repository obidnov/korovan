// LLM message types

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON-encoded
  };
}

export interface Message {
  role: MessageRole;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface CompleteOpts {
  tools?: Tool[];
  /** JSON schema to embed in system prompt when tool-calling is unavailable */
  schema?: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LLMResponse {
  content: string | null;
  tool_calls?: ToolCall[];
}

// Provider identifiers — DeepSeek first (P1 default), others reserved for follow-up adapters
export type ProviderId = 'deepseek' | 'anthropic' | 'openai-compat';

export interface ProviderSettings {
  id: ProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

/** Branded redacted view — compile-time-distinct from ProviderSettings (BOO-408 O1). */
export type RedactedProviderSettings = Omit<ProviderSettings, 'apiKey'> & { apiKey: '***' };

/** Returns a copy of ProviderSettings safe for logging — apiKey is redacted. */
export function redactProviderSettings(s: ProviderSettings): RedactedProviderSettings {
  return { ...s, apiKey: '***' };
}

export interface LLMProvider {
  complete(messages: Message[], opts?: CompleteOpts): Promise<LLMResponse>;
}

// Faction command types (game domain)
export type Zone = 'elf-forest' | 'palace' | 'neutral' | 'villain-fort';
export type UnitId = string;

export type FactionCommand =
  | { type: 'patrol'; targetZone: Zone; units: UnitId[] }
  | { type: 'raid'; targetZone: Zone; units: UnitId[] }
  | { type: 'noop'; reason: string };

export interface CommandEnvelope {
  issuedAtTickMs: number;
  commands: FactionCommand[];
}

// Error taxonomy: each code maps to scripted-fallback routing (BOO-390)
export type LLMErrorCode =
  | 'auth'
  | 'rate-limited'
  | 'timeout'
  | 'network'
  | 'provider-unreachable'
  | 'invalid-shape';

// Strips recognisable secret patterns from error messages (BOO-408 O2).
// Defense-in-depth: catches adapter-implementer mistakes that echo auth headers.
const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9_\-.]{8,}/gi,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /x-api-key:\s*\S+/gi,
];

function scrubSecrets(s: string): string {
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, '<redacted>'), s);
}

export class LLMError extends Error {
  override readonly name = 'LLMError';

  constructor(
    public readonly code: LLMErrorCode,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(scrubSecrets(message));
  }
}
