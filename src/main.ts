import './style.css'
import * as THREE from 'three'
import Stats from 'stats.js'
import { createRenderer } from './engine/renderer'
import { createPhysics, addStaticGround, addDynamicCube } from './engine/physics'
import { createLoop } from './engine/loop'

async function main() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement

  // FPS overlay (top-left, dev only)
  const stats = new Stats()
  stats.showPanel(0)
  document.body.appendChild(stats.dom)

  const { renderer, scene, camera, resize } = createRenderer(canvas)

  // Ground mesh — matches collider half-extents (100 × 0.2 × 100)
  const groundMesh = new THREE.Mesh(
    new THREE.BoxGeometry(100, 0.2, 100),
    new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.9 }),
  )
  groundMesh.position.y = -0.1
  groundMesh.receiveShadow = true
  scene.add(groundMesh)

  // Dynamic cube mesh
  const cubeMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xff6b35, roughness: 0.4, metalness: 0.3 }),
  )
  cubeMesh.castShadow = true
  scene.add(cubeMesh)

  // Physics — async (WASM init)
  const { world, step } = await createPhysics()
  addStaticGround(world)
  const cubeBody = addDynamicCube(world, { x: 0, y: 10, z: 0 })

  // Resize handling
  function onResize() {
    resize(window.innerWidth, window.innerHeight)
  }
  window.addEventListener('resize', onResize)
  onResize()

  // Game loop
  const loop = createLoop()

  loop.addTickCallback(() => {
    stats.begin()

    step()

    const pos = cubeBody.translation()
    const rot = cubeBody.rotation()
    cubeMesh.position.set(pos.x, pos.y, pos.z)
    cubeMesh.quaternion.set(rot.x, rot.y, rot.z, rot.w)

    renderer.render(scene, camera)

    stats.end()
  })

  loop.start()
}

main().catch(console.error)
