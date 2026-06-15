// Scripted (rule-based) fallback LLM provider.
// Runs entirely in-process with no network calls; always returns a valid command.
// Used when: no LLM is configured, provider is unreachable, or response fails validation.

import type {
  LLMProvider,
  DecideInput,
  DecideOutput,
  PingResult,
  AgentCommand,
  StrategicStateSnapshot,
  FactionId,
  ZoneId,
} from './types.js'

// Known path/node IDs used in scripted decisions.
// Real IDs are server-controlled; these defaults match the P1 zone map.
const PATROL_PATH_BY_ZONE: Record<ZoneId, string> = {
  'elf-forest': 'path-elf-forest-perimeter',
  'palace': 'path-palace-outer-wall',
  'neutral': 'path-neutral-market',
  'villain-fort': 'path-villain-fort-rampart',
}

const HOME_NODE_BY_FACTION: Record<FactionId, string> = {
  elves: 'node-elf-camp',
  'palace-guard': 'node-palace-gate',
  villain: 'node-villain-throne',
}

export function createScriptedProvider(): LLMProvider {
  return {
    name: 'scripted',

    async decide(input: DecideInput): Promise<DecideOutput> {
      const command = pickCommand(input.snapshot, input.faction)
      return {
        command,
        updatedSessionState: {
          ...input.sessionState,
          ticksSinceStart: input.sessionState.ticksSinceStart + 1,
          providerContext: null, // scripted keeps no conversation history
        },
      }
    },

    async ping(): Promise<PingResult> {
      return { ok: true, latencyMs: 0 }
    },
  }
}

function pickCommand(
  snapshot: StrategicStateSnapshot,
  faction: FactionId,
): AgentCommand {
  const ownZone = snapshot.zones.find((z) => z.controlledBy === faction)

  // If a caravan is present in any zone, try to ambush it
  const caravanZone = snapshot.zones.find((z) => z.hasCaravan && z.controlledBy !== faction)
  if (caravanZone) {
    return {
      kind: 'ambush',
      nodeId: `node-${caravanZone.zoneId}-road`,
      durationSec: 60,
    }
  }

  // If under pressure (more enemies than own units in home zone), retreat
  if (ownZone) {
    const ownCount = ownZone.unitCount[faction] ?? 0
    const enemyTotal = (Object.keys(ownZone.unitCount) as FactionId[])
      .filter((f) => f !== faction)
      .reduce((sum, f) => sum + (ownZone.unitCount[f] ?? 0), 0)
    if (enemyTotal > ownCount) {
      return {
        kind: 'retreat',
        nodeId: HOME_NODE_BY_FACTION[faction],
      }
    }
  }

  // Default: patrol home zone
  const homeZoneId = ownZone?.zoneId ?? snapshot.zones[0]?.zoneId
  if (homeZoneId) {
    return {
      kind: 'patrol',
      pathId: PATROL_PATH_BY_ZONE[homeZoneId],
      speed: 'normal',
    }
  }

  return { kind: 'idle', reason: 'no actionable state' }
}
