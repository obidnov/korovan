import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse, delay } from 'msw';
import { createAnthropicProvider } from '../../../src/ai/providers/anthropic.js';
import type { LLMError } from '../../../src/ai/types.js';
import { CommandEnvelopeJsonSchema } from '../../../src/ai/schema.js';
import type { Tool, Message } from '../../../src/ai/types.js';

const BASE_URL = 'https://api.anthropic.test/v1';
const ENDPOINT = `${BASE_URL}/messages`;

const PATROL_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'emit_command',
    description: 'Emit a faction command',
    parameters: {
      type: 'object',
      properties: { type: { type: 'string' } },
      required: ['type'],
    },
  },
};

const USER_MSG: Message = { role: 'user', content: 'Issue patrol orders' };

function makeToolUseResponse(
  input: Record<string, unknown> = { type: 'patrol', targetZone: 'elf-forest', units: [] },
) {
  return {
    id: 'msg_01abc',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'toolu_01', name: 'emit_command', input }],
    stop_reason: 'tool_use',
    model: 'claude-haiku-4-5',
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

function makeTextResponse(text: string) {
  return {
    id: 'msg_02xyz',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    model: 'claude-haiku-4-5',
    usage: { input_tokens: 10, output_tokens: 30 },
  };
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ─── Happy path: tool-call ──────────────────────────────────────────────────

describe('happy path — tool-call response', () => {
  it('returns tool_calls from a 200 response', async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json(makeToolUseResponse())));

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-test' });
    const result = await provider.complete([USER_MSG], { tools: [PATROL_TOOL] });

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls![0].function.name).toBe('emit_command');
    expect(result.tool_calls![0].type).toBe('function');
    expect(result.content).toBeNull();
  });

  it('passes x-api-key header (not Authorization Bearer)', async () => {
    let capturedApiKey: string | null = null;
    let capturedAuth: string | null = null;
    server.use(
      http.post(ENDPOINT, ({ request }) => {
        capturedApiKey = request.headers.get('x-api-key');
        capturedAuth = request.headers.get('authorization');
        return HttpResponse.json(makeToolUseResponse());
      }),
    );

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-secret' });
    await provider.complete([USER_MSG], { tools: [PATROL_TOOL] });

    expect(capturedApiKey).toBe('sk-ant-secret');
    expect(capturedAuth).toBeNull(); // must not send Authorization header
  });

  it('sends anthropic-version header', async () => {
    let capturedVersion: string | null = null;
    server.use(
      http.post(ENDPOINT, ({ request }) => {
        capturedVersion = request.headers.get('anthropic-version');
        return HttpResponse.json(makeToolUseResponse());
      }),
    );

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-test' });
    await provider.complete([USER_MSG], { tools: [PATROL_TOOL] });

    expect(capturedVersion).toBe('2023-06-01');
  });

  it('extracts system role into top-level system field (not in messages array)', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeToolUseResponse());
      }),
    );

    const messages: Message[] = [
      { role: 'system', content: 'You are a faction commander AI.' },
      { role: 'user', content: 'Issue patrol orders.' },
    ];
    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-test' });
    await provider.complete(messages, { tools: [PATROL_TOOL] });

    expect(capturedBody!.system).toBe('You are a faction commander AI.');
    const msgs = capturedBody!.messages as Array<{ role: string }>;
    expect(msgs.every((m) => m.role !== 'system')).toBe(true);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
  });

  it('converts OpenAI-style tools to Anthropic format (name/description/input_schema)', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeToolUseResponse());
      }),
    );

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-test' });
    await provider.complete([USER_MSG], { tools: [PATROL_TOOL] });

    const tools = capturedBody!.tools as Array<Record<string, unknown>>;
    expect(tools[0]).toMatchObject({
      name: 'emit_command',
      description: 'Emit a faction command',
      input_schema: { type: 'object' },
    });
    // Must not use OpenAI-style wrapping
    expect(tools[0]).not.toHaveProperty('type');
    expect(tools[0]).not.toHaveProperty('function');
  });

  it('converts Anthropic tool_use input (object) to JSON-stringified arguments', async () => {
    const inputObj = { type: 'patrol', targetZone: 'palace', units: ['u1', 'u2'] };
    server.use(http.post(ENDPOINT, () => HttpResponse.json(makeToolUseResponse(inputObj))));

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-test' });
    const result = await provider.complete([USER_MSG], { tools: [PATROL_TOOL] });

    expect(result.tool_calls![0].function.arguments).toBe(JSON.stringify(inputObj));
  });
});

// ─── Happy path: JSON-schema fallback ─────────────────────────────────────

describe('happy path — JSON-schema fallback', () => {
  it('injects schema into system prompt and parses text content as JSON', async () => {
    const envelope = JSON.stringify({
      issuedAtTickMs: 1_000,
      commands: [{ type: 'noop', reason: 'no threats detected' }],
    });

    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeTextResponse(envelope));
      }),
    );

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-test' });
    const result = await provider.complete([USER_MSG], { schema: CommandEnvelopeJsonSchema });

    // System field must contain schema instruction
    expect(capturedBody!.system).toContain('issuedAtTickMs');

    // tools must NOT be present in JSON-fallback requests
    expect(capturedBody!.tools).toBeUndefined();

    expect(result.content).toBe(envelope);
    expect(result.tool_calls).toBeUndefined();
  });

  it('throws invalid-shape on malformed JSON content', async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json(makeTextResponse('not json {{{'))));

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-test' });
    await expect(
      provider.complete([USER_MSG], { schema: CommandEnvelopeJsonSchema }),
    ).rejects.toMatchObject({ code: 'invalid-shape' });
  });

  it('throws invalid-shape when content fails CommandEnvelope validation', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(makeTextResponse('{"issuedAtTickMs":1,"commands":"bad"}')),
      ),
    );

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-test' });
    await expect(
      provider.complete([USER_MSG], { schema: CommandEnvelopeJsonSchema }),
    ).rejects.toMatchObject({ code: 'invalid-shape' });
  });
});

