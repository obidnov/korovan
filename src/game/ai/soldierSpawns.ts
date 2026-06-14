/**
 * Palace soldier spawn configurations — forest patrol positions.
 *
 * Positions are approximate forest-area coordinates on the flat terrain.
 * When the save-schema (BOO-379) integrates, these will be loaded from the
 * save file instead; the SoldierEntityConfig shape is already save-compatible.
 */

import type { SoldierEntityConfig } from './soldierEntity'

export const SOLDIER_SPAWNS: readonly SoldierEntityConfig[] = [
  {
    id: 'soldier-0',
    startPosition: { x: -15, y: 0, z: -15 },
    waypoints: [
      { x: -15, y: 0, z: -10 },
      { x: -10, y: 0, z: -22 },
      { x: -22, y: 0, z: -20 },
      { x: -18, y: 0, z: -12 },
    ],
  },
  {
    id: 'soldier-1',
    startPosition: { x: 5, y: 0, z: -22 },
    waypoints: [
      { x: 5, y: 0, z: -15 },
      { x: 15, y: 0, z: -25 },
      { x: 8, y: 0, z: -35 },
      { x: -2, y: 0, z: -28 },
    ],
  },
  {
    id: 'soldier-2',
    startPosition: { x: -5, y: 0, z: -32 },
    waypoints: [
      { x: -14, y: 0, z: -26 },
      { x: 0, y: 0, z: -38 },
      { x: 8, y: 0, z: -28 },
      { x: -4, y: 0, z: -22 },
    ],
  },
]
