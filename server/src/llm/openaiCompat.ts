// OpenAI-compatible server-side LLMProvider adapter.
// Targets any Chat-Completions endpoint that follows the OpenAI wire format:
// OpenAI cloud, OpenRouter, Together AI, local Ollama, vLLM, llama.cpp, etc.
// API key lives server-side in env (OPENAI_COMPAT_KEY) — never sent to client.
// Supersedes client-resident BOO-397 adapter.
//
// Env vars consumed by the application bootstrap (not read directly here):
//   OPENAI_COMPAT_KEY      — required, non-empty
//   OPENAI_COMPAT_BASE_URL — e.g. https://api.openai.com/v1 (includes /v1 suffix)
//   OPENAI_COMPAT_MODEL    — required, no default baked in

import type {
  LLMProvider,
  DecideInput,
  DecideOutput,
  PingResult,
  AgentCommand,
  FactionId,
  StrategicStateSnapshot,
} from './types.js'
import { LLMProviderError } from './types.js'
import { AgentCommandSchema, AGENT_COMMAND_JSON_SCHEMA } from './schema.js'

const DEFAULT_TIMEOUT_MS = 20_000
// Keep last N conversation turns in providerContext to stay within context limits.
const MAX_HISTORY_TURNS = 5

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export interface OpenAICompatServerConfig {
  /** OPENAI_COMPAT_KEY — required, non-empty */
  apiKey: string
  /** OPENAI_COMPAT_BASE_URL — must include /v1 suffix, e.g. https://api.openai.com/v1 */
  baseUrl: string
  /** OPENAI_COMPAT_MODEL — required, no default */
  model: string
  timeoutMs?: number
}

function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

/**
 * Convenience factory that reads env vars and returns a configured provider.
 * Throws at boot if required env vars are missing or the URL is unsafe.
 */
export function createOpenAICompatServerProviderFromEnv(): LLMProvider {
  const apiKey = process.env['OPENAI_COMPAT_KEY'] ?? ''
  const baseUrl = process.env['OPENAI_COMPAT_BASE_URL'] ?? ''
  const model = process.env['OPENAI_COMPAT_MODEL'] ?? ''
  return createOpenAICompatServerProvider({ apiKey, baseUrl, model })
}

/**
 * Create an OpenAI-compatible server-side LLM provider from explicit config.
 * Validates all constraints at construction time — invalid config throws before
 * any requests are made ("refuses to start").
 */
