// Generic OpenAI-compatible REST adapter — implements LLMProvider against the OpenAI
// Chat Completions wire format (POST /v1/chat/completions).
//
// Covers: OpenAI cloud, local Ollama, vLLM, llama.cpp, Groq, Together AI, Fireworks, etc.
// Unlike the DeepSeek adapter (BOO-394), this adapter has NO baked-in model or URL defaults —
// caller must supply baseUrl + model explicitly. This is the "bring your own endpoint" path.

import type { LLMProvider, LLMResponse, Message, CompleteOpts } from '../types.js';
import { LLMError } from '../types.js';
import { registerProvider } from '../client.js';
import { parseLLMResponse, parseCommandEnvelope } from '../schema.js';

const MAX_RETRIES = 3;
const MAX_TOTAL_MS = 30_000;

function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

export interface OpenAICompatConfig {
  baseUrl: string;
  /** May be empty string for local providers (Ollama, llama.cpp) that require no auth. */
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export function createOpenAICompatProvider(config: OpenAICompatConfig): LLMProvider {
  const { baseUrl, apiKey, model, timeoutMs = 20_000 } = config;

  if (!model) {
    throw new Error('openai-compat: `model` must be specified — no default is baked in');
  }

  // Parse URL early — gives case-insensitive, spec-normalized protocol detection.
  // `new URL()` lowercases the scheme regardless of user input (HTTP:// → http:),
  // so the subsequent protocol check is immune to case-sensitivity bypass.
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error('openai-compat: `baseUrl` is not a valid URL');
  }

  // Block non-http/https protocols (ftp://, file://, etc.) — positive allowlist.
  if (parsedBaseUrl.protocol !== 'https:' && parsedBaseUrl.protocol !== 'http:') {
    throw new Error(
      `openai-compat: unsupported protocol "${parsedBaseUrl.protocol}" — only https:// (remote) and http:// (localhost only) are accepted`,
    );
  }

  // HTTPS enforcement: block http:// for remote endpoints (key would travel over plaintext).
  // http:// is permitted for localhost so Ollama / llama.cpp work out of the box.
  // Uses parsed protocol (always lowercase) — avoids HTTP:// case-sensitivity bypass.
  if (parsedBaseUrl.protocol === 'http:') {
    if (isLocalUrl(baseUrl)) {
      console.warn(
        '[openai-compat] http:// URL detected — safe only for localhost. ' +
          'Do NOT use a real API key with a plaintext local endpoint.',
      );
    } else {
      throw new Error(
        'openai-compat: http:// is not allowed for remote endpoints. ' +
          'Use https:// to prevent API key exposure over plaintext.',
      );
    }
  }

  // N-1: warn when empty apiKey is used with a non-local endpoint.
  // Local providers (Ollama, llama.cpp) run without auth by design;
  // remote providers almost always require credentials — empty key likely a misconfiguration.
  if (!apiKey && !isLocalUrl(baseUrl)) {
    console.warn(
      '[openai-compat] empty apiKey with a non-local endpoint — no Authorization header will be sent. ' +
        'This is unusual for remote providers; verify your configuration.',
    );
  }

  return { complete };

  async function complete(messages: Message[], opts: CompleteOpts = {}): Promise<LLMResponse> {
    const { tools, schema, signal } = opts;
    const callTimeoutMs = opts.timeoutMs ?? timeoutMs;

    // JSON-schema fallback: no tools provided but schema requested → embed in system prompt
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

        // Omit Authorization header when apiKey is empty (local providers like Ollama).
        // Sending "Bearer " with an empty token would be rejected by some servers.
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }

        response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: combinedSignal,
        });
      } catch (err) {
        clearTimeout(timerId);
        if ((err as Error).name === 'AbortError') {
          throw new LLMError('timeout', 'Request timed out or was aborted');
        }
        throw new LLMError('network', 'Network error reaching OpenAI-compat endpoint');
      }

      clearTimeout(timerId);

      if (!response.ok) {
        const status = response.status;

        // Never retry auth failures — prevents key-leak storm on bad credentials
        if (status === 401 || status === 403) {
          throw new LLMError('auth', `OpenAI-compat authentication failed (HTTP ${status})`);
        }

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
          throw new LLMError(
            'provider-unreachable',
            `OpenAI-compat endpoint returned server error (HTTP ${status})`,
          );
        }

        throw new LLMError('provider-unreachable', `Unexpected HTTP status ${status}`);
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new LLMError('invalid-shape', 'OpenAI-compat endpoint returned non-JSON response body');
      }

      return useJsonFallback ? parseJsonFallbackResponse(raw) : parseToolCallResponse(raw);
    }

    // Unreachable: loop always throws or returns before exhausting MAX_RETRIES without 429
    throw new LLMError('rate-limited', 'Max retries exhausted');
  }
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

function serializeMessage(msg: Message): Record<string, unknown> {
  const out: Record<string, unknown> = { role: msg.role, content: msg.content };
  if (msg.tool_call_id !== undefined) out.tool_call_id = msg.tool_call_id;
  if (msg.tool_calls !== undefined) out.tool_calls = msg.tool_calls;
  return out;
}

function parseToolCallResponse(data: unknown): LLMResponse {
  const message = extractFirstChoiceMessage(data);
  return parseLLMResponse(message);
}

function parseJsonFallbackResponse(data: unknown): LLMResponse {
  const message = extractFirstChoiceMessage(data);
  const content = (message as { content?: string | null }).content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new LLMError('invalid-shape', 'OpenAI-compat JSON-fallback response has no text content');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new LLMError('invalid-shape', 'OpenAI-compat JSON-fallback content is not valid JSON');
  }

  // Validate parsed JSON against CommandEnvelope shape
  parseCommandEnvelope(parsed);

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
    throw new LLMError('invalid-shape', 'OpenAI-compat response missing choices array');
  }

  const choice = (data as { choices: Array<{ message: unknown }> }).choices[0];
  if (!choice || typeof choice.message !== 'object' || choice.message === null) {
    throw new LLMError('invalid-shape', 'OpenAI-compat response choice has no message');
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

// Self-register when this module is imported.
// Any `import './providers/openaiCompat.js'` in application bootstrap or tests
// wires 'openai-compat' into createProvider() without additional setup.
registerProvider('openai-compat', (settings) =>
  createOpenAICompatProvider({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    timeoutMs: settings.timeoutMs,
  }),
);
