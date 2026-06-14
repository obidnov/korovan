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
import { createSoldierEntity, buildSoldierMesh, type SoldierEntity } from './game/ai/soldierEntity'
import { createNoopAiScheduler } from './game/ai/aiScheduler'
import { SOLDIER_SPAWNS } from './game/ai/soldierSpawns'
import { createHpComponent } from './game/combat/hp'
import { createMeleeWeapon } from './game/combat/meleeWeapon'
import { createDeathScreen } from './game/combat/deathScreen'
import { swordSwing, hit } from './audio/sounds'

// ---------------------------------------------------------------------------
// Combat constants
// ---------------------------------------------------------------------------

const PLAYER_MAX_HP = 100
const SWORD_DAMAGE = 25
const SOLDIER_MELEE_DAMAGE = 10
/** Radius (m) of the hit-sphere placed in front of the player on swing. */
const PLAYER_HIT_RADIUS = 1.1
/** Distance (m) the hit-sphere centre is placed in front of the player. */
const PLAYER_HIT_REACH = 1.3

async function main() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement

  const stats = new Stats()
  stats.showPanel(0)
  document.body.appendChild(stats.dom)

  const { renderer, scene } = createRenderer(canvas)

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200)
  scene.add(camera)

  createTerrain(scene)

  const { world, step } = await createPhysics()
  addStaticGround(world)

  spawnHouses(scene, world).catch(console.error)

  // Player mesh
  let playerMesh: THREE.Object3D
  try {
    const gltf = await loadGLTF('/assets/player.glb')
    playerMesh = gltf.scene
    playerMesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true
    })
  } catch {
    playerMesh = buildCapsuleMesh()
  }

  const player = createPlayerController(world, scene, playerMesh)
  const thirdPersonCam = createThirdPersonCamera(camera, scene)
  const input = createInputHandler(canvas)

  // -------------------------------------------------------------------------
  // Combat setup
  // -------------------------------------------------------------------------

  const playerHp = createHpComponent(PLAYER_MAX_HP)
  const deathScreen = createDeathScreen()
  const sword = createMeleeWeapon(playerMesh)

  let pendingRespawn = false
  let isRespawning = false

  playerHp.onDeath(() => {
    if (isRespawning) return
    isRespawning = true
    deathScreen.show(() => {
      playerHp.reset()
      pendingRespawn = true
      isRespawning = false
    })
  })

  // -------------------------------------------------------------------------
  // Soldiers
  // -------------------------------------------------------------------------

  const aiScheduler = createNoopAiScheduler()
  const soldiers: SoldierEntity[] = []
  for (const spawnCfg of SOLDIER_SPAWNS) {
    let soldierMesh: THREE.Object3D
    try {
      const gltf = await loadGLTF('/assets/soldier.glb')
      soldierMesh = gltf.scene.clone(true)
      soldierMesh.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true
      })
    } catch {
      soldierMesh = buildSoldierMesh()
    }
    soldiers.push(createSoldierEntity(spawnCfg, soldierMesh, scene, world))
  }

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (document.pointerLockElement === canvas) {
      thirdPersonCam.onMouseMove(e.movementX, e.movementY)
    }
  })

  function onResize() {
    const w = window.innerWidth
    const h = window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', onResize)
  onResize()

  const hint = document.createElement('div')
  hint.id = 'pointer-hint'
  hint.textContent = 'Click to capture mouse — WASD move, Space jump, LMB attack, Esc release'
  document.body.appendChild(hint)
  document.addEventListener('pointerlockchange', () => {
    hint.style.display = document.pointerLockElement === canvas ? 'none' : 'block'
  })

  // -------------------------------------------------------------------------
  // Game loop
  // -------------------------------------------------------------------------

  const loop = createLoop()

  loop.addTickCallback((dt) => {
    stats.begin()

    if (pendingRespawn) {
      pendingRespawn = false
      player.teleport({ x: 0, y: 2, z: 0 })
    }

    step()
    player.update(dt, input.state, thirdPersonCam.yaw)
    thirdPersonCam.update(dt, player.getPosition())

    const playerPos = player.getPosition()

    // -----------------------------------------------------------------------
    // Sword swing + hit detection
    // -----------------------------------------------------------------------

    const hitThisFrame = sword.tick(dt, input.state.attack && !isRespawning)

    if (hitThisFrame) {
      swordSwing.play()

      const facingY = playerMesh.rotation.y
      const fwdX = Math.sin(facingY)
      const fwdZ = Math.cos(facingY)
      const hitCX = playerPos.x + fwdX * PLAYER_HIT_REACH
      const hitCY = playerPos.y
      const hitCZ = playerPos.z + fwdZ * PLAYER_HIT_REACH
      const rSq = PLAYER_HIT_RADIUS * PLAYER_HIT_RADIUS

      let didHit = false
      for (const soldier of soldiers) {
        const snap = soldier.fsm.getSnapshot()
        if (snap.isDead) continue
        const dx = snap.position.x - hitCX
        const dy = snap.position.y - hitCY
        const dz = snap.position.z - hitCZ
        if (dx * dx + dy * dy + dz * dz <= rSq) {
          soldier.takeDamage(SWORD_DAMAGE)
          didHit = true
        }
      }
      if (didHit) hit.play()
    }

    // -----------------------------------------------------------------------
    // AI tick + soldier melee attacks on player
    // -----------------------------------------------------------------------

    const playerInput = {
      playerPosition: { x: playerPos.x, y: playerPos.y, z: playerPos.z },
    }
    const worldSnap = { playerPosition: playerInput.playerPosition, playerInLineOfSight: true }
    aiScheduler.onStrategicTick(soldiers.map((s) => s.fsm), worldSnap)

    for (let i = soldiers.length - 1; i >= 0; i--) {
      const soldier = soldiers[i]

      // Read snapshot BEFORE tick — attackCooldownRemaining === 0 marks a swing frame
      const snapBefore = soldier.fsm.getSnapshot()
      const soldierSwingsNow =
        snapBefore.stateId === 'attack' && snapBefore.attackCooldownRemaining === 0

      soldier.tick(dt, playerInput)

      if (soldierSwingsNow && !playerHp.isDead && !isRespawning) {
        playerHp.takeDamage(SOLDIER_MELEE_DAMAGE)
        hit.play()
      }

      if (soldier.fsm.getSnapshot().shouldRemove) {
        soldier.dispose(scene, world)
        soldiers.splice(i, 1)
      }
    }

    renderer.render(scene, camera)

    stats.end()
  })

  loop.start()
}

main().catch(console.error)
