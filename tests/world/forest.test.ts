import { describe, it, expect } from 'vitest'
import { generateTreeLayout } from '../../src/world/forest'

describe('generateTreeLayout — determinism', () => {
  it('same (count, radius, seed) → identical positions', () => {
    const a = generateTreeLayout(500, 200, 42)
    const b = generateTreeLayout(500, 200, 42)
    expect(a).toEqual(b)
  })

  it('different seed → different positions', () => {
    const a = generateTreeLayout(50, 100, 1)
    const b = generateTreeLayout(50, 100, 2)
    expect(a).not.toEqual(b)
  })

  it('returns exactly the requested count', () => {
    expect(generateTreeLayout(1, 100, 0)).toHaveLength(1)
    expect(generateTreeLayout(500, 100, 0)).toHaveLength(500)
    expect(generateTreeLayout(6_000, 200, 0)).toHaveLength(6_000)
  })

  it('all positions lie within worldRadius', () => {
    const R = 150
    const layout = generateTreeLayout(2_000, R, 99)
    for (const [x, z] of layout) {
      // sqrt may introduce tiny fp error; allow 1e-9 slop
      expect(Math.sqrt(x * x + z * z)).toBeLessThanOrEqual(R + 1e-9)
    }
  })

  it('positions are unique (no degenerate collapse)', () => {
    const layout = generateTreeLayout(200, 100, 7)
    const keys = new Set(layout.map(([x, z]) => `${x},${z}`))
    expect(keys.size).toBe(200)
  })

  it('seed 0 is stable across calls (regression pin)', () => {
    // Pinned positions from mulberry32(0) — guards against PRNG regressions.
    const [[x0, z0], [x1, z1]] = generateTreeLayout(2, 100, 0)
    expect(x0).toBeCloseTo(-0.19, 1)
    expect(z0).toBeCloseTo(1.81, 1)
    expect(x1).toBeCloseTo(6.39, 1)
    expect(z1).toBeCloseTo(37.70, 1)
  })
})
