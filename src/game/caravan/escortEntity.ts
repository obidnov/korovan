/**
 * Escort entity — Three.js + Rapier binding for a caravan escort soldier.
 *
 * Wraps CartEscortFsm (pure logic) with engine-specific mesh + physics.
 * Reuses buildSoldierMesh() from soldierEntity for visual consistency.
 */

import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import {
  createCartEscortFsm,
  DEFAULT_ESCORT_CONFIG,
  type CartEscortFsm,
  type CartEscortFsmConfig,
  type EscortWorldSnapshot,
} from '../ai/cartEscortFsm'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EscortEntityConfig {
  id: string
  startPosition: { x: number; y: number; z: number }
  offset: { x: number; z: number }
  fsmOverrides?: Partial<Omit<CartEscortFsmConfig, 'id' | 'offset' | 'maxHp'>>
}

export interface EscortFrameInput {
  playerPosition: { x: number; z: number }
  cartPosition: { x: number; z: number }
}

export interface EscortEntity {
  readonly fsm: CartEscortFsm
  readonly mesh: THREE.Object3D
  tick(dt: number, input: EscortFrameInput): void
  takeDamage(amount: number): void
  dispose(scene: THREE.Scene, world: RAPIER.World): void
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEscortEntity(
  config: EscortEntityConfig,
  mesh: THREE.Object3D,
  scene: THREE.Scene,
  world: RAPIER.World,
): EscortEntity {
  const fsmConfig: CartEscortFsmConfig = {
    id: config.id,
    offset: config.offset,
    ...DEFAULT_ESCORT_CONFIG,
    ...config.fsmOverrides,
    maxHp: 50,
  }

  const fsm = createCartEscortFsm(fsmConfig, config.startPosition)

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      config.startPosition.x,
      config.startPosition.y,
      config.startPosition.z,
    ),
  )
  world.createCollider(
    RAPIER.ColliderDesc.capsule(0.55, 0.3),
    body,
  )

  scene.add(mesh)
  mesh.position.set(config.startPosition.x, config.startPosition.y, config.startPosition.z)

  let prevX = config.startPosition.x
  let prevZ = config.startPosition.z
  let dieElapsed = 0
  let enteredDie = false

  function tick(dt: number, input: EscortFrameInput): void {
    const world: EscortWorldSnapshot = {
      playerPosition: input.playerPosition,
      cartPosition: input.cartPosition,
    }

    fsm.tick(dt, world)

    const snap = fsm.getSnapshot()

    if (snap.stateId === 'die') {
      if (!enteredDie) {
        enteredDie = true
        dieElapsed = 0
      }
      dieElapsed += dt
      const progress = Math.min(1, dieElapsed / fsmConfig.dieDelay)
      mesh.scale.setScalar(Math.max(0.001, 1 - progress))
      return
    }

    if (snap.shouldRemove) return

    body.setNextKinematicTranslation(snap.position)
    mesh.position.set(snap.position.x, snap.position.y, snap.position.z)

    // Face direction of travel or toward player
    const dxPos = snap.position.x - prevX
    const dzPos = snap.position.z - prevZ
    if (dxPos * dxPos + dzPos * dzPos > 1e-5) {
      mesh.rotation.y = Math.atan2(dxPos, dzPos)
    } else if (snap.stateId === 'attack' || snap.stateId === 'chase') {
      const dxP = input.playerPosition.x - snap.position.x
      const dzP = input.playerPosition.z - snap.position.z
      if (dxP * dxP + dzP * dzP > 1e-5) {
        mesh.rotation.y = Math.atan2(dxP, dzP)
      }
    }

    prevX = snap.position.x
    prevZ = snap.position.z
  }

  function takeDamage(amount: number): void {
    fsm.takeDamage(amount)
  }

  function dispose(scene: THREE.Scene, world: RAPIER.World): void {
    scene.remove(mesh)
    world.removeRigidBody(body)
  }

  return { fsm, mesh, tick, takeDamage, dispose }
}
