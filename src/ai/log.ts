import { redactProviderSettings } from './types';
import type { LLMError } from './types';
import type { ProviderSettings } from './types';

/**
 * Sanctioned path for surfacing LLMError to logs (BOO-408 O4).
 * Logs code + retryAfterMs + redacted provider — intentionally omits
 * err.message and err.stack so a buggy adapter cannot leak auth context.
 * AgentRouter (BOO-390) MUST use this; raw error logging is rejected at PR review.
 */
export function safeLogLLMError(err: LLMError, settings: ProviderSettings): void {
  console.warn('[ai] LLMError', {
    code: err.code,
    retryAfterMs: err.retryAfterMs,
    provider: redactProviderSettings(settings),
    // intentionally: NO err.message, NO err.stack
  });
}
