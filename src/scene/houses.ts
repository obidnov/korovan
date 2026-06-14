import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { loadGLTF } from '../assets/loader'
import { addStaticBox } from '../engine/physics'

export type HousePlacement = {
  /** World-space foot position — y=0 places the house base on the ground. */
  position: readonly [number, number, number]
  /** Rotation around the Y axis in radians. */
  rotationY: number
  /** Uniform scale applied to the GLB. */
  scale: number
}

/** 8 hand-placed positions forming the elf village cluster.
 *  Three visual variants are achieved through the rotationY + scale permutations.
 *  These coordinates will be serialised into world.houses[] once BOO-379 save
 *  schema integration lands. */
export const HOUSE_PLACEMENTS: HousePlacement[] = [
  { position: [10, 0, -8],  rotationY: 0,                  scale: 1.0  },
  { position: [15, 0, -13], rotationY: Math.PI / 3,         scale: 0.9  },
  { position: [7,  0, -16], rotationY: (2 * Math.PI) / 3,   scale: 1.1  },
  { position: [20, 0, -10], rotationY: Math.PI,              scale: 1.0  },
  { position: [13, 0, -21], rotationY: -Math.PI / 4,         scale: 0.95 },
  { position: [19, 0, -19], rotationY: Math.PI / 2,          scale: 1.05 },
  { position: [5,  0, -23], rotationY: -Math.PI / 3,         scale: 1.0  },
  { position: [23, 0, -15], rotationY: (5 * Math.PI) / 6,   scale: 0.9  },
]

/** Loads house-elf.glb, instantiates all placements, and registers a static
 *  Rapier box collider for each one so the player cannot walk through. */
export async function spawnHouses(
  scene: THREE.Scene,
  world: RAPIER.World,
): Promise<void> {
  const { scene: templateScene } = await loadGLTF('/assets/house-elf.glb')

  // Measure the un-scaled bounding box once so all instances share the same base.
  const originalBox = new THREE.Box3().setFromObject(templateScene)
  const originalSize = new THREE.Vector3()
  originalBox.getSize(originalSize)
  const originalCenter = new THREE.Vector3()
  originalBox.getCenter(originalCenter)

  for (const { position: [px, py, pz], rotationY, scale } of HOUSE_PLACEMENTS) {
    const clone = templateScene.clone(true)
    clone.scale.setScalar(scale)
    clone.rotation.y = rotationY
    clone.position.set(px, py, pz)
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    scene.add(clone)

    // Box collider centred at the world-space bounding-box centre.
    // originalCenter.y is relative to the model origin which sits at y=py.
    const halfW = (originalSize.x * scale) / 2
    const halfH = (originalSize.y * scale) / 2
    const halfD = (originalSize.z * scale) / 2
    const centerY = py + originalCenter.y * scale

    addStaticBox(world, { x: px, y: centerY, z: pz }, { x: halfW, y: halfH, z: halfD })
  }
}