// ─── Auth errors ───────────────────────────────────────────────────────────

describe('auth errors', () => {
  it('throws LLMError with code "auth" on 401', async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse(null, { status: 401 })));

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-bad' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({
      name: 'LLMError',
      code: 'auth',
    });
  });

  it('throws LLMError with code "auth" on 403', async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse(null, { status: 403 })));

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-bad' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'auth' });
  });

  it('does NOT retry on auth errors', async () => {
    let callCount = 0;
    server.use(
      http.post(ENDPOINT, () => {
        callCount++;
        return new HttpResponse(null, { status: 401 });
      }),
    );

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-bad' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'auth' });
    expect(callCount).toBe(1);
  });
});

// ─── Rate limiting ─────────────────────────────────────────────────────────

describe('rate limiting', () => {
  it('retries up to 3 times on 429 and throws rate-limited', async () => {
    let callCount = 0;
    server.use(
      http.post(ENDPOINT, () => {
        callCount++;
        return new HttpResponse(null, { status: 429, headers: { 'retry-after': '0' } });
      }),
    );

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-test' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'rate-limited' });
    expect(callCount).toBe(3);
  });

  it('succeeds after one 429 then 200', async () => {
    let callCount = 0;
    server.use(
      http.post(ENDPOINT, () => {
        callCount++;
        if (callCount === 1) {
          return new HttpResponse(null, { status: 429, headers: { 'retry-after': '0' } });
        }
        return HttpResponse.json(makeToolUseResponse());
      }),
    );

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-test' });
    const result = await provider.complete([USER_MSG], { tools: [PATROL_TOOL] });

    expect(callCount).toBe(2);
    expect(result.tool_calls).toHaveLength(1);
  });

  it('treats 529 (Anthropic overloaded) as rate-limited', async () => {
    let callCount = 0;
    server.use(
      http.post(ENDPOINT, () => {
        callCount++;
        return new HttpResponse(null, { status: 529, headers: { 'retry-after': '0' } });
      }),
    );

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-test' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'rate-limited' });
    expect(callCount).toBe(3);
  });
});

// ─── Timeout / AbortController ─────────────────────────────────────────────

describe('timeout / AbortController', () => {
  it('throws timeout when AbortController fires before response', async () => {
    server.use(
      http.post(ENDPOINT, async () => {
        await delay(2_000);
        return HttpResponse.json(makeToolUseResponse());
      }),
    );

    const controller = new AbortController();
    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-test' });

    const timeoutId = setTimeout(() => controller.abort(), 50);
    try {
      await expect(
        provider.complete([USER_MSG], { signal: controller.signal }),
      ).rejects.toMatchObject({ code: 'timeout' });
    } finally {
      clearTimeout(timeoutId);
    }
  });

  it('throws timeout when internal timeoutMs fires', async () => {
    server.use(
      http.post(ENDPOINT, async () => {
        await delay(500);
        return HttpResponse.json(makeToolUseResponse());
      }),
    );

    const provider = createAnthropicProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-ant-test',
      timeoutMs: 50,
    });

    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'timeout' });
  });
});

// ─── Provider unreachable (5xx) ─────────────────────────────────────────────

describe('provider unreachable', () => {
  it('throws provider-unreachable on 500', async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse(null, { status: 500 })));

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-test' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({
      code: 'provider-unreachable',
    });
  });

  it('throws provider-unreachable on 503', async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse(null, { status: 503 })));

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-test' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({
      code: 'provider-unreachable',
    });
  });
});

// ─── Malformed response body ─────────────────────────────────────────────────

describe('malformed response body', () => {
  it('throws invalid-shape when body is not JSON', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        new HttpResponse('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      ),
    );

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-test' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'invalid-shape' });
  });

  it('throws invalid-shape when content array is missing', async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json({ id: 'msg_1', type: 'message' })));

    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: 'sk-ant-test' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'invalid-shape' });
  });
});

// ─── HTTPS enforcement ─────────────────────────────────────────────────────

describe('HTTPS enforcement', () => {
  it('throws on http:// base URL at construction time', () => {
    expect(() =>
      createAnthropicProvider({ baseUrl: 'http://api.anthropic.com/v1', apiKey: 'sk-ant-test' }),
    ).toThrow('HTTPS');
  });

  it('accepts https:// base URL', () => {
    expect(() =>
      createAnthropicProvider({ baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant-test' }),
    ).not.toThrow();
  });
});

// ─── API key security ──────────────────────────────────────────────────────

describe('API key security', () => {
  it('does not include the API key in thrown error messages', async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse(null, { status: 401 })));

    const secretKey = 'sk-ant-ultra-secret-key-never-leak';
    const provider = createAnthropicProvider({ baseUrl: BASE_URL, apiKey: secretKey });

    try {
      await provider.complete([USER_MSG]);
    } catch (err) {
      const error = err as LLMError;
      expect(error.message).not.toContain(secretKey);
    }
  });
});
