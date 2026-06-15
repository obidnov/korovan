/**
 * Server-side LLM provider abstraction types.
 * Spec: docs/llm-provider.md (BOO-468)
 * Consumed by: BC-1 (DeepSeek adapter), BC-3 (schema validator), EP-3 (/api/llm/decide)
 */

// ---------------------------------------------------------------------------
// Provider identity
// ---------------------------------------------------------------------------

export type ProviderId = 'deepseek' | 'anthropic' | 'openai-compat' | 'scripted' | 'fake'

// ---------------------------------------------------------------------------
// Strategic game types (sanitized — no user-controlled raw strings allowed)
// ---------------------------------------------------------------------------

export type ZoneId = 'elf-forest' | 'palace' | 'neutral' | 'villain-fort'
export type FactionId = 'elves' | 'palace-guard' | 'villain'
export type UnitClass = 'infantry' | 'archer' | 'cavalry' | 'commander'

export interface ZoneState {
  zoneId: ZoneId
  controlledBy: FactionId | null
  unitCount: Record<FactionId, number>
  hasCaravan: boolean
}

export interface UnitGroupSummary {
  unitClass: UnitClass
  count: number
  avgHpPercent: number // 0–100; integer
}

/**
 * Sanitized snapshot of the strategic game state at decision time.
 * All string values are server-controlled constants — no user-supplied
 * free-text strings are included (see sanitize.ts §4 of spec).
 */
export interface StrategicStateSnapshot {
  tickMs: number
  faction: FactionId
  zones: ZoneState[]
  ownUnits: UnitGroupSummary[]
  /** Adjacent factions with known unit counts (server-inferred, not user-supplied) */
  knownEnemies: Array<{ faction: FactionId; nearestZone: ZoneId; estimatedStrength: number }>
}

/**
 * Persisted context for an agent session (stored in ai_sessions table).
 * Carries LLM conversation history as opaque JSON so the provider can
 * maintain context across ticks without the server understanding its structure.
 */
export interface AgentSessionState {
  sessionId: string
  factionId: FactionId
  ticksSinceStart: number
  decisionCount: number
  lastCommand: AgentCommand | null
  /**
   * Provider-specific conversation context (e.g. prior messages for
   * context window maintenance). Must be serialisable to JSON. Max 32 KB
   * enforced by BC-3 before persist (prevents unbounded DB growth).
   */
  providerContext: unknown
}

// ---------------------------------------------------------------------------
// §2: AgentCommand — strict allowlist, Zod-validated in BC-3
// ---------------------------------------------------------------------------

/**
 * All commands the LLM is permitted to issue. Any output not matching
 * this discriminated union is rejected and falls through to scripted
 * fallback (see §3 of spec). Validation happens server-side in BC-3
 * BEFORE the command is persisted to ai_sessions or returned to the client.
 */
export type AgentCommand =
  | {
      kind: 'patrol'
      /** Server-validated path identifier. Unknown pathIds are rejected. */
      pathId: string
      speed: 'slow' | 'normal' | 'fast'
    }
  | {
      kind: 'ambush'
      /** Server-validated node identifier. Unknown nodeIds are rejected. */
      nodeId: string
      durationSec: number // 1–300; enforced by schema
    }
  | {
      kind: 'retreat'
      /** Server-validated node identifier for retreat destination. */
      nodeId: string
    }
  | {
      kind: 'idle'
      /** Free-text reason capped at 128 chars; sanitized before persist. */
      reason: string
    }

// ---------------------------------------------------------------------------
// §1: Core LLMProvider interface
// ---------------------------------------------------------------------------

export interface DecideInput {
  playerId: string
  faction: FactionId
  /** Sanitized game state — no user-controlled free-text (see sanitize.ts) */
  snapshot: StrategicStateSnapshot
  /** Prior context from DB; enables multi-tick conversational context */
  sessionState: AgentSessionState
}

export interface DecideOutput {
  /** Schema-validated before caller receives this value (BC-3) */
  command: AgentCommand
  /** Updated session context to persist back to ai_sessions */
  updatedSessionState: AgentSessionState
  usage?: { promptTokens: number; completionTokens: number }
}

export interface PingResult {
  ok: boolean
  latencyMs: number
  /** Sanitized error description — never includes API key or request body */
  error?: string
}

/**
 * Server-side LLM provider contract. All adapters (BC-1 DeepSeek, future
 * Anthropic, future OpenAI-compat) must implement this interface.
 *
 * The API key is held server-side (env var AI_API_KEY or provider-specific
 * variant). The client never supplies or sees the key — this kills the
 * client-resident "bring your own key" pattern from BOO-397.
 */
export interface LLMProvider {
  /** Canonical provider name; used by registry and structured logs */
  readonly name: ProviderId

  /**
   * Issue a strategic decision for the given faction tick.
   * Throws LLMProviderError on any provider-side failure — callers
   * (AgentDecideHandler in EP-3) catch and apply fallback per §3 of spec.
   */
  decide(input: DecideInput): Promise<DecideOutput>

  /**
   * Lightweight healthcheck — used by /healthz endpoint and admin probes.
   * MUST NOT include any game state in the ping request.
   * MUST return PingResult even on failure (no throw).
   */
  ping(): Promise<PingResult>
}

// ---------------------------------------------------------------------------
// §3: Error taxonomy for fallback routing (EP-3 / AgentDecideHandler)
// ---------------------------------------------------------------------------

export type LLMProviderErrorCode =
  | 'network'             // fetch threw (DNS / TCP / TLS)
  | 'timeout'             // request exceeded provider-configured timeoutMs
  | 'rate-limited'        // HTTP 429
  | 'auth'                // HTTP 401 / 403
  | 'provider-5xx'        // HTTP 5xx
  | 'schema-invalid'      // response does not match AgentCommand schema
  | 'unexpected-status'   // unexpected 4xx (400, 404, etc.) — not auth / rate-limit

export class LLMProviderError extends Error {
  readonly code: LLMProviderErrorCode
  readonly retryAfterMs?: number // set for rate-limited (from Retry-After header)
  /** HTTP status, if applicable */
  readonly httpStatus?: number

  constructor(
    code: LLMProviderErrorCode,
    message: string,
    opts?: { retryAfterMs?: number; httpStatus?: number },
  ) {
    super(message)
    this.name = 'LLMProviderError'
    this.code = code
    this.retryAfterMs = opts?.retryAfterMs
    this.httpStatus = opts?.httpStatus
  }
}

// ---------------------------------------------------------------------------
// §6: Provider registry (in-memory, single registration point)
// ---------------------------------------------------------------------------

export interface ProviderRegistry {
  /** Register a provider instance. Throws if name already registered. */
  register(provider: LLMProvider): void
  /** Get provider by id. Throws if not registered. */
  get(id: ProviderId): LLMProvider
  /** Get the default provider (env var LLM_PROVIDER, default "deepseek") */
  getDefault(): LLMProvider
  /** List registered provider ids */
  list(): ProviderId[]
}

// ---------------------------------------------------------------------------
// §7: Test seam — FakeProvider contract
// ---------------------------------------------------------------------------

/**
 * BC-1 ships a FakeProvider for Vitest that allows EP-3 and BC-3 tests to
 * run without hitting DeepSeek. The fake must implement LLMProvider in full
 * and support configurable responses and error injection.
 */
export interface FakeProviderConfig {
  /** Response to return from decide(). Overrides any scripted logic. */
  response?: DecideOutput
  /** If set, decide() throws this error instead of returning a response. */
  errorToThrow?: LLMProviderError
  /** Artificial latency for ping() in ms. Default 1. */
  pingLatencyMs?: number
}
