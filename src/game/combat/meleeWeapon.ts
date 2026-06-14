/**
 * Melee weapon — sword swing state machine + Three.js mesh.
 *
 * Two exports:
 *   createMeleeWeaponFsm()  — pure swing FSM (no engine deps, fully testable)
 *   createMeleeWeapon()     — Three.js wrapper that attaches sword mesh to player
 */

import * as THREE from 'three'

// ---------------------------------------------------------------------------
// Pure FSM (no engine deps)
// ---------------------------------------------------------------------------

export type SwingState = 'idle' | 'windup' | 'active' | 'recovery'

/** Timing in seconds for each swing phase. */
export const SWING_TIMING = {
  windup: 0.15,
  active: 0.20,
  recovery: 0.35,
} as const

export interface MeleeWeaponFsm {
  readonly state: SwingState
  /**
   * Advance FSM by dt seconds.
   * @returns true on the exact first frame entering 'active' (hit window opens).
   * Caller should run hit-detection when this returns true.
   */
  tick(dt: number, attackPressed: boolean): boolean
}

export function createMeleeWeaponFsm(): MeleeWeaponFsm {
  let state: SwingState = 'idle'
  let timer = 0

  return {
    get state() {
      return state
    },

    tick(dt: number, attackPressed: boolean): boolean {
      let hitThisFrame = false

      switch (state) {
        case 'idle':
          if (attackPressed) {
            state = 'windup'
            timer = 0
          }
          break

        case 'windup':
          timer += dt
          if (timer >= SWING_TIMING.windup) {
            state = 'active'
            timer = 0
            hitThisFrame = true // hit window opens right now
          }
          break

        case 'active':
          timer += dt
          if (timer >= SWING_TIMING.active) {
            state = 'recovery'
            timer = 0
          }
          break

        case 'recovery':
          timer += dt
          if (timer >= SWING_TIMING.recovery) {
            state = 'idle'
            timer = 0
            // Immediate re-trigger if attack is still held (no 1-frame gap)
            if (attackPressed) state = 'windup'
          }
          break
      }

      return hitThisFrame
    },
  }
}

// ---------------------------------------------------------------------------
// Three.js weapon entity
// ---------------------------------------------------------------------------

export interface MeleeWeapon {
  readonly fsm: MeleeWeaponFsm
  readonly mesh: THREE.Object3D
  /**
   * Advance weapon by dt. Internally advances FSM and updates sword rotation.
   * @returns true on the frame the active hit-window opens (do hit-detection now).
   */
  tick(dt: number, attackPressed: boolean): boolean
  dispose(): void
}

function buildSwordMesh(): THREE.Object3D {
  const group = new THREE.Group()

  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xd0d0d0,
    metalness: 0.9,
    roughness: 0.15,
  })
  const guardMat = new THREE.MeshStandardMaterial({
    color: 0xb8860b,
    metalness: 0.7,
    roughness: 0.4,
  })

  // Blade (elongated thin box — CC0 placeholder)
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.025), bladeMat)
  blade.position.y = 0.37
  blade.castShadow = true
  group.add(blade)

  // Cross-guard
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.04), guardMat)
  guard.castShadow = true
  group.add(guard)

  // Handle
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.04), guardMat)
  handle.position.y = -0.13
  group.add(handle)

  // Pommel
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), guardMat)
  pommel.position.y = -0.26
  group.add(pommel)

  return group
}

/** Sword local-rotation X angle per swing state (radians). */
const SWING_ANGLE_X: Record<SwingState, number> = {
  idle: -0.3,
  windup: -1.2,
  active: 0.9,
  recovery: -0.3,
}

/** Lerp speed for visual angle transition. */
const ANGLE_LERP = 14

/**
 * Attach a sword mesh to the player mesh at the right-hand position.
 * The sword is added as a child of `playerMesh` so it follows player transforms.
 */
export function createMeleeWeapon(playerMesh: THREE.Object3D): MeleeWeapon {
  const fsm = createMeleeWeaponFsm()
  const mesh = buildSwordMesh()

  // Right-hand position in player local space
  mesh.position.set(0.32, 1.0, -0.15)
  mesh.rotation.set(SWING_ANGLE_X.idle, 0, -0.15)

  playerMesh.add(mesh)

  let currentAngleX = SWING_ANGLE_X.idle

  return {
    fsm,
    mesh,

    tick(dt: number, attackPressed: boolean): boolean {
      const hitThisFrame = fsm.tick(dt, attackPressed)

      // Smooth visual swing (lerp toward target angle)
      const targetX = SWING_ANGLE_X[fsm.state]
      currentAngleX += (targetX - currentAngleX) * Math.min(1, dt * ANGLE_LERP)
      mesh.rotation.x = currentAngleX

      return hitThisFrame
    },

    dispose(): void {
      playerMesh.remove(mesh)
    },
  }
}
