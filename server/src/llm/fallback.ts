import type { AgentCommand, FactionId } from './types'

// Scripted fallback commands per faction — deterministic, no LLM required
const FALLBACK_COMMANDS: Record<FactionId, AgentCommand> = {
  elves: { kind: 'patrol', pathId: 'p_elf_perimeter', speed: 'normal' },
  'palace-guard': { kind: 'patrol', pathId: 'p_palace_wall', speed: 'slow' },
  villain: { kind: 'idle', reason: 'awaiting orders' },
}

export function scriptedFallback(faction: FactionId): AgentCommand {
  return FALLBACK_COMMANDS[faction] ?? { kind: 'idle', reason: 'awaiting orders' }
}
