import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'

// THREE renders to canvas — stub it so jsdom doesn't error on WebGL
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof THREE>('three')
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas')
      setSize() {}
      setPixelRatio() {}
      render() {}
      shadowMap = { enabled: false }
    },
  }
})

const { createTerrain } = await import('../../src/scene/terrain.js')

describe('createTerrain', () => {
  it('adds exactly one mesh to the scene', () => {
    const scene = new THREE.Scene()
    createTerrain(scene)
    const meshes = scene.children.filter((c) => c instanceof THREE.Mesh)
    expect(meshes).toHaveLength(1)
  })

  it('mesh has vertex colours', () => {
    const scene = new THREE.Scene()
    const mesh = createTerrain(scene)
    expect(mesh.geometry.attributes.color).toBeDefined()
  })

  it('mesh position.y is 0 (surface at world ground)', () => {
    const scene = new THREE.Scene()
    const mesh = createTerrain(scene)
    expect(mesh.position.y).toBe(0)
  })

  it('geometry bounding box spans ~200 units on x and z', () => {
    const scene = new THREE.Scene()
    const mesh = createTerrain(scene)
    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox!
    const size = new THREE.Vector3()
    box.getSize(size)
    // PlaneGeometry 200×200 rotated; x and z extents ≈ 200
    expect(size.x).toBeCloseTo(200, 0)
    expect(size.z).toBeCloseTo(200, 0)
  })

  it('material uses vertex colours', () => {
    const scene = new THREE.Scene()
    const mesh = createTerrain(scene)
    expect((mesh.material as THREE.MeshStandardMaterial).vertexColors).toBe(true)
  })
})
