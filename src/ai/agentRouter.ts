import type { CommandEnvelope, LLMProvider, LLMResponse, Message, ProviderSettings } from './types'
import { LLMError, redactProviderSettings } from './types'
import { parseCommandEnvelope, COMMAND_ENVELOPE_JSON_SCHEMA } from './schema'

export interface GameStateSnapshot {
  tickMs: number
  factionId: string
}

export type ScriptedFallbackFn = (snapshot: GameStateSnapshot) => CommandEnvelope

export interface AgentRouterOptions {
  provider: LLMProvider
  settings: ProviderSettings
  scriptedFallback: ScriptedFallbackFn
  /** Strategic tick interval in ms. Default 10 000 (10 s). */
  tickIntervalMs?: number
}

// Additional scripted-fallback ticks after the error tick, by error code.
// Total fallback = 1 (error tick) + value below.
const EXTRA_FALLBACK_TICKS: Partial<Record<string, number>> = {
  timeout: 0,          // 1 tick total before retry
  'invalid-shape': 0,  // 1 tick total
  'rate-limited': 1,   // 2 ticks total (time-based back-off is P2)
  network: 1,          // 2 ticks total
  'provider-unreachable': 2, // 3 ticks total
}

export class AgentRouter {
  private readonly provider: LLMProvider
  private readonly settings: ProviderSettings
  private readonly scriptedFallback: ScriptedFallbackFn
  readonly tickIntervalMs: number

  private _fallbackTicksRemaining = 0
  private _authDisabled = false
  private _timerId: ReturnType<typeof setInterval> | null = null

  constructor(opts: AgentRouterOptions) {
    this.provider = opts.provider
    this.settings = opts.settings
    this.scriptedFallback = opts.scriptedFallback
    this.tickIntervalMs = opts.tickIntervalMs ?? 10_000
  }

  /** Begin auto-ticking. No-op if already started. */
  start(getSnapshot: () => GameStateSnapshot): void {
    if (this._timerId !== null) return
    this._timerId = setInterval(() => {
      void this.tick(getSnapshot())
    }, this.tickIntervalMs)
  }

  stop(): void {
    if (this._timerId !== null) {
      clearInterval(this._timerId)
      this._timerId = null
    }
  }

  get isAuthDisabled(): boolean {
    return this._authDisabled
  }

  get fallbackTicksRemaining(): number {
    return this._fallbackTicksRemaining
  }

  async tick(snapshot: GameStateSnapshot): Promise<CommandEnvelope> {
    // Auth failure permanently disables LLM for this session (no retry — prevents key-leak storm).
    // Fallback counter drains one per tick while nonzero.
    if (this._authDisabled || this._fallbackTicksRemaining > 0) {
      if (this._fallbackTicksRemaining > 0) this._fallbackTicksRemaining--
      return this.scriptedFallback(snapshot)
    }

    try {
      const response = await this.provider.complete(buildMessages(snapshot), {
        tools: [
          {
            type: 'function',
            function: {
              name: 'issue_commands',
              description: 'Issue faction commands for this strategic tick.',
              parameters: COMMAND_ENVELOPE_JSON_SCHEMA as Record<string, unknown>,
            },
          },
        ],
        schema: COMMAND_ENVELOPE_JSON_SCHEMA as Record<string, unknown>,
      })
      return extractCommandEnvelope(response)
    } catch (err) {
      return this._handleError(err, snapshot)
    }
  }

  private _handleError(err: unknown, snapshot: GameStateSnapshot): CommandEnvelope {
    if (!(err instanceof LLMError)) {
      this._fallbackTicksRemaining = EXTRA_FALLBACK_TICKS['provider-unreachable'] ?? 2
      return this.scriptedFallback(snapshot)
    }

    if (err.code === 'auth') {
      // Never retry auth — prevents a key-leak retry storm.
      // Log code only, never the raw error message (may contain auth context from buggy adapters).
      this._authDisabled = true
      console.warn('[AgentRouter] auth failure — AI disabled for session', {
        provider: redactProviderSettings(this.settings),
        code: err.code,
      })
      return this.scriptedFallback(snapshot)
    }

    this._fallbackTicksRemaining = EXTRA_FALLBACK_TICKS[err.code] ?? 0
    console.warn('[AgentRouter] LLM error — using scripted fallback', {
      provider: redactProviderSettings(this.settings),
      code: err.code,
      fallbackTicksRemaining: this._fallbackTicksRemaining,
    })
    return this.scriptedFallback(snapshot)
  }
}

function buildMessages(snapshot: GameStateSnapshot): Message[] {
  return [
    {
      role: 'system',
      content:
        'You are a faction commander AI. Issue strategic orders for your faction each tick. Use the issue_commands tool to return a CommandEnvelope.',
    },
    {
      role: 'user',
      // JSON.stringify prevents prompt injection from user-controlled fields (unit names, etc.)
      content: JSON.stringify({ tickMs: snapshot.tickMs, factionId: snapshot.factionId }),
    },
  ]
}

function extractCommandEnvelope(response: LLMResponse): CommandEnvelope {
  // Preferred path: tool_calls
  if (response.tool_calls && response.tool_calls.length > 0) {
    const call = response.tool_calls[0]
    if (call.function.name === 'issue_commands') {
      let parsed: unknown
      try {
        parsed = JSON.parse(call.function.arguments)
      } catch {
        throw new LLMError('invalid-shape', 'tool_call arguments is not valid JSON')
      }
      return parseCommandEnvelope(parsed)
    }
  }
  // Fallback path: parse content as JSON
  if (typeof response.content === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(response.content)
    } catch {
      throw new LLMError('invalid-shape', 'LLM content is not parseable JSON')
    }
    return parseCommandEnvelope(parsed)
  }
  throw new LLMError('invalid-shape', 'LLMResponse has neither tool_calls nor parseable content')
}