export function createOpenAICompatServerProvider(config: OpenAICompatServerConfig): LLMProvider {
  const { apiKey, baseUrl, model, timeoutMs = DEFAULT_TIMEOUT_MS } = config

  if (!apiKey || apiKey.trim() === '') {
    throw new Error(
      'openai-compat: OPENAI_COMPAT_KEY must be non-empty — set it in the server environment',
    )
  }

  if (!model || model.trim() === '') {
    throw new Error(
      'openai-compat: OPENAI_COMPAT_MODEL must be set — no default is baked in',
    )
  }

  // Parse URL early — `new URL()` normalises the scheme to lowercase, making
  // the protocol check immune to HTTP:// / HTTPS:// case-sensitivity bypass.
  let parsedUrl: URL
  try {
    parsedUrl = new URL(baseUrl)
  } catch {
    throw new Error(
      `openai-compat: OPENAI_COMPAT_BASE_URL is not a valid URL: "${baseUrl}"`,
    )
  }

  // Positive protocol allowlist: reject ftp://, file://, data://, etc.
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error(
      `openai-compat: unsupported protocol "${parsedUrl.protocol}" in OPENAI_COMPAT_BASE_URL — ` +
        'only https:// (remote) and http://localhost (local dev) are accepted',
    )
  }

  // HTTPS enforcement: http:// allowed only for localhost (Ollama, llama.cpp dev).
  // Uses normalised `parsedUrl.protocol` — avoids HTTP:// case bypass.
  if (parsedUrl.protocol === 'http:' && !isLocalUrl(baseUrl)) {
    throw new Error(
      'openai-compat: http:// is not allowed for remote endpoints in OPENAI_COMPAT_BASE_URL. ' +
        'Use https:// to prevent OPENAI_COMPAT_KEY exposure over plaintext. ' +
        'http://localhost* is allowed for local dev (Ollama, llama.cpp).',
    )
  }

  // baseUrl includes /v1 suffix (e.g. https://api.openai.com/v1); endpoint = baseUrl/chat/completions
  const completionsEndpoint = `${baseUrl}/chat/completions`

  return {
    name: 'openai-compat',

    async decide(input: DecideInput): Promise<DecideOutput> {
      const history = parseHistory(input.sessionState.providerContext)
      const userContent = serializeSnapshot(input.snapshot, input.faction)
      const messages = buildMessages(history, userContent)

      const startMs = Date.now()
      const raw = await fetchChatCompletion(completionsEndpoint, apiKey, model, timeoutMs, messages)

      const command = extractAndValidateCommand(raw)
      const latencyMs = Date.now() - startMs
      void latencyMs

      const assistantContent = serializeCommand(command)
      const updatedHistory: ChatMessage[] = [
        ...history.slice(-MAX_HISTORY_TURNS * 2 + 2),
        { role: 'user', content: userContent },
        { role: 'assistant', content: assistantContent },
      ]

      const usageRaw = (raw as Record<string, unknown>)['usage'] as
        | { prompt_tokens?: number; completion_tokens?: number }
        | undefined

      return {
        command,
        updatedSessionState: {
          ...input.sessionState,
          ticksSinceStart: input.sessionState.ticksSinceStart + 1,
          providerContext: updatedHistory,
        },
        usage: usageRaw
          ? {
              promptTokens: usageRaw.prompt_tokens ?? 0,
              completionTokens: usageRaw.completion_tokens ?? 0,
            }
          : undefined,
      }
    },

    async ping(): Promise<PingResult> {
      const startMs = Date.now()
      try {
        const controller = new AbortController()
        const timerId = setTimeout(() => controller.abort(), timeoutMs)
        let response: Response
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
          if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

          response = await fetch(completionsEndpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: '.' }],
              max_tokens: 1,
            }),
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timerId)
        }
        const latencyMs = Date.now() - startMs
        if (!response.ok) {
          return { ok: false, latencyMs, error: `HTTP ${response.status}` }
        }
        return { ok: true, latencyMs }
      } catch (err) {
        return {
          ok: false,
          latencyMs: Date.now() - startMs,
          error: err instanceof Error ? err.message : 'unknown error',
        }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseHistory(providerContext: unknown): ChatMessage[] {
  if (!Array.isArray(providerContext)) return []
  return providerContext.filter(
    (m): m is ChatMessage =>
      m !== null &&
      typeof m === 'object' &&
      (m.role === 'user' || m.role === 'assistant') &&
      (m.content === null || typeof m.content === 'string'),
  )
}

function buildMessages(history: ChatMessage[], userContent: string): ChatMessage[] {
  const system: ChatMessage = {
    role: 'system',
    content:
      'You are a strategic AI commander in a medieval fantasy game.\n' +
      'Analyse the game state and issue exactly ONE command using the issue_command tool.\n' +
      'Available command kinds: patrol, ambush, retreat, idle.\n' +
      '- patrol: send units on a patrol path (pathId, speed: slow|normal|fast)\n' +
      '- ambush: set an ambush at a node (nodeId, durationSec: 1-300)\n' +
      '- retreat: retreat to a safe node (nodeId)\n' +
      '- idle: hold position (reason, max 128 chars)',
  }
  return [system, ...history, { role: 'user', content: userContent }]
}

function serializeSnapshot(snapshot: StrategicStateSnapshot, faction: FactionId): string {
  return JSON.stringify({
    tick: snapshot.tickMs,
    yourFaction: faction,
    zones: snapshot.zones.map((z) => ({
      id: z.zoneId,
      controlledBy: z.controlledBy,
      units: z.unitCount,
      hasCaravan: z.hasCaravan,
    })),
    ownUnits: snapshot.ownUnits,
    knownEnemies: snapshot.knownEnemies,
  })
}

function serializeCommand(cmd: AgentCommand): string {
  return JSON.stringify(cmd)
}

async function fetchChatCompletion(
  endpoint: string,
  apiKey: string,
  model: string,
  timeoutMs: number,
  messages: ChatMessage[],
): Promise<unknown> {
  const controller = new AbortController()
  const timerId = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // apiKey never appears in error messages — only in this header
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: [
          {
            type: 'function',
            function: {
              name: 'issue_command',
              description: 'Issue a strategic command for your faction.',
              parameters: AGENT_COMMAND_JSON_SCHEMA,
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'issue_command' } },
      }),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timerId)
    if ((err as Error).name === 'AbortError') {
      throw new LLMProviderError('timeout', 'openai-compat request timed out')
    }
    throw new LLMProviderError('network', 'Network error reaching openai-compat endpoint')
  }

  clearTimeout(timerId)
  await assertResponseOk(response)

  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new LLMProviderError('schema-invalid', 'openai-compat returned non-JSON response body')
  }
  return raw
}

