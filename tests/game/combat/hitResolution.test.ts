import { describe, it, expect } from 'vitest'
import { computeHitCenter } from '../../../src/game/combat/hitResolution'

const REACH = 1.5
const ORIGIN = { x: 0, y: 0, z: 0 }

describe('computeHitCenter — aim resolution follows camera yaw', () => {
  it('yaw=0 places hit-sphere forward along +Z', () => {
    const { x, y, z } = computeHitCenter(ORIGIN, 0, REACH)
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
    expect(z).toBeCloseTo(REACH)
  })

  it('yaw=π places hit-sphere behind player (camera turned 180°)', () => {
    // Core regression: mesh faces +Z from prior movement; camera looks -Z.
    // Hit sphere must follow camera, not mesh.
    const { x, y, z } = computeHitCenter(ORIGIN, Math.PI, REACH)
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
    expect(z).toBeCloseTo(-REACH)
  })

  it('yaw=π/2 places hit-sphere to the right (+X)', () => {
    const { x, z } = computeHitCenter(ORIGIN, Math.PI / 2, REACH)
    expect(x).toBeCloseTo(REACH)
    expect(z).toBeCloseTo(0)
  })

  it('hit-sphere Y equals player Y (no vertical offset)', () => {
    const pos = { x: 5, y: 3.2, z: -2 }
    const { y } = computeHitCenter(pos, 0.7, REACH)
    expect(y).toBe(pos.y)
  })

  it('non-zero player position is correctly offset', () => {
    const pos = { x: 10, y: 0, z: -5 }
    const yaw = Math.PI / 4 // 45° — fwdX = fwdZ = sin(π/4) ≈ 0.7071
    const { x, z } = computeHitCenter(pos, yaw, REACH)
    expect(x).toBeCloseTo(pos.x + Math.sin(yaw) * REACH)
    expect(z).toBeCloseTo(pos.z + Math.cos(yaw) * REACH)
  })
})
