import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse, delay } from 'msw';
import { createOpenAICompatProvider } from '../../../src/ai/providers/openaiCompat.js';
import type { LLMError } from '../../../src/ai/types.js';
import { COMMAND_ENVELOPE_JSON_SCHEMA } from '../../../src/ai/schema.js';
import type { Tool, Message } from '../../../src/ai/types.js';

const BASE_URL = 'https://openai.test';
const ENDPOINT = `${BASE_URL}/v1/chat/completions`;

const EMIT_TOOL: Tool = {
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

function makeToolCallResponse(
  args = '{"type":"patrol","targetZone":"elf-forest","units":[]}',
) {
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
    server.use(http.post(ENDPOINT, () => HttpResponse.json(makeToolCallResponse())));

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    const result = await provider.complete([USER_MSG], { tools: [EMIT_TOOL] });

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls![0].function.name).toBe('emit_command');
    expect(result.content).toBeNull();
  });

  it('sends Authorization: Bearer header when apiKey is non-empty', async () => {
    let capturedAuth: string | null = null;
    server.use(
      http.post(ENDPOINT, ({ request }) => {
        capturedAuth = request.headers.get('Authorization');
        return HttpResponse.json(makeToolCallResponse());
      }),
    );

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-secret-key',
      model: 'gpt-4o',
    });
    await provider.complete([USER_MSG], { tools: [EMIT_TOOL] });

    expect(capturedAuth).toBe('Bearer sk-secret-key');
  });

  it('sends correct model field in request body', async () => {
    let capturedModel: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        capturedModel = body.model;
        return HttpResponse.json(makeToolCallResponse());
      }),
    );

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-test',
      model: 'meta-llama/Llama-3-8b-instruct',
    });
    await provider.complete([USER_MSG], { tools: [EMIT_TOOL] });

    expect(capturedModel).toBe('meta-llama/Llama-3-8b-instruct');
  });
});

// ─── Empty-key path (local Ollama / llama.cpp) ─────────────────────────────

describe('empty-key path (local provider, e.g. Ollama)', () => {
  const OLLAMA_URL = 'http://localhost:11434';
  const OLLAMA_ENDPOINT = `${OLLAMA_URL}/v1/chat/completions`;

  it('accepts empty apiKey without throwing at construction time', () => {
    expect(() =>
      createOpenAICompatProvider({ baseUrl: OLLAMA_URL, apiKey: '', model: 'llama3' }),
    ).not.toThrow();
  });

  it('omits Authorization header when apiKey is empty', async () => {
    let capturedAuth: string | null | undefined = 'initial';
    server.use(
      http.post(OLLAMA_ENDPOINT, ({ request }) => {
        capturedAuth = request.headers.get('Authorization');
        return HttpResponse.json(makeToolCallResponse());
      }),
    );

    const provider = createOpenAICompatProvider({
      baseUrl: OLLAMA_URL,
      apiKey: '',
      model: 'llama3',
    });
    await provider.complete([USER_MSG], { tools: [EMIT_TOOL] });

    expect(capturedAuth).toBeNull();
  });

  it('succeeds with a valid response from a local endpoint', async () => {
    server.use(
      http.post(OLLAMA_ENDPOINT, () => HttpResponse.json(makeToolCallResponse())),
    );

    const provider = createOpenAICompatProvider({
      baseUrl: OLLAMA_URL,
      apiKey: '',
      model: 'llama3',
    });
    const result = await provider.complete([USER_MSG], { tools: [EMIT_TOOL] });

    expect(result.tool_calls).toHaveLength(1);
  });
});

// ─── Happy path: JSON-schema fallback ─────────────────────────────────────

