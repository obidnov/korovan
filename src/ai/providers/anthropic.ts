// Anthropic Messages-API adapter — implements LLMProvider.
// Anthropic uses a distinct wire format from OpenAI Chat Completions:
//   - Auth: x-api-key header (not Authorization: Bearer)
//   - Required: anthropic-version header
//   - Request: system string + messages array (no system role in messages)
//   - Tools: {name, description, input_schema} (not {type:'function', function:{...}})
//   - Response: content block array (text + tool_use blocks), not choices[0].message

import type { LLMProvider, LLMResponse, Message, CompleteOpts, Tool, ToolCall } from '../types.js';
import { LLMError } from '../types.js';
import { registerProvider } from '../client.js';
import { parseCommandEnvelope } from '../schema.js';

const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const MAX_TOTAL_MS = 30_000;
const MAX_TOKENS = 4096;
const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicProviderConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

export function createAnthropicProvider(config: AnthropicProviderConfig): LLMProvider {
  const { baseUrl, apiKey, model = DEFAULT_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS } = config;

  if (!baseUrl.toLowerCase().startsWith('https://')) {
    throw new Error(
      'Anthropic adapter requires an HTTPS base URL to prevent API key exposure over plaintext',
    );
  }

  return { complete };

  async function complete(messages: Message[], opts: CompleteOpts = {}): Promise<LLMResponse> {
    const { tools, schema, signal } = opts;
    const callTimeoutMs = opts.timeoutMs ?? timeoutMs;

    const useJsonFallback = (!tools || tools.length === 0) && schema !== undefined;

    const effectiveMessages = useJsonFallback ? injectSchemaPrompt(messages, schema!) : messages;
    const { system, conversationMessages } = splitSystemMessages(effectiveMessages);

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
          max_tokens: MAX_TOKENS,
          messages: conversationMessages,
        };
        if (system !== null) {
          body.system = system;
        }
        if (!useJsonFallback && tools && tools.length > 0) {
          body.tools = tools.map(toAnthropicTool);
        }

        response = await fetch(`${baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify(body),
          signal: combinedSignal,
        });
      } catch (err) {
        clearTimeout(timerId);
        if ((err as Error).name === 'AbortError') {
          throw new LLMError('timeout', 'Request timed out or was aborted');
        }
        throw new LLMError('network', 'Network error reaching Anthropic');
      }

      clearTimeout(timerId);

      if (!response.ok) {
        const status = response.status;

        if (status === 401 || status === 403) {
          throw new LLMError('auth', `Anthropic authentication failed (HTTP ${status})`);
        }

        // 529 is Anthropic's overloaded status — treat as rate limit
        if (status === 429 || status === 529) {
          if (attempt >= MAX_RETRIES) {
            throw new LLMError('rate-limited', 'Rate limited after maximum retries');
          }
          const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
          const waitMs = Math.min(retryAfterMs ?? 1_000, remaining - 50);
          if (waitMs > 0) await sleep(waitMs);
          continue;
        }

        if (status >= 500) {
          throw new LLMError(
            'provider-unreachable',
            `Anthropic returned server error (HTTP ${status})`,
          );
        }

        throw new LLMError('provider-unreachable', `Unexpected HTTP status ${status}`);
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new LLMError('invalid-shape', 'Anthropic returned non-JSON response body');
      }

      return useJsonFallback ? parseJsonFallbackResponse(raw) : parseMessagesResponse(raw);
    }

    throw new LLMError('rate-limited', 'Max retries exhausted');
  }
}

// Anthropic requires system content in a top-level `system` field, not as a message role
function splitSystemMessages(messages: Message[]): {
  system: string | null;
  conversationMessages: Array<{ role: string; content: string }>;
} {
  const systemParts: string[] = [];
  const conversationMessages: Array<{ role: string; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      if (typeof msg.content === 'string') systemParts.push(msg.content);
    } else {
      conversationMessages.push({ role: msg.role, content: msg.content ?? '' });
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : null,
    conversationMessages,
  };
}

function injectSchemaPrompt(messages: Message[], schema: Record<string, unknown>): Message[] {
  const injection: Message = {
    role: 'system',
    content:
      'Respond ONLY with a valid JSON object — no markdown, no explanation.\n' +
      'The JSON must match this schema:\n' +
      JSON.stringify(schema, null, 2),
  };
  return [injection, ...messages];
}

// Anthropic tool definition differs from OpenAI: input_schema instead of parameters,
// no wrapping {type:'function', function:{...}} envelope
function toAnthropicTool(tool: Tool): Record<string, unknown> {
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  };
}

// Parse Anthropic Messages API response — content is an array of typed blocks
function parseMessagesResponse(data: unknown): LLMResponse {
  if (!data || typeof data !== 'object') {
    throw new LLMError('invalid-shape', 'Anthropic response is not an object');
  }

  const resp = data as Record<string, unknown>;
  if (!Array.isArray(resp.content)) {
    throw new LLMError('invalid-shape', 'Anthropic response missing content array');
  }

  const blocks = resp.content as Array<Record<string, unknown>>;
  let textContent: string | null = null;
  const tool_calls: ToolCall[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      textContent = (textContent ?? '') + String(block.text ?? '');
    } else if (block.type === 'tool_use') {
      // Convert Anthropic tool_use block to OpenAI-style ToolCall (input is object → stringify)
      tool_calls.push({
        id: String(block.id ?? ''),
        type: 'function',
        function: {
          name: String(block.name ?? ''),
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    }
  }

  return {
    content: textContent,
    tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
  };
}

function parseJsonFallbackResponse(data: unknown): LLMResponse {
  const response = parseMessagesResponse(data);

  const content = response.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new LLMError('invalid-shape', 'Anthropic JSON-fallback response has no text content');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new LLMError('invalid-shape', 'Anthropic JSON-fallback content is not valid JSON');
  }

  parseCommandEnvelope(parsed);

  return { content, tool_calls: undefined };
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = parseFloat(header);
  return isNaN(secs) ? undefined : Math.round(secs * 1_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// Self-register when this module is imported — provider id 'anthropic' available
// via createProvider() for any consumer (UI test, AgentRouter, etc.)
registerProvider('anthropic', (settings) =>
  createAnthropicProvider({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    timeoutMs: settings.timeoutMs,
  }),
);
