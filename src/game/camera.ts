import * as THREE from 'three'
import { playerConfig as cfg } from './playerConfig'

export type ThirdPersonCamera = {
  /** Update camera position + orientation every frame. Call after player.update(). */
  update(dt: number, targetPosition: THREE.Vector3): void
  /** Accumulate raw mouse-delta input (pixels). Call from pointerlockchange handler. */
  onMouseMove(dx: number, dy: number): void
  /** Current camera yaw angle in radians (for forwarding to player movement). */
  get yaw(): number
}

const _origin = new THREE.Vector3()
const _dir = new THREE.Vector3()

/**
 * Third-person camera that orbits the player.
 * Smoothly follows the target position and avoids clipping into walls
 * by pulling the camera forward along the target→camera ray.
 */
export function createThirdPersonCamera(
  camera: THREE.PerspectiveCamera,
  scene: THREE.Scene,
): ThirdPersonCamera {
  let _yaw = 0
  let _pitch = 0.3 // slight downward angle on start
  const _smoothTarget = new THREE.Vector3()
  let _initialized = false

  function onMouseMove(dx: number, dy: number): void {
    _yaw -= dx * cfg.cameraYawSensitivity
    _pitch -= dy * cfg.cameraPitchSensitivity
    _pitch = Math.max(cfg.cameraPitchMin, Math.min(cfg.cameraPitchMax, _pitch))
  }

  function update(dt: number, targetPosition: THREE.Vector3): void {
    // pivot point above player base
    _origin.copy(targetPosition)
    _origin.y += cfg.cameraHeightOffset

    // on first call, snap smooth target to avoid interpolation from origin
    if (!_initialized) {
      _smoothTarget.copy(_origin)
      _initialized = true
    }

    // exponential smooth follow of the pivot
    const alpha = 1 - Math.exp(-cfg.cameraSmoothFactor * dt)
    _smoothTarget.lerp(_origin, alpha)

    // spherical offset from pivot
    const cosP = Math.cos(_pitch)
    _dir.set(Math.sin(_yaw) * cosP, Math.sin(_pitch), Math.cos(_yaw) * cosP)

    // wall-clip avoidance: raycast from pivot toward camera
    const maxDist = wallClipDistance(scene, _smoothTarget, _dir, cfg.cameraDistance)
    const safeDistance = Math.max(cfg.cameraMinDistance, maxDist - 0.15)

    camera.position.copy(_smoothTarget).addScaledVector(_dir, safeDistance)
    camera.lookAt(_smoothTarget)
  }

  return {
    update,
    onMouseMove,
    get yaw(): number {
      return _yaw
    },
  }
}

/**
 * Returns the safe camera distance (≤ maxDist) to avoid wall clipping.
 * Casts a ray from `origin` in direction `dir`; if it hits within `maxDist`
 * the camera pulls in by `hitDistance`.
 *
 * Uses Three.js Raycaster against scene children — lightweight for a handful
 * of static meshes, and avoids a second Rapier dependency here.
 */
const _raycaster = new THREE.Raycaster()

export function wallClipDistance(
  scene: THREE.Scene,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
): number {
  _raycaster.set(origin, dir)
  _raycaster.far = maxDist

  // Only test meshes that receive shadows (i.e. static world geometry).
  const targets = scene.children.filter((o) => (o as THREE.Mesh).receiveShadow)
  const hits = _raycaster.intersectObjects(targets, true)

  if (hits.length === 0) return maxDist
  return hits[0].distance
}

/**
 * Pure math: given a target position and spherical angles, return where
 * the camera should sit at exactly `distance` without any scene context.
 * Used by unit tests to verify the follow math is correct.
 */
export function cameraIdealPosition(
  target: THREE.Vector3,
  yaw: number,
  pitch: number,
  distance: number,
  heightOffset: number,
): THREE.Vector3 {
  const pivot = target.clone()
  pivot.y += heightOffset

  const cosP = Math.cos(pitch)
  const dir = new THREE.Vector3(Math.sin(yaw) * cosP, Math.sin(pitch), Math.cos(yaw) * cosP)

  return pivot.clone().addScaledVector(dir, distance)
}
