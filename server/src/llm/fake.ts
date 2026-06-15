// FakeProvider — test seam for Vitest.
// Allows EP-3 and BC-3 tests to run without hitting DeepSeek.
// Shape defined by FakeProviderConfig in types.ts.

import type {
  LLMProvider,
  DecideInput,
  DecideOutput,
  PingResult,
  FakeProviderConfig,
} from './types.js'
import { LLMProviderError } from './types.js'

const DEFAULT_COMMAND: DecideOutput = {
  command: { kind: 'idle', reason: 'fake provider default' },
  updatedSessionState: {
    sessionId: 'fake-session',
    factionId: 'elves',
    ticksSinceStart: 0,
    providerContext: null,
  },
}

export function createFakeProvider(config: FakeProviderConfig = {}): LLMProvider {
  const { response = DEFAULT_COMMAND, errorToThrow, pingLatencyMs = 1 } = config

  return {
    name: 'fake',

    async decide(_input: DecideInput): Promise<DecideOutput> {
      if (errorToThrow) throw errorToThrow
      return response
    },

    async ping(): Promise<PingResult> {
      await sleep(pingLatencyMs)
      if (errorToThrow) {
        return { ok: false, latencyMs: pingLatencyMs, error: errorToThrow.message }
      }
      return { ok: true, latencyMs: pingLatencyMs }
    },
  }
}

/** Creates a FakeProvider wired to throw the given error from decide(). */
export function createFailingFakeProvider(
  code: LLMProviderError['code'],
  message = `fake ${code} error`,
): LLMProvider {
  return createFakeProvider({
    errorToThrow: new LLMProviderError(code, message),
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
