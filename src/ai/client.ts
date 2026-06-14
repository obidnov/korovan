import type { CompleteOpts, LLMProvider, LLMResponse, Message, ProviderSettings } from './types'
import { LLMError } from './types'

type ProviderFactory = (settings: ProviderSettings) => LLMProvider

const _registry = new Map<string, ProviderFactory>()

/** Register a concrete adapter. Called by adapter modules at import time (e.g. DeepSeek, BOO-394). */
export function registerProvider(id: string, factory: ProviderFactory): void {
  _registry.set(id, factory)
}

/** For unit tests only — never call in production code. */
export function _resetProviderRegistry(): void {
  _registry.clear()
}

function withTimeout(provider: LLMProvider, defaultTimeoutMs: number): LLMProvider {
  return {
    complete(messages: Message[], opts?: CompleteOpts): Promise<LLMResponse> {
      const ms = opts?.timeoutMs ?? defaultTimeoutMs
      let timerId!: ReturnType<typeof setTimeout>

      const timerP = new Promise<never>((_, reject) => {
        timerId = setTimeout(
          () => reject(new LLMError('timeout', `Provider timed out after ${ms}ms`)),
          ms,
        )
      })

      return Promise.race([provider.complete(messages, opts), timerP]).finally(() =>
        clearTimeout(timerId),
      )
    },
  }
}

/**
 * Create an LLMProvider from settings. Dispatches on `settings.id`.
 *
 * Throws `LLMError('provider-unreachable')` when no adapter is registered for the given id.
 * In P1 only 'deepseek' will be registered (by the DeepSeek adapter, BOO-394).
 * AgentRouter catches the error and routes to scripted fallback.
 */
export function createProvider(settings: ProviderSettings): LLMProvider {
  const factory = _registry.get(settings.id)
  if (!factory) {
    throw new LLMError('provider-unreachable', `Unsupported provider: ${settings.id}`)
  }
  return withTimeout(factory(settings), settings.timeoutMs)
}