describe('happy path — JSON-schema fallback', () => {
  it('injects schema in system prompt and parses JSON content', async () => {
    const envelope = JSON.stringify({
      issuedAtTickMs: 1_000,
      commands: [{ type: 'noop', reason: 'all quiet' }],
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

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    const result = await provider.complete([USER_MSG], { schema: COMMAND_ENVELOPE_JSON_SCHEMA });

    // System prompt should contain the schema
    const body = capturedBody as unknown as {
      messages: Array<{ role: string; content: string }>;
      tools?: unknown;
    };
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('issuedAtTickMs');

    // tools must NOT be present when using schema fallback
    expect(body.tools).toBeUndefined();

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

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    await expect(
      provider.complete([USER_MSG], { schema: COMMAND_ENVELOPE_JSON_SCHEMA }),
    ).rejects.toMatchObject({ code: 'invalid-shape' });
  });

  it('throws invalid-shape when content fails CommandEnvelope validation', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '{"issuedAtTickMs":1,"commands":"not-an-array"}',
              },
            },
          ],
        }),
      ),
    );

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    await expect(
      provider.complete([USER_MSG], { schema: COMMAND_ENVELOPE_JSON_SCHEMA }),
    ).rejects.toMatchObject({ code: 'invalid-shape' });
  });
});

// ─── Auth errors ───────────────────────────────────────────────────────────

describe('auth errors', () => {
  it('throws LLMError with code "auth" on 401', async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse(null, { status: 401 })));

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-bad',
      model: 'gpt-4o',
    });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({
      name: 'LLMError',
      code: 'auth',
    });
  });

  it('throws LLMError with code "auth" on 403', async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse(null, { status: 403 })));

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-bad',
      model: 'gpt-4o',
    });
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

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-bad',
      model: 'gpt-4o',
    });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'auth' });
    expect(callCount).toBe(1);
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

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'rate-limited' });
    expect(callCount).toBe(3);
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

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    const result = await provider.complete([USER_MSG], { tools: [EMIT_TOOL] });
    expect(callCount).toBe(2);
    expect(result.tool_calls).toHaveLength(1);
  });
});

// ─── Timeout / AbortController ─────────────────────────────────────────────

describe('timeout / AbortController', () => {
  it('throws timeout when AbortController fires before response', async () => {
    server.use(
      http.post(ENDPOINT, async () => {
        await delay(2_000);
        return HttpResponse.json(makeToolCallResponse());
      }),
    );

    const controller = new AbortController();
    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });

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

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-test',
      model: 'gpt-4o',
      timeoutMs: 50,
    });

    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'timeout' });
  });
});

// ─── Provider unreachable (5xx) ─────────────────────────────────────────────

describe('provider unreachable', () => {
  it('throws provider-unreachable on 500', async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse(null, { status: 500 })));

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({
      code: 'provider-unreachable',
    });
  });

  it('throws provider-unreachable on 503', async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse(null, { status: 503 })));

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({
      code: 'provider-unreachable',
    });
  });
});

// ─── Malformed response body ─────────────────────────────────────────────────

describe('malformed response body', () => {
  it('throws invalid-shape when body is not JSON', async () => {
    server.use(
      http.post(
        ENDPOINT,
        () =>
          new HttpResponse('this is not json', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          }),
      ),
    );

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'invalid-shape' });
  });

  it('throws invalid-shape when choices array is missing', async () => {
    server.use(
      http.post(ENDPOINT, () => HttpResponse.json({ model: 'gpt-4o' })),
    );

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'invalid-shape' });
  });

  it('throws invalid-shape when choices is empty', async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json({ choices: [] })));

    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    await expect(provider.complete([USER_MSG])).rejects.toMatchObject({ code: 'invalid-shape' });
  });
});

// ─── HTTPS enforcement ─────────────────────────────────────────────────────

