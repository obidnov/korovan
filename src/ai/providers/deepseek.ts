// DeepSeek REST adapter — implements LLMProvider against DeepSeek's OpenAI-compat API.
// DeepSeek speaks OpenAI wire format at /v1/chat/completions, but has its own:
//   - default model id (deepseek-chat)
//   - error body shape: { error: { message, type, code } }
//   - Authorization: Bearer header convention
// This adapter is NOT a generic OpenAI-compat adapter; it bakes in DeepSeek-specific quirks.

import type { LLMProvider, LLMResponse, Message, CompleteOpts } from '../types.js';
import { LLMError } from '../types.js';
import { LLMResponseSchema, CommandEnvelopeSchema } from '../schema.js';

const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const MAX_TOTAL_MS = 30_000;

export interface DeepSeekProviderConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

export function createDeepSeekProvider(config: DeepSeekProviderConfig): LLMProvider {
  const { baseUrl, apiKey, model = DEFAULT_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS } = config;

  // Refuse http:// base URLs — key must never travel over plaintext
  if (!baseUrl.startsWith('https://')) {
    throw new Error(
      'DeepSeek adapter requires an HTTPS base URL to prevent API key exposure over plaintext',
    );
  }

  return { complete };

  async function complete(messages: Message[], opts: CompleteOpts = {}): Promise<LLMResponse> {
    const { tools, schema, signal } = opts;
    const callTimeoutMs = opts.timeoutMs ?? timeoutMs;

    // JSON-schema fallback path: no tools provided, embed schema in system prompt
    const useJsonFallback = (!tools || tools.length === 0) && schema !== undefined;

    const effectiveMessages: Message[] = useJsonFallback
      ? injectSchemaPrompt(messages, schema!)
      : messages;

    const startMs = Date.now();

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const elapsed = Date.now() - startMs;
      const remaining = MAX_TOTAL_MS - elapsed;
      if (remaining <= 0) {
        throw new LLMError('timeout', 'Exceeded 30 s total retry budget');
      }

      const effectiveTimeout = Math.min(callTimeoutMs, remaining);
      const controller = new AbortController();
      const timerId = setTimeout(() => controller.abort(), effectiveTimeout);

      const combinedSignal = signal
        ? mergeAbortSignals([signal, controller.signal])
        : controller.signal;

      let response: Response;
      try {
        const body: Record<string, unknown> = {
          model,
          messages: effectiveMessages.map(serializeMessage),
        };
        if (!useJsonFallback && tools && tools.length > 0) {
          body.tools = tools;
        }

        response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: combinedSignal,
        });
      } catch (err) {
        clearTimeout(timerId);
        if ((err as Error).name === 'AbortError') {
          throw new LLMError('timeout', 'Request timed out or was aborted');
        }
        throw new LLMError('network', 'Network error reaching DeepSeek');
      }

      clearTimeout(timerId);

      if (!response.ok) {
        const status = response.status;

        // Auth errors — never retry (prevents key-leak storm on bad key)
        if (status === 401 || status === 403) {
          throw new LLMError('auth', `DeepSeek authentication failed (HTTP ${status})`);
        }

        // Rate limiting — respect Retry-After, max 3 attempts, capped at 30 s total
        if (status === 429) {
          if (attempt >= MAX_RETRIES) {
            throw new LLMError('rate-limited', 'Rate limited after maximum retries');
          }
          const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
          const waitMs = Math.min(retryAfterMs ?? 1_000, remaining - 50);
          if (waitMs > 0) await sleep(waitMs);
          continue;
        }

        if (status >= 500) {
          throw new LLMError('provider-unreachable', `DeepSeek returned server error (HTTP ${status})`);
        }

        throw new LLMError('provider-unreachable', `Unexpected HTTP status ${status}`);
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new LLMError('invalid-shape', 'DeepSeek returned non-JSON response body');
      }

      return useJsonFallback
        ? parseJsonFallbackResponse(raw)
        : parseToolCallResponse(raw);
    }

    // Unreachable: loop always throws or returns before exhausting MAX_RETRIES without 429
    throw new LLMError('rate-limited', 'Max retries exhausted');
  }
}

// Inject the JSON schema into the system messages so the model produces structured JSON
function injectSchemaPrompt(messages: Message[], schema: Record<string, unknown>): Message[] {
  const injection: Message = {
    role: 'system',
    content:
      'Respond ONLY with a valid JSON object — no markdown, no explanation.\n' +
      'The JSON must match this schema:\n' +
      JSON.stringify(schema, null, 2),
  };
  // Prepend the schema instruction before any existing system messages
  return [injection, ...messages];
}

function serializeMessage(msg: Message): Record<string, unknown> {
  const out: Record<string, unknown> = { role: msg.role, content: msg.content };
  if (msg.tool_call_id !== undefined) out.tool_call_id = msg.tool_call_id;
  if (msg.tool_calls !== undefined) out.tool_calls = msg.tool_calls;
  return out;
}

function parseToolCallResponse(data: unknown): LLMResponse {
  const message = extractFirstChoiceMessage(data);
  const parsed = LLMResponseSchema.safeParse({
    content: (message as { content?: string | null }).content ?? null,
    tool_calls: (message as { tool_calls?: unknown }).tool_calls,
  });
  if (!parsed.success) {
    throw new LLMError('invalid-shape', 'DeepSeek response failed LLMResponse schema validation');
  }
  return parsed.data;
}

function parseJsonFallbackResponse(data: unknown): LLMResponse {
  const message = extractFirstChoiceMessage(data);
  const content = (message as { content?: string | null }).content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new LLMError('invalid-shape', 'DeepSeek JSON-fallback response has no text content');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new LLMError('invalid-shape', 'DeepSeek JSON-fallback content is not valid JSON');
  }

  // Validate against CommandEnvelope schema
  const result = CommandEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    throw new LLMError(
      'invalid-shape',
      'DeepSeek JSON-fallback content failed CommandEnvelope schema validation',
    );
  }

  return { content, tool_calls: undefined };
}

function extractFirstChoiceMessage(data: unknown): unknown {
  if (
    !data ||
    typeof data !== 'object' ||
    !('choices' in data) ||
    !Array.isArray((data as Record<string, unknown>).choices) ||
    (data as { choices: unknown[] }).choices.length === 0
  ) {
    throw new LLMError('invalid-shape', 'DeepSeek response missing choices array');
  }

  const choice = (data as { choices: Array<{ message: unknown }> }).choices[0];
  if (!choice || typeof choice.message !== 'object' || choice.message === null) {
    throw new LLMError('invalid-shape', 'DeepSeek response choice has no message');
  }

  return choice.message;
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = parseFloat(header);
  return isNaN(secs) ? undefined : Math.round(secs * 1_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Returns a signal that aborts when any of the provided signals fires
function mergeAbortSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort();
      return controller.signal;
    }
    sig.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
