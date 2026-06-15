import type { CommandEnvelope } from './types'
import { LLMError } from './types'

export class AgentRateLimitedError extends Error {
  override readonly name = 'AgentRateLimitedError'
  constructor() {
    super('LLM rate limited — game-loop should use scripted fallback')
  }
}

export interface StrategicStateSnapshot {
  tickMs: number
  factionId: string
}

// AgentCommand = CommandEnvelope; named alias for the server-call contract
export type AgentCommand = CommandEnvelope

// Bootstrap re-flow hook injected by CR-5 (session bootstrap). Called on 401.
// No-op until CR-5 registers a real implementation.
let _bootstrapHook: (() => Promise<void>) | null = null

export function setBootstrapHook(fn: () => Promise<void>): void {
  _bootstrapHook = fn
}

export async function requestAgentDecision(input: {
  faction: string
  snapshot: StrategicStateSnapshot
}): Promise<{ command: AgentCommand; source: 'llm' | 'fallback' }> {
  return _doRequest(input, false)
}

async function _doRequest(
  input: { faction: string; snapshot: StrategicStateSnapshot },
  isRetry: boolean,
): Promise<{ command: AgentCommand; source: 'llm' | 'fallback' }> {
  let response: Response
  try {
    response = await fetch('/api/llm/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ faction: input.faction, snapshot: input.snapshot }),
    })
  } catch {
    throw new LLMError('network', 'Network error reaching /api/llm/decide')
  }

  if (response.status === 401) {
    if (!isRetry && _bootstrapHook !== null) {
      await _bootstrapHook()
      return _doRequest(input, true)
    }
    throw new LLMError('auth', '/api/llm/decide returned 401')
  }

  if (response.status === 429) {
    throw new AgentRateLimitedError()
  }

  if (!response.ok) {
    throw new LLMError(
      response.status >= 500 ? 'network' : 'provider-unreachable',
      `/api/llm/decide returned HTTP ${response.status}`,
    )
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new LLMError('invalid-shape', '/api/llm/decide returned non-JSON response')
  }

  if (
    !data ||
    typeof data !== 'object' ||
    !('command' in data) ||
    !('source' in data)
  ) {
    throw new LLMError('invalid-shape', '/api/llm/decide response missing command or source')
  }

  const typed = data as { command: unknown; source: unknown }
  if (typed.source !== 'llm' && typed.source !== 'fallback') {
    throw new LLMError(
      'invalid-shape',
      '/api/llm/decide response.source must be "llm" or "fallback"',
    )
  }

  // Never log command or snapshot — may contain sensitive game-state detail
  return { command: typed.command as AgentCommand, source: typed.source }
}