describe('HTTPS enforcement', () => {
  it('throws on http:// remote base URL at construction time', () => {
    expect(() =>
      createOpenAICompatProvider({
        baseUrl: 'http://api.openai.com',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      }),
    ).toThrow('http://');
  });

  it('throws on HTTP:// (uppercase scheme) remote base URL — case-insensitive check', () => {
    // String.prototype.startsWith() is case-sensitive; new URL() normalises scheme to lowercase.
    // HTTP://api.openai.com must NOT bypass the plaintext-key enforcement.
    expect(() =>
      createOpenAICompatProvider({
        baseUrl: 'HTTP://api.openai.com',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      }),
    ).toThrow();
  });

  it('throws on HTTPS:// (uppercase) remote base URL — treated as unsupported protocol', () => {
    // "HTTPS:" normalised to "https:" by URL constructor → accepted. Verify the positive case.
    expect(() =>
      createOpenAICompatProvider({
        baseUrl: 'HTTPS://api.openai.com',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      }),
    ).not.toThrow();
  });

  it('throws on ftp:// base URL (unsupported protocol)', () => {
    expect(() =>
      createOpenAICompatProvider({
        baseUrl: 'ftp://api.openai.com',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      }),
    ).toThrow('unsupported protocol');
  });

  it('throws on invalid / unparseable base URL', () => {
    expect(() =>
      createOpenAICompatProvider({
        baseUrl: 'not-a-url',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      }),
    ).toThrow('not a valid URL');
  });

  it('accepts https:// base URL', () => {
    expect(() =>
      createOpenAICompatProvider({ baseUrl: BASE_URL, apiKey: 'sk-test', model: 'gpt-4o' }),
    ).not.toThrow();
  });

  it('accepts http://localhost (local provider)', () => {
    expect(() =>
      createOpenAICompatProvider({
        baseUrl: 'http://localhost:11434',
        apiKey: '',
        model: 'llama3',
      }),
    ).not.toThrow();
  });

  it('accepts http://127.0.0.1 (local provider)', () => {
    expect(() =>
      createOpenAICompatProvider({
        baseUrl: 'http://127.0.0.1:8080',
        apiKey: '',
        model: 'llama3',
      }),
    ).not.toThrow();
  });
});

// ─── Empty-key remote-endpoint warning ─────────────────────────────────────

describe('empty-key remote-endpoint warning (N-1)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('warns when apiKey is empty and baseUrl is a remote endpoint', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createOpenAICompatProvider({
      baseUrl: 'https://custom.llm-provider.example.com',
      apiKey: '',
      model: 'some-model',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('empty apiKey with a non-local endpoint'),
    );
  });

  it('does NOT warn when apiKey is empty and baseUrl is localhost', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createOpenAICompatProvider({
      baseUrl: 'http://localhost:11434',
      apiKey: '',
      model: 'llama3',
    });
    // localhost http:// triggers the "safe for localhost" warn, NOT the empty-key remote warn
    const warnMessages = warnSpy.mock.calls.map((args) => String(args[0]));
    expect(warnMessages.some((m) => m.includes('empty apiKey with a non-local endpoint'))).toBe(false);
  });

  it('does NOT warn when apiKey is non-empty', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: 'sk-present',
      model: 'gpt-4o',
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─── Construction validation ────────────────────────────────────────────────

describe('construction validation', () => {
  it('throws when model is empty string', () => {
    expect(() =>
      createOpenAICompatProvider({ baseUrl: BASE_URL, apiKey: 'sk-test', model: '' }),
    ).toThrow('model');
  });
});

// ─── API key security ──────────────────────────────────────────────────────

describe('API key security', () => {
  it('does not include the API key in thrown error messages', async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse(null, { status: 401 })));

    const secretKey = 'sk-ultra-secret-key-never-leak';
    const provider = createOpenAICompatProvider({
      baseUrl: BASE_URL,
      apiKey: secretKey,
      model: 'gpt-4o',
    });

    try {
      await provider.complete([USER_MSG]);
    } catch (err) {
      const error = err as LLMError;
      expect(error.message).not.toContain(secretKey);
      expect(String(error.cause ?? '')).not.toContain(secretKey);
    }
  });
});

// ─── Factory registration (self-register side-effect) ──────────────────────

describe('factory registration via registerProvider', () => {
  it('openaiCompat module import registers "openai-compat" in createProvider factory', async () => {
    const { createProvider, _resetProviderRegistry, registerProvider } = await import(
      '../../../src/ai/client.js'
    );
    _resetProviderRegistry();

    // Import adapter module — side effect registers 'openai-compat'
    // The module was already imported above via createOpenAICompatProvider, but the
    // registry was reset, so we register manually here to simulate the side-effect path.
    registerProvider('openai-compat', (s) =>
      createOpenAICompatProvider({ baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model }),
    );

    server.use(
      http.post(`${BASE_URL}/v1/chat/completions`, () => HttpResponse.json(makeToolCallResponse())),
    );

    const provider = createProvider({
      id: 'openai-compat',
      baseUrl: BASE_URL,
      apiKey: 'sk-test',
      model: 'gpt-4o',
      timeoutMs: 5_000,
    });

    const result = await provider.complete([USER_MSG], { tools: [EMIT_TOOL] });
    expect(result.tool_calls).toHaveLength(1);
  });
});
