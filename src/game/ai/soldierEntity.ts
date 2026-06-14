/**
 * Palace soldier — runtime entity binding Three.js + Rapier to the FSM.
 *
 * FSM logic lives in soldierFsm.ts (pure, no engine deps).
 * This module owns the mesh, physics collider, and per-frame integration.
 */

import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import {
  createSoldierFsm,
  DEFAULT_SOLDIER_CONFIG,
  type SoldierFsm,
  type SoldierFsmConfig,
  type WorldSnapshot,
} from './soldierFsm'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SoldierEntityConfig {
  id: string
  startPosition: { x: number; y: number; z: number }
  waypoints: Array<{ x: number; y: number; z: number }>
  fsmOverrides?: Partial<Omit<SoldierFsmConfig, 'id' | 'waypoints' | 'maxHp'>>
}

/** Input passed by main.ts each frame — lightweight; entity computes LOS itself. */
export interface EntityFrameInput {
  playerPosition: { x: number; y: number; z: number }
}

export interface SoldierEntity {
  readonly fsm: SoldierFsm
  readonly mesh: THREE.Object3D
  /** Update FSM + physics + visuals. Call once per game-loop tick. */
  tick(dt: number, input: EntityFrameInput): void
  /** Apply incoming damage. Delegates to fsm.takeDamage(). */
  takeDamage(amount: number): void
  /** Remove mesh and physics body. Call when fsm.getSnapshot().shouldRemove. */
  dispose(scene: THREE.Scene, world: RAPIER.World): void
}

// ---------------------------------------------------------------------------
// Mesh helpers
// ---------------------------------------------------------------------------

/** Fallback box-figure mesh for when soldier.glb is unavailable. */
export function buildSoldierMesh(): THREE.Object3D {
  const group = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: 0x8b0000, roughness: 0.55 })

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.3), mat)
  body.position.y = 0.5
  body.castShadow = true
  group.add(body)

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat)
  head.position.y = 1.25
  head.castShadow = true
  group.add(head)

  // Helmet brim (flat cylinder)
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 8), mat)
  brim.position.y = 1.3
  brim.castShadow = true
  group.add(brim)

  return group
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSoldierEntity(
  config: SoldierEntityConfig,
  mesh: THREE.Object3D,
  scene: THREE.Scene,
  world: RAPIER.World,
): SoldierEntity {
  const fsmConfig: SoldierFsmConfig = {
    id: config.id,
    waypoints: config.waypoints,
    ...DEFAULT_SOLDIER_CONFIG,
    ...config.fsmOverrides,
    maxHp: 50,
  }

  const fsm = createSoldierFsm(fsmConfig, config.startPosition)

  // Kinematic physics body — used for collision membership (other bodies push around it)
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      config.startPosition.x,
      config.startPosition.y,
      config.startPosition.z,
    ),
  )
  world.createCollider(
    RAPIER.ColliderDesc.capsule(0.55, 0.3), // halfHeight, radius
    body,
  )

  scene.add(mesh)
  mesh.position.set(config.startPosition.x, config.startPosition.y, config.startPosition.z)

  let prevX = config.startPosition.x
  let prevZ = config.startPosition.z
  let dieElapsed = 0
  let enteredDie = false

  function tick(dt: number, input: EntityFrameInput): void {
    // P1: line-of-sight approximated as always-visible when in range (flat terrain).
    // P2: replace with Rapier ray-cast from soldier eye-height toward player.
    const worldSnapshot: WorldSnapshot = {
      playerPosition: input.playerPosition,
      playerInLineOfSight: true,
    }

    fsm.tick(dt, worldSnapshot)

    const updatedSnap = fsm.getSnapshot()

    // Die fade-out (scale to zero over dieDelay seconds; ragdoll is P2)
    if (updatedSnap.stateId === 'die') {
      if (!enteredDie) {
        enteredDie = true
        dieElapsed = 0
      }
      dieElapsed += dt
      const progress = Math.min(1, dieElapsed / fsmConfig.dieDelay)
      mesh.scale.setScalar(Math.max(0.001, 1 - progress))
      return // no position sync needed while dying
    }

    if (updatedSnap.shouldRemove) return

    // Sync physics body + mesh to FSM XZ position (Y is spawn height on flat terrain)
    body.setNextKinematicTranslation(updatedSnap.position)
    mesh.position.set(updatedSnap.position.x, updatedSnap.position.y, updatedSnap.position.z)

    // Face direction of travel or face player in attack
    const dxPos = updatedSnap.position.x - prevX
    const dzPos = updatedSnap.position.z - prevZ
    if (dxPos * dxPos + dzPos * dzPos > 1e-5) {
      mesh.rotation.y = Math.atan2(dxPos, dzPos)
    } else if (
      updatedSnap.stateId === 'attack' ||
      updatedSnap.stateId === 'chase'
    ) {
      const dxP = input.playerPosition.x - updatedSnap.position.x
      const dzP = input.playerPosition.z - updatedSnap.position.z
      if (dxP * dxP + dzP * dzP > 1e-5) {
        mesh.rotation.y = Math.atan2(dxP, dzP)
      }
    }

    prevX = updatedSnap.position.x
    prevZ = updatedSnap.position.z
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
