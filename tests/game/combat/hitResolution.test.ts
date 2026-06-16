import { describe, it, expect } from 'vitest'
import { computeHitCenter } from '../../../src/game/combat/hitResolution'

const REACH = 1.5
const ORIGIN = { x: 0, y: 0, z: 0 }

describe('computeHitCenter — aim resolution follows camera yaw', () => {
  it('cameraYaw=0 (camera behind player at +Z) places hit-sphere in front of player (-Z)', () => {
    // Regression: camera at yaw=0 orbits to +Z relative to player (camera.ts line 53).
    // Player aims away from camera → hit sphere must be at -Z, not +Z.
    const { x, y, z } = computeHitCenter(ORIGIN, 0, REACH)
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
    expect(z).toBeCloseTo(-REACH)
  })

  it('cameraYaw=π (camera panned 180°, now in front at -Z) places hit-sphere behind player (+Z)', () => {
    // Core BOO-439 regression: mesh faces +Z from prior movement; player pans camera 180°.
    // Camera is now at -Z (in front of player), so player aims +Z.
    // Hit sphere must follow camera-aim, not mesh-facing.
    const { x, y, z } = computeHitCenter(ORIGIN, Math.PI, REACH)
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
    expect(z).toBeCloseTo(REACH)
  })

  it('cameraYaw=π/2 (camera to the right at +X) places hit-sphere to the left (-X)', () => {
    const { x, z } = computeHitCenter(ORIGIN, Math.PI / 2, REACH)
    expect(x).toBeCloseTo(-REACH)
    expect(z).toBeCloseTo(0)
  })

  it('hit-sphere Y equals player Y (no vertical offset)', () => {
    const pos = { x: 5, y: 3.2, z: -2 }
    const { y } = computeHitCenter(pos, 0.7, REACH)
    expect(y).toBe(pos.y)
  })

  it('non-zero player position is correctly offset', () => {
    const pos = { x: 10, y: 0, z: -5 }
    const yaw = Math.PI / 4 // 45° camera orbit — player aims into the opposite quadrant
    const { x, z } = computeHitCenter(pos, yaw, REACH)
    expect(x).toBeCloseTo(pos.x - Math.sin(yaw) * REACH)
    expect(z).toBeCloseTo(pos.z - Math.cos(yaw) * REACH)
  })
})
