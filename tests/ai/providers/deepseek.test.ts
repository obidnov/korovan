import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse, delay } from 'msw';
import { createDeepSeekProvider } from '../../../src/ai/providers/deepseek.js';
import type { LLMError } from '../../../src/ai/types.js';
import { CommandEnvelopeJsonSchema } from '../../../src/ai/schema.js';
import type { Tool, Message } from '../../../src/ai/types.js';

const BASE_URL = 'https://api.deepseek.test';
const ENDPOINT = `${BASE_URL}/v1/chat/completions`;

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

function makeToolCallResponse(args: string = '{"type":"patrol","targetZone":"elf-forest","units":[]}') {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_abc123',
              type: 'function',
              function: { name: 'emit_command', arguments: args },
            },
          ],
        },
      },
    ],
  };
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ─── Happy path: tool-call ──────────────────────────────────────────────────

describe('happy path — tool-call response', () => {
  it('returns tool_calls from a 200 response', async () => {
    server.use(
      http.post(ENDPOINT, () => HttpResponse.json(makeToolCallResponse())),
    );

    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: 'sk-test' });
    const result = await provider.complete([USER_MSG], { tools: [PATROL_TOOL] });

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls![0].function.name).toBe('emit_command');
    expect(result.content).toBeNull();
  });

  it('passes Authorization header correctly', async () => {
    let capturedAuth: string | null = null;
    server.use(
      http.post(ENDPOINT, ({ request }) => {
        capturedAuth = request.headers.get('Authorization');
        return HttpResponse.json(makeToolCallResponse());
      }),
    );

    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: 'sk-secret-key' });
    await provider.complete([USER_MSG], { tools: [PATROL_TOOL] });

    expect(capturedAuth).toBe('Bearer sk-secret-key');
  });
});

// ─── Happy path: JSON-schema fallback ─────────────────────────────────────

describe('happy path — JSON-schema fallback', () => {
  it('injects schema in system prompt and parses JSON content', async () => {
    const envelope = JSON.stringify({
      issuedAtTickMs: 1_000,
      commands: [{ type: 'noop', reason: 'no threats detected' }],
    });

    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          choices: [{ message: { role: 'assistant', content: envelope } }],
        });
      }),
    );

    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: 'sk-test' });
    const result = await provider.complete([USER_MSG], { schema: CommandEnvelopeJsonSchema });

    // Adapter should have injected a system message containing the schema
    const body = capturedBody as unknown as { messages: Array<{ role: string; content: string }>; tools?: unknown };
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('issuedAtTickMs');

    // tools must NOT be present in the request when using schema fallback
    expect(body.tools).toBeUndefined();

    // Response should carry the raw JSON content
    expect(result.content).toBe(envelope);
    expect(result.tool_calls).toBeUndefined();
  });

  it('throws invalid-shape on malformed JSON content', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json({
          choices: [{ message: { role: 'assistant', content: 'not json {{{' } }],
        }),
      ),
    );

    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: 'sk-test' });
    await expect(
      provider.complete([USER_MSG], { schema: CommandEnvelopeJsonSchema }),
    ).rejects.toMatchObject({ code: 'invalid-shape' });
  });

  it('throws invalid-shape when content fails CommandEnvelope validation', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json({
          choices: [
            { message: { role: 'assistant', content: '{"issuedAtTickMs":1,"commands":"bad"}' } },
          ],
        }),
      ),
    );

    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: 'sk-test' });
    await expect(
      provider.complete([USER_MSG], { schema: CommandEnvelopeJsonSchema }),
    ).rejects.toMatchObject({ code: 'invalid-shape' });
  });
});

// ─── Auth errors ───────────────────────────────────────────────────────────

describe('auth errors', () => {
  it('throws LLMError with code "auth" on 401', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 401 })),
    );

    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: 'sk-bad' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({
      name: 'LLMError',
      code: 'auth',
    });
  });

  it('throws LLMError with code "auth" on 403', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 403 })),
    );

    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: 'sk-bad' });
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

    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: 'sk-bad' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'auth' });

    expect(callCount).toBe(1); // no retries
  });
});

