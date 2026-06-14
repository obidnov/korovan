import { describe, it, expect } from 'vitest';
import {
  type LLMProvider,
  type Message,
  type LLMResponse,
  type CompleteOpts,
  type FactionCommand,
  type CommandEnvelope,
  type ProviderSettings,
  type LLMErrorCode,
  LLMError,
  redactProviderSettings,
} from '../../src/ai/types';

// ---------------------------------------------------------------------------
// Fake provider implementation used across all tests
// ---------------------------------------------------------------------------

class FakeLLMProvider implements LLMProvider {
  constructor(private readonly behaviour: () => Promise<LLMResponse>) {}

  complete(_messages: Message[], _opts?: CompleteOpts): Promise<LLMResponse> {
    return this.behaviour();
  }
}

const userMsg: Message = { role: 'user', content: 'Issue orders for the next tick.' };

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('LLMProvider — happy path', () => {
  it('returns text content', async () => {
    const provider = new FakeLLMProvider(() =>
      Promise.resolve({ content: 'Hold position.', tool_calls: undefined }),
    );
    const res = await provider.complete([userMsg]);
    expect(res.content).toBe('Hold position.');
    expect(res.tool_calls).toBeUndefined();
  });

  it('returns tool_calls for structured command', async () => {
    const toolCall = {
      id: 'tc-1',
      type: 'function' as const,
      function: { name: 'issue_commands', arguments: '{"commands":[]}' },
    };
    const provider = new FakeLLMProvider(() =>
      Promise.resolve({ content: null, tool_calls: [toolCall] }),
    );
    const res = await provider.complete([userMsg], {
      tools: [
        {
          type: 'function',
          function: {
            name: 'issue_commands',
            description: 'Issue faction commands for this tick.',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    });
    expect(res.tool_calls).toHaveLength(1);
    expect(res.tool_calls?.[0].function.name).toBe('issue_commands');
  });
});

// ---------------------------------------------------------------------------
// Error taxonomy — each code
// ---------------------------------------------------------------------------

const errorCases: Array<{ code: LLMErrorCode; retryAfterMs?: number }> = [
  { code: 'auth' },
  { code: 'rate-limited', retryAfterMs: 5000 },
  { code: 'timeout' },
  { code: 'network' },
  { code: 'provider-unreachable' },
  { code: 'invalid-shape' },
];

describe('LLMProvider — error taxonomy', () => {
  for (const { code, retryAfterMs } of errorCases) {
    it(`throws LLMError with code "${code}"`, async () => {
      const provider = new FakeLLMProvider(() =>
        Promise.reject(new LLMError(code, `Simulated ${code}`, retryAfterMs)),
      );
      await expect(provider.complete([userMsg])).rejects.toMatchObject({
        name: 'LLMError',
        code,
      });
    });
  }

  it('rate-limited carries retryAfterMs', async () => {
    const provider = new FakeLLMProvider(() =>
      Promise.reject(new LLMError('rate-limited', 'Too many requests', 3000)),
    );
    await expect(provider.complete([userMsg])).rejects.toMatchObject({
      code: 'rate-limited',
      retryAfterMs: 3000,
    });
  });
});

// ---------------------------------------------------------------------------
// FactionCommand exhaustive union
// ---------------------------------------------------------------------------

describe('FactionCommand union', () => {
  it('patrol command shape', () => {
    const cmd: FactionCommand = { type: 'patrol', targetZone: 'elf-forest', units: ['u1'] };
    expect(cmd.type).toBe('patrol');
  });

  it('raid command shape', () => {
    const cmd: FactionCommand = { type: 'raid', targetZone: 'palace', units: ['u2', 'u3'] };
    expect(cmd.type).toBe('raid');
  });

  it('noop command shape', () => {
    const cmd: FactionCommand = { type: 'noop', reason: 'No valid targets.' };
    expect(cmd.reason).toBe('No valid targets.');
  });
});

// ---------------------------------------------------------------------------
// CommandEnvelope
// ---------------------------------------------------------------------------

describe('CommandEnvelope', () => {
  it('holds multiple commands with tick timestamp', () => {
    const envelope: CommandEnvelope = {
      issuedAtTickMs: 12345,
      commands: [
        { type: 'patrol', targetZone: 'neutral', units: ['u1'] },
        { type: 'noop', reason: 'Holding.' },
      ],
    };
    expect(envelope.commands).toHaveLength(2);
    expect(envelope.issuedAtTickMs).toBe(12345);
  });
});

// ---------------------------------------------------------------------------
// ProviderSettings redaction
// ---------------------------------------------------------------------------

describe('redactProviderSettings', () => {
  const settings: ProviderSettings = {
    id: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKey: 'sk-secret-key-never-log-this',
    timeoutMs: 15000,
  };

  it('masks apiKey', () => {
    const redacted = redactProviderSettings(settings);
    expect(redacted.apiKey).toBe('***');
  });

  it('preserves all other fields', () => {
    const redacted = redactProviderSettings(settings);
    expect(redacted.id).toBe('deepseek');
    expect(redacted.baseUrl).toBe('https://api.deepseek.com');
    expect(redacted.model).toBe('deepseek-chat');
    expect(redacted.timeoutMs).toBe(15000);
  });

  it('does not mutate the original settings', () => {
    redactProviderSettings(settings);
    expect(settings.apiKey).toBe('sk-secret-key-never-log-this');
  });
});
