import { describe, it, expect } from 'vitest'
import { HOUSE_PLACEMENTS } from '../../src/scene/houses.js'

describe('HOUSE_PLACEMENTS', () => {
  it('defines exactly 8 placements', () => {
    expect(HOUSE_PLACEMENTS).toHaveLength(8)
  })

  it('all placements have a scale in [0.85, 1.15]', () => {
    for (const p of HOUSE_PLACEMENTS) {
      expect(p.scale).toBeGreaterThanOrEqual(0.85)
      expect(p.scale).toBeLessThanOrEqual(1.15)
    }
  })

  it('all placements are placed on the ground (y=0)', () => {
    for (const p of HOUSE_PLACEMENTS) {
      expect(p.position[1]).toBe(0)
    }
  })

  it('uses at least 3 distinct rotationY values (3 visual variants)', () => {
    const uniqueRotations = new Set(HOUSE_PLACEMENTS.map((p) => p.rotationY.toFixed(4)))
    expect(uniqueRotations.size).toBeGreaterThanOrEqual(3)
  })

  it('houses form a cluster (all within 30 m of each other in xz)', () => {
    const xs = HOUSE_PLACEMENTS.map((p) => p.position[0])
    const zs = HOUSE_PLACEMENTS.map((p) => p.position[2])
    const xSpan = Math.max(...xs) - Math.min(...xs)
    const zSpan = Math.max(...zs) - Math.min(...zs)
    expect(xSpan).toBeLessThanOrEqual(30)
    expect(zSpan).toBeLessThanOrEqual(30)
  })
})
