import type { DecideInput, DecideOutput, LLMProvider } from './types'
import { LLMProviderError, type LLMProviderErrorCode } from './types'

export interface FakeProviderConfig {
  response?: DecideOutput
  errorCode?: LLMProviderErrorCode
  errorMessage?: string
  httpStatus?: number
}

/**
 * Configurable stub LLMProvider for Vitest tests.
 * Supports both success and error injection paths.
 */
export class FakeLLMProvider implements LLMProvider {
  readonly name = 'fake'
  private config: FakeProviderConfig

  constructor(config: FakeProviderConfig = {}) {
    this.config = config
  }

  configure(config: FakeProviderConfig): void {
    this.config = config
  }

  async decide(input: DecideInput): Promise<DecideOutput> {
    if (this.config.errorCode) {
      throw new LLMProviderError(
        this.config.errorCode,
        this.config.errorMessage ?? `fake ${this.config.errorCode}`,
        { httpStatus: this.config.httpStatus },
      )
    }
    if (this.config.response) {
      return this.config.response
    }
    // Default: valid patrol command
    return {
      command: { kind: 'patrol', pathId: 'p_default', speed: 'normal' },
      updatedSessionState: {
        ...input.sessionState,
        providerContext: null,
      },
      usage: { promptTokens: 100, completionTokens: 20 },
    }
  }
}
