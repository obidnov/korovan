/**
 * Cart entity — Three.js + Rapier binding for the caravan cart.
 *
 * Consumes CaravanFsm snapshots to position the mesh and physics body.
 * Visual state: dark-wood color when active, grey when looted.
 */

import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import type { CaravanSnapshot } from '../../world/caravan'

// ---------------------------------------------------------------------------
// Mesh
// ---------------------------------------------------------------------------

/** Placeholder cart mesh — box-body on two axle-pairs of cylinders. */
export function buildCartMesh(): THREE.Object3D {
  const group = new THREE.Group()

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.85 })
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x2e1a0e, roughness: 0.9 })

  // Cart bed
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 2.4), woodMat)
  bed.position.y = 0.65
  bed.castShadow = true
  group.add(bed)

  // Low fence rails (3 sides — open at the back for looting)
  const railMat = woodMat.clone()
  const rail = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), railMat)
    m.position.set(x, y, z)
    m.castShadow = true
    group.add(m)
  }
  rail(1.6, 0.4, 0.06, 0, 1.0, 1.15)   // front rail
  rail(0.06, 0.4, 2.4, -0.77, 1.0, 0)  // left rail
  rail(0.06, 0.4, 2.4, 0.77, 1.0, 0)   // right rail

  // Four wheels (cylinders)
  const wheelPositions: [number, number, number][] = [
    [-0.9, 0.35, 0.8],
    [0.9, 0.35, 0.8],
    [-0.9, 0.35, -0.8],
    [0.9, 0.35, -0.8],
  ]
  for (const [wx, wy, wz] of wheelPositions) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 0.12, 12),
      wheelMat,
    )
    wheel.rotation.z = Math.PI / 2
    wheel.position.set(wx, wy, wz)
    wheel.castShadow = true
    group.add(wheel)
  }

  return group
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CartEntity {
  readonly mesh: THREE.Object3D
  /**
   * Sync entity position and visual state to the latest caravan snapshot.
   * Call once per game-loop tick after CaravanFsm.tick().
   */
  sync(snapshot: CaravanSnapshot): void
  /** Remove mesh and physics body from scene / world. */
  dispose(scene: THREE.Scene, world: RAPIER.World): void
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCartEntity(
  mesh: THREE.Object3D,
  scene: THREE.Scene,
  world: RAPIER.World,
  initialPosition: { x: number; z: number },
): CartEntity {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      initialPosition.x,
      0,
      initialPosition.z,
    ),
  )
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.8, 0.65, 1.2), // half-extents of cart bed
    body,
  )

  scene.add(mesh)
  mesh.position.set(initialPosition.x, 0, initialPosition.z)

  // Cached material references for loot-state colour swap
  const lootedMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 })
  let isLooted = false
  let rotationY = 0
  let prevX = initialPosition.x
  let prevZ = initialPosition.z

  function sync(snapshot: CaravanSnapshot): void {
    // Loot-state visual (one-time colour swap)
    if (!isLooted && snapshot.stateId === 'looted') {
      isLooted = true
      mesh.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          ;(o as THREE.Mesh).material = lootedMat
        }
      })
    } else if (isLooted && snapshot.stateId === 'active') {
      // Respawned — reset to original materials
      isLooted = false
      mesh.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const m = o as THREE.Mesh
          const orig = m.userData._origMat as THREE.Material | undefined
          if (orig) m.material = orig
        }
      })
    }

    const { x, z } = snapshot.cartPosition
    // Compute travel delta before updating position (prevX/prevZ are from last tick)
    const dx = x - prevX
    const dz = z - prevZ
    body.setNextKinematicTranslation({ x, y: 0, z })
    mesh.position.set(x, 0, z)
    prevX = x
    prevZ = z

    // Rotate cart to face direction of travel
    if (dx * dx + dz * dz > 1e-4) {
      rotationY = Math.atan2(dx, dz)
    }
    mesh.rotation.y = rotationY
  }

  function dispose(scene: THREE.Scene, world: RAPIER.World): void {
    scene.remove(mesh)
    world.removeRigidBody(body)
  }

  // Store original materials for respawn visual reset
  mesh.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.userData._origMat = (o as THREE.Mesh).material
    }
  })

  return { mesh, sync, dispose }
}