async function assertResponseOk(response: Response): Promise<void> {
  if (response.ok) return

  const status = response.status

  // Never include API key in error messages
  if (status === 401 || status === 403) {
    throw new LLMProviderError('auth', `openai-compat authentication failed (HTTP ${status})`, {
      httpStatus: status,
    })
  }

  if (status === 429) {
    const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'))
    throw new LLMProviderError('rate-limited', `openai-compat rate limited (HTTP 429)`, {
      retryAfterMs,
      httpStatus: status,
    })
  }

  if (status >= 500) {
    throw new LLMProviderError('provider-5xx', `openai-compat server error (HTTP ${status})`, {
      httpStatus: status,
    })
  }

  throw new LLMProviderError('network', `openai-compat unexpected HTTP ${status}`, {
    httpStatus: status,
  })
}

function extractAndValidateCommand(raw: unknown): AgentCommand {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !Array.isArray((raw as Record<string, unknown>)['choices']) ||
    (raw as { choices: unknown[] }).choices.length === 0
  ) {
    throw new LLMProviderError('schema-invalid', 'openai-compat response missing choices array')
  }

  const choice = (raw as { choices: Array<{ message: unknown }> }).choices[0]
  const message = choice?.message as {
    tool_calls?: Array<{ function?: { arguments?: string } }>
    content?: string | null
  } | null

  if (!message) {
    throw new LLMProviderError('schema-invalid', 'openai-compat response choice has no message')
  }

  // Tool-call path (primary)
  const toolCall = message.tool_calls?.[0]
  if (toolCall) {
    const argsStr = toolCall.function?.arguments
    if (typeof argsStr !== 'string') {
      throw new LLMProviderError('schema-invalid', 'openai-compat tool call arguments is not a string')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(argsStr)
    } catch {
      throw new LLMProviderError('schema-invalid', 'openai-compat tool call arguments is not valid JSON')
    }
    return validateCommand(parsed)
  }

  // JSON-content fallback path (for providers that don't support tool calling)
  const content = message.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw new LLMProviderError(
      'schema-invalid',
      'openai-compat response has no tool call and no text content',
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new LLMProviderError('schema-invalid', 'openai-compat response content is not valid JSON')
  }
  return validateCommand(parsed)
}

function validateCommand(value: unknown): AgentCommand {
  const result = AgentCommandSchema.safeParse(value)
  if (!result.success) {
    throw new LLMProviderError(
      'schema-invalid',
      `openai-compat AgentCommand schema validation failed: ${result.error.message}`,
    )
  }
  return result.data as AgentCommand
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined
  const secs = parseFloat(header)
  return isNaN(secs) ? undefined : Math.round(secs * 1_000)
}
