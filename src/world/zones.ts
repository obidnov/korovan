/**
 * Zone definitions for the 4-zone overworld.
 * A2/A3/A4 will fill zone-specific terrain and assets.
 * A1 establishes the type contract and default spawn points.
 */

export const ZONE_IDS = ['elf-forest', 'neutral-humans', 'palace', 'villain-mountain'] as const
export type ZoneId = (typeof ZONE_IDS)[number]

export interface ZoneMeta {
  label: string
  description: string
  /** Map overlay position as percentage of the overworld map image dimensions */
  mapPos: { x: number; y: number }
  /** Per-zone fixed spawn (faction-aware spawn lands in A5) */
  defaultSpawn: { x: number; y: number; z: number }
  /** Background sky/fog color for stub scenes */
  skyColor: number
}

export const ZONE_META: Record<ZoneId, ZoneMeta> = {
  'elf-forest': {
    label: 'Elf Forest',
    description: 'Dense forest home of the woodland elves',
    mapPos: { x: 20, y: 62 },
    defaultSpawn: { x: 0, y: 2, z: 0 },
    skyColor: 0x1a2b1a,
  },
  'neutral-humans': {
    label: 'Neutral Humans',
    description: 'A trade hub where all factions meet in uneasy peace',
    mapPos: { x: 50, y: 48 },
    defaultSpawn: { x: 0, y: 2, z: 0 },
    skyColor: 0x4a7cb5,
  },
  palace: {
    label: "Emperor's Palace",
    description: "Seat of the Emperor's power and the palace guard",
    mapPos: { x: 74, y: 32 },
    defaultSpawn: { x: 0, y: 2, z: 0 },
    skyColor: 0x8ab5d4,
  },
  'villain-mountain': {
    label: 'Villain Mountain',
    description: 'Dark fortress in the crags, lair of the warlord',
    mapPos: { x: 82, y: 70 },
    defaultSpawn: { x: 0, y: 2, z: 0 },
    skyColor: 0x1a1014,
  },
}

export function isZoneId(v: unknown): v is ZoneId {
  return ZONE_IDS.includes(v as ZoneId)
}
