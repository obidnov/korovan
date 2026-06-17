// DeepSeek server-side LLMProvider adapter.
// API key lives server-side in env (DEEPSEEK_API_KEY) — never sent to client.
// Supersedes client-resident BOO-394 adapter.

import type {
  LLMProvider,
  DecideInput,
  DecideOutput,
  PingResult,
  AgentCommand,
} from './types.js'
import { LLMProviderError } from './types.js'
import { AgentCommandSchema, AGENT_COMMAND_JSON_SCHEMA } from './schema.js'
import {
  SYSTEM_PROMPT,
  serializeSnapshotForPrompt,
  serializeCommandForHistory,
} from './serialiser.js'

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-chat'
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

export interface DeepSeekServerConfig {
  apiKey: string
  baseUrl?: string
  model?: string
  timeoutMs?: number
}

export function createDeepSeekProvider(config: DeepSeekServerConfig): LLMProvider {
  const {
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    model = DEFAULT_MODEL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = config

  // Parse via URL to canonicalise case, surface malformed input early (throws TypeError),
  // and pull a stable hostname for the loopback comparison below.
  const url = new URL(baseUrl)
  const isLoopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]'
  // Loopback carve-out is gated to NODE_ENV=test: in production the only legitimate
  // baseUrl is https://api.deepseek.com; allowing http://localhost there would let
  // a misconfiguration leak the API key in plaintext on the operator's network.
  const loopbackAllowed = process.env.NODE_ENV === 'test'
  if (url.protocol !== 'https:' && !(isLoopback && loopbackAllowed)) {
    throw new LLMProviderError('auth', 'non-HTTPS baseUrl rejected')
  }

  if (!apiKey || apiKey.trim() === '') {
    throw new LLMProviderError('auth', 'DeepSeek adapter requires a non-empty apiKey')
  }

  return {
    name: 'deepseek',

    async decide(input: DecideInput): Promise<DecideOutput> {
      const history = parseHistory(input.sessionState.providerContext)
      const userContent = serializeSnapshotForPrompt(input.snapshot, input.faction)
      const messages = buildMessages(history, userContent)

      const raw = await fetchChatCompletion(
        baseUrl,
        apiKey,
        model,
        timeoutMs,
        messages,
      )

      const command = extractAndValidateCommand(raw)

      // Append this turn to conversation history (b-2 echo path — command already
      // validated through AgentCommandSchema so idle.reason is sanitized)
      const assistantContent = serializeCommandForHistory(command)
      const updatedHistory: ChatMessage[] = [
        ...history.slice(-MAX_HISTORY_TURNS * 2 + 2),
        { role: 'user', content: userContent },
        { role: 'assistant', content: assistantContent },
      ]

      // Extract usage if present
      const usageRaw = (raw as Record<string, unknown>)['usage'] as
        | { prompt_tokens?: number; completion_tokens?: number }
        | undefined

      const output: DecideOutput = {
        command,
        updatedSessionState: {
          ...input.sessionState,
          ticksSinceStart: input.sessionState.ticksSinceStart + 1,
          providerContext: updatedHistory,
        },
      }

      if (usageRaw) {
        output.usage = {
          promptTokens: usageRaw.prompt_tokens ?? 0,
          completionTokens: usageRaw.completion_tokens ?? 0,
        }
      }

      return output
    },

    async ping(): Promise<PingResult> {
      const startMs = Date.now()
      try {
        const controller = new AbortController()
        const timerId = setTimeout(() => controller.abort(), timeoutMs)
        let response: Response
        try {
          response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
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
  // SYSTEM_PROMPT from serialiser.ts includes the instruction-isolation clause
  // (BOO-405 Layer 2: marks <gameState> as UNTRUSTED DATA).
  const system: ChatMessage = { role: 'system', content: SYSTEM_PROMPT }
  return [system, ...history, { role: 'user', content: userContent }]
}

async function fetchChatCompletion(
  baseUrl: string,
  apiKey: string,
  model: string,
  timeoutMs: number,
  messages: ChatMessage[],
): Promise<unknown> {
  const controller = new AbortController()
  const timerId = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(`${baseUrl}/v1/chat/completions`, {
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
      throw new LLMProviderError('timeout', 'DeepSeek request timed out')
    }
    throw new LLMProviderError('network', 'Network error reaching DeepSeek')
  }

  clearTimeout(timerId)
  await assertResponseOk(response)

  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new LLMProviderError('schema-invalid', 'DeepSeek returned non-JSON response body')
  }
  return raw
}

async function assertResponseOk(response: Response): Promise<void> {
  if (response.ok) return

  const status = response.status

  if (status === 401 || status === 403) {
    // Never include API key or auth headers in the error message
    throw new LLMProviderError('auth', `DeepSeek authentication failed (HTTP ${status})`, {
      httpStatus: status,
    })
  }

  if (status === 429) {
    const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'))
    throw new LLMProviderError('rate-limited', `DeepSeek rate limited (HTTP 429)`, {
      retryAfterMs,
      httpStatus: status,
    })
  }

  if (status >= 500) {
    throw new LLMProviderError('provider-5xx', `DeepSeek server error (HTTP ${status})`, {
      httpStatus: status,
    })
  }

  throw new LLMProviderError('unexpected-status', `DeepSeek unexpected HTTP ${status}`, { httpStatus: status })
}

function extractAndValidateCommand(raw: unknown): AgentCommand {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !Array.isArray((raw as Record<string, unknown>)['choices']) ||
    (raw as { choices: unknown[] }).choices.length === 0
  ) {
    throw new LLMProviderError('schema-invalid', 'DeepSeek response missing choices array')
  }

  const choice = (raw as { choices: Array<{ message: unknown }> }).choices[0]
  const message = choice?.message as {
    tool_calls?: Array<{ function?: { arguments?: string } }>
    content?: string | null
  } | null

  if (!message) {
    throw new LLMProviderError('schema-invalid', 'DeepSeek response choice has no message')
  }

  // Tool-call path (primary)
  const toolCall = message.tool_calls?.[0]
  if (toolCall) {
    const argsStr = toolCall.function?.arguments
    if (typeof argsStr !== 'string') {
      throw new LLMProviderError('schema-invalid', 'Tool call arguments is not a string')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(argsStr)
    } catch {
      throw new LLMProviderError('schema-invalid', 'Tool call arguments is not valid JSON')
    }
    return validateCommand(parsed)
  }

  // JSON-content fallback path
  const content = message.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw new LLMProviderError('schema-invalid', 'DeepSeek response has no tool call and no text content')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new LLMProviderError('schema-invalid', 'DeepSeek response content is not valid JSON')
  }
  return validateCommand(parsed)
}

function validateCommand(value: unknown): AgentCommand {
  const result = AgentCommandSchema.safeParse(value)
  if (!result.success) {
    throw new LLMProviderError(
      'schema-invalid',
      `AgentCommand schema validation failed: ${result.error.message}`,
    )
  }
  return result.data as AgentCommand
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined
  const secs = parseFloat(header)
  return isNaN(secs) ? undefined : Math.round(secs * 1_000)
}
