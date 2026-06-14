import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { cameraIdealPosition, wallClipDistance } from '../../src/game/camera'
import { playerConfig as cfg } from '../../src/game/playerConfig'

describe('cameraIdealPosition', () => {
  it('places camera directly behind player at yaw=0 pitch=0', () => {
    const target = new THREE.Vector3(0, 0, 0)
    const pos = cameraIdealPosition(target, 0, 0, cfg.cameraDistance, cfg.cameraHeightOffset)

    // yaw=0, pitch=0 → dir = (0, 0, 1) → camera at (0, heightOffset, cameraDistance)
    expect(pos.x).toBeCloseTo(0, 5)
    expect(pos.y).toBeCloseTo(cfg.cameraHeightOffset, 5)
    expect(pos.z).toBeCloseTo(cfg.cameraDistance, 5)
  })

  it('respects height offset from pivot', () => {
    const target = new THREE.Vector3(0, 5, 0) // elevated player
    const pos = cameraIdealPosition(target, 0, 0, cfg.cameraDistance, cfg.cameraHeightOffset)

    expect(pos.y).toBeCloseTo(5 + cfg.cameraHeightOffset, 5)
  })

  it('is exactly cameraDistance away from pivot at any yaw', () => {
    const target = new THREE.Vector3(3, 0, 7)
    const yaws = [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]
    const pivot = target.clone()
    pivot.y += cfg.cameraHeightOffset

    for (const yaw of yaws) {
      const pos = cameraIdealPosition(target, yaw, 0, cfg.cameraDistance, cfg.cameraHeightOffset)
      const dist = pos.distanceTo(pivot)
      expect(dist).toBeCloseTo(cfg.cameraDistance, 4)
    }
  })

  it('is exactly cameraDistance away from pivot at various pitches', () => {
    const target = new THREE.Vector3(0, 0, 0)
    const pitches = [cfg.cameraPitchMin, 0, 0.5, cfg.cameraPitchMax]
    const pivot = target.clone()
    pivot.y += cfg.cameraHeightOffset

    for (const pitch of pitches) {
      const pos = cameraIdealPosition(target, 0, pitch, cfg.cameraDistance, cfg.cameraHeightOffset)
      const dist = pos.distanceTo(pivot)
      expect(dist).toBeCloseTo(cfg.cameraDistance, 4)
    }
  })

  it('camera is above pivot when pitch > 0', () => {
    const target = new THREE.Vector3(0, 0, 0)
    const pos = cameraIdealPosition(target, 0, 0.5, cfg.cameraDistance, cfg.cameraHeightOffset)
    const pivotY = cfg.cameraHeightOffset
    expect(pos.y).toBeGreaterThan(pivotY)
  })

  it('camera is below pivot when pitch < 0', () => {
    const target = new THREE.Vector3(0, 0, 0)
    const pos = cameraIdealPosition(target, 0, -0.3, cfg.cameraDistance, cfg.cameraHeightOffset)
    const pivotY = cfg.cameraHeightOffset
    expect(pos.y).toBeLessThan(pivotY)
  })

  it('yaw=PI places camera in front of player', () => {
    const target = new THREE.Vector3(0, 0, 0)
    const posBack = cameraIdealPosition(target, 0, 0, cfg.cameraDistance, cfg.cameraHeightOffset)
    const posFront = cameraIdealPosition(target, Math.PI, 0, cfg.cameraDistance, cfg.cameraHeightOffset)

    // front/back are symmetric: same x (≈0), same y, opposite z
    expect(posBack.z).toBeCloseTo(-posFront.z, 4)
    expect(posBack.x).toBeCloseTo(posFront.x, 4)
  })
})

describe('wallClipDistance', () => {
  it('returns maxDist when scene has no shadow-receiving meshes', () => {
    const scene = new THREE.Scene()
    const origin = new THREE.Vector3(0, 2, 0)
    const dir = new THREE.Vector3(0, 0, 1)
    const maxDist = 6

    const d = wallClipDistance(scene, origin, dir, maxDist)
    expect(d).toBe(maxDist)
  })

  it('returns reduced distance when a mesh blocks the ray', () => {
    const scene = new THREE.Scene()
    // Place a wall at z=3 (1m thick)
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(10, 10, 1),
      new THREE.MeshStandardMaterial(),
    )
    wall.position.set(0, 0, 3.5) // front face at z=3
    wall.receiveShadow = true
    scene.add(wall)
    // In JSDOM there is no renderer to trigger matrix updates; do it manually.
    scene.updateMatrixWorld(true)

    const origin = new THREE.Vector3(0, 0, 0)
    const dir = new THREE.Vector3(0, 0, 1)
    const maxDist = 6

    const d = wallClipDistance(scene, origin, dir, maxDist)
    expect(d).toBeCloseTo(3, 0) // hit front face ≈ 3 m away
    expect(d).toBeLessThan(maxDist)
  })

  it('ignores non-shadow-receiving meshes (non-static world geometry)', () => {
    const scene = new THREE.Scene()
    // Dynamic object in the way — does NOT receive shadows
    const dyn = new THREE.Mesh(
      new THREE.BoxGeometry(10, 10, 1),
      new THREE.MeshStandardMaterial(),
    )
    dyn.position.set(0, 0, 3.5)
    dyn.receiveShadow = false // explicitly non-static
    scene.add(dyn)

    const d = wallClipDistance(scene, new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 6)
    expect(d).toBe(6)
  })
})
