import './style.css'
import * as THREE from 'three'
import Stats from 'stats.js'
import { createRenderer } from './engine/renderer'
import { createPhysics, addStaticGround } from './engine/physics'
import { createLoop } from './engine/loop'
import { createPlayerController, buildCapsuleMesh } from './game/player'
import { createThirdPersonCamera } from './game/camera'
import { createInputHandler } from './game/input'
import { loadGLTF } from './assets/loader'
import { createTerrain } from './scene/terrain'
import { spawnHouses } from './scene/houses'

async function main() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement

  const stats = new Stats()
  stats.showPanel(0)
  document.body.appendChild(stats.dom)

  const { renderer, scene } = createRenderer(canvas)

  // Own perspective camera so third-person camera module controls it directly
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200)
  scene.add(camera)

  // Blended green/brown terrain plane (200×200, surface at y=0)
  createTerrain(scene)

  // Physics
  const { world, step } = await createPhysics()
  addStaticGround(world)

  // Spawn elf village — GLB + Rapier colliders (non-blocking; houses appear ~1 frame later)
  spawnHouses(scene, world).catch(console.error)

  // Player mesh — try GLB first, fallback to capsule primitive
  let playerMesh: THREE.Object3D
  try {
    const gltf = await loadGLTF('/assets/player.glb')
    playerMesh = gltf.scene
    playerMesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true
    })
    playerMesh.scale.setScalar(1)
  } catch {
    playerMesh = buildCapsuleMesh()
  }

  const player = createPlayerController(world, scene, playerMesh)
  const thirdPersonCam = createThirdPersonCamera(camera, scene)
  const input = createInputHandler(canvas)

  // Feed mouse deltas to camera (only while pointer is locked)
  function onMouseMove(e: MouseEvent) {
    if (document.pointerLockElement === canvas) {
      thirdPersonCam.onMouseMove(e.movementX, e.movementY)
    }
  }
  document.addEventListener('mousemove', onMouseMove)

  // Resize
  function onResize() {
    const w = window.innerWidth
    const h = window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', onResize)
  onResize()

  // Pointer-lock hint overlay
  const hint = document.createElement('div')
  hint.id = 'pointer-hint'
  hint.textContent = 'Click to capture mouse — WASD move, Space jump, Esc release'
  document.body.appendChild(hint)
  document.addEventListener('pointerlockchange', () => {
    hint.style.display = document.pointerLockElement === canvas ? 'none' : 'block'
  })

  const loop = createLoop()

  loop.addTickCallback((dt) => {
    stats.begin()

    step()
    player.update(dt, input.state, thirdPersonCam.yaw)
    thirdPersonCam.update(dt, player.getPosition())

    renderer.render(scene, camera)

    stats.end()
  })

  loop.start()
}

main().catch(console.error)