// ─── Rate limiting ─────────────────────────────────────────────────────────

describe('rate limiting', () => {
  it('retries up to 3 times on 429 and throws rate-limited after exhaustion', async () => {
    let callCount = 0;
    server.use(
      http.post(ENDPOINT, () => {
        callCount++;
        return new HttpResponse(null, {
          status: 429,
          headers: { 'Retry-After': '0' },
        });
      }),
    );

    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: 'sk-test' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'rate-limited' });

    expect(callCount).toBe(3); // 3 attempts total
  });

  it('succeeds after one 429 then 200', async () => {
    let callCount = 0;
    server.use(
      http.post(ENDPOINT, () => {
        callCount++;
        if (callCount === 1) {
          return new HttpResponse(null, {
            status: 429,
            headers: { 'Retry-After': '0' },
          });
        }
        return HttpResponse.json(makeToolCallResponse());
      }),
    );

    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: 'sk-test' });
    const result = await provider.complete([USER_MSG], { tools: [PATROL_TOOL] });

    expect(callCount).toBe(2);
    expect(result.tool_calls).toHaveLength(1);
  });
});

// ─── Timeout / AbortController ─────────────────────────────────────────────

describe('timeout / AbortController', () => {
  it('throws timeout when AbortController fires before response', async () => {
    server.use(
      http.post(ENDPOINT, async () => {
        await delay(2_000); // long delay
        return HttpResponse.json(makeToolCallResponse());
      }),
    );

    const controller = new AbortController();
    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: 'sk-test' });

    // Abort immediately after starting
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
        return HttpResponse.json(makeToolCallResponse());
      }),
    );

    const provider = createDeepSeekProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-test',
      timeoutMs: 50, // very short
    });

    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'timeout' });
  });
});

// ─── Provider unreachable (5xx) ─────────────────────────────────────────────

describe('provider unreachable', () => {
  it('throws provider-unreachable on 500', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 500 })),
    );

    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: 'sk-test' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({
      code: 'provider-unreachable',
    });
  });

  it('throws provider-unreachable on 503', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 503 })),
    );

    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: 'sk-test' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({
      code: 'provider-unreachable',
    });
  });
});

// ─── Malformed body ─────────────────────────────────────────────────────────

describe('malformed response body', () => {
  it('throws invalid-shape when body is not JSON', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        new HttpResponse('this is not json', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
      ),
    );

    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: 'sk-test' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'invalid-shape' });
  });

  it('throws invalid-shape when choices array is missing', async () => {
    server.use(
      http.post(ENDPOINT, () => HttpResponse.json({ model: 'deepseek-chat' })),
    );

    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: 'sk-test' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'invalid-shape' });
  });

  it('throws invalid-shape when choices is empty', async () => {
    server.use(
      http.post(ENDPOINT, () => HttpResponse.json({ choices: [] })),
    );

    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: 'sk-test' });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'invalid-shape' });
  });
});

// ─── HTTPS enforcement ─────────────────────────────────────────────────────

describe('HTTPS enforcement', () => {
  it('throws on http:// base URL at construction time', () => {
    expect(() =>
      createDeepSeekProvider({ baseUrl: 'http://api.deepseek.com', apiKey: 'sk-test' }),
    ).toThrow('HTTPS');
  });

  it('accepts https:// base URL', () => {
    expect(() =>
      createDeepSeekProvider({ baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test' }),
    ).not.toThrow();
  });
});

// ─── API key security ──────────────────────────────────────────────────────

describe('API key security', () => {
  it('does not include the API key in thrown error messages', async () => {
    server.use(
      http.post(ENDPOINT, () => new HttpResponse(null, { status: 401 })),
    );

    const secretKey = 'sk-ultra-secret-key-never-leak';
    const provider = createDeepSeekProvider({ baseUrl: BASE_URL, apiKey: secretKey });

    try {
      await provider.complete([USER_MSG]);
    } catch (err) {
      const error = err as LLMError;
      expect(error.message).not.toContain(secretKey);
      expect(String(error.cause ?? '')).not.toContain(secretKey);
    }
  });
});
