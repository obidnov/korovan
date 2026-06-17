/**
 * Stub scenes for the 3 non-elf zones introduced in P2/A1 (BOO-551).
 * A2/A3/A4 replace these with zone-specific terrain and assets.
 *
 * Zone transitions use page-reload (same model as "Main Menu" button):
 *   save-with-new-zone → sessionStorage flag → location.reload() → auto-continue
 * This gives zero-leak, zero-asset-double-load transitions (AC item 2).
 *
 * Each stub provides:
 *  - Flat ground plane with zone colour + fog matching zone mood
 *  - Player controller + third-person camera
 *  - Zone name label visible in the world (QA identifier)
 *  - HUD with save, settings, and map buttons
 *  - Pause menu with travel button
 */

import * as THREE from 'three'
import Stats from 'stats.js'
import { createRenderer } from '../engine/renderer'
import { createPhysics, addStaticGround } from '../engine/physics'
import { createLoop } from '../engine/loop'
import { createPlayerController, buildCapsuleMesh } from '../game/player'
import { createThirdPersonCamera } from '../game/camera'
import { createInputHandler } from '../game/input'
import { createHpComponent } from '../game/combat/hp'
import { createDeathScreen } from '../game/combat/deathScreen'
import { createHud } from '../ui/hud'
import { createPauseMenu } from '../ui/pauseMenu'
import { createOverworldMap } from '../ui/overworldMap'
import { ZONE_META, type ZoneId } from '../world/zones'
import { saveGame } from '../persistence/save'
import type { SaveV1 } from '../save/schema'

export interface StubZoneOptions {
  zoneId: ZoneId
  savedState: SaveV1 | null
  onSettings: () => void
  onMainMenu: () => void
  /** Current zone at start (passed in so overworld map shows the right marker) */
  currentZone: ZoneId
  /** Called when zone-swap is requested. Implementor saves + reloads. */
  onTravelRequest: (targetZone: ZoneId) => Promise<void>
}

export async function startStubZone(opts: StubZoneOptions): Promise<void> {
  const meta = ZONE_META[opts.zoneId]
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement

  const stats = new Stats()
  stats.showPanel(0)
  document.body.appendChild(stats.dom)

  const { renderer, scene } = createRenderer(canvas)

  // Override scene mood from createRenderer defaults
  scene.background = new THREE.Color(meta.skyColor)
  scene.fog = new THREE.Fog(meta.skyColor, 50, 200)

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    200,
  )
  scene.add(camera)

  // ── Ground ─────────────────────────────────────────────────────────────────
  const groundColor = dimColor(meta.skyColor, 0.5)
  const groundGeo = new THREE.PlaneGeometry(400, 400)
  const groundMat = new THREE.MeshLambertMaterial({ color: groundColor })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  // ── World-space zone label (so QA can identify the zone at a glance) ──────
  const labelCanvas = document.createElement('canvas')
  labelCanvas.width = 512
  labelCanvas.height = 96
  const ctx = labelCanvas.getContext('2d')!
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(0, 0, 512, 96)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 48px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(meta.label, 256, 48)
  const labelTex = new THREE.CanvasTexture(labelCanvas)
  const labelMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 2.5),
    new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false }),
  )
  labelMesh.position.set(0, 6, -10)
  scene.add(labelMesh)

  // ── Physics + player ───────────────────────────────────────────────────────
  const { world, step } = await createPhysics()
  addStaticGround(world)

  const playerMesh = buildCapsuleMesh()
  const player = createPlayerController(world, scene, playerMesh)
  const thirdPersonCam = createThirdPersonCamera(camera, scene)
  const input = createInputHandler(canvas)

  const PLAYER_MAX_HP = 100
  const playerHp = createHpComponent(PLAYER_MAX_HP)
  const deathScreen = createDeathScreen()

  // Restore from save
  if (opts.savedState !== null) {
    const savedHp = opts.savedState.player.hp
    if (savedHp < PLAYER_MAX_HP) playerHp.takeDamage(PLAYER_MAX_HP - savedHp)
    const [px, py, pz] = opts.savedState.player.position
    player.teleport({ x: px, y: py, z: pz })
  } else {
    player.teleport(meta.defaultSpawn)
  }

  let isRespawning = false
  playerHp.onDeath(() => {
    if (isRespawning) return
    isRespawning = true
    deathScreen.show(() => {
      playerHp.reset()
      player.teleport(meta.defaultSpawn)
      isRespawning = false
    })
  })

  // ── Save builder ───────────────────────────────────────────────────────────
  function buildSaveData(): SaveV1 {
    const pos = player.getPosition()
    return {
      version: 1,
      player: {
        hp: playerHp.hp,
        position: [pos.x, pos.y, pos.z],
        inventory: opts.savedState?.player.inventory ?? [],
      },
      world: {
        caravanState: opts.savedState?.world.caravanState ?? null,
        currentZone: opts.zoneId,
      },
    }
  }

  // ── Overworld map ──────────────────────────────────────────────────────────
  const overworldMap = createOverworldMap({
    onTravel: (targetZone) => {
      void (async () => {
        await saveGame(0, { ...buildSaveData(), world: { ...buildSaveData().world, currentZone: targetZone } }, 1).catch(
          (err: unknown) => console.warn('[korovan] pre-travel save failed:', err),
        )
        void opts.onTravelRequest(targetZone)
      })()
    },
  })

  // ── HUD ────────────────────────────────────────────────────────────────────
  const hud = createHud({
    onSave: () =>
      void saveGame(0, buildSaveData(), 1).catch((err: unknown) => {
        console.warn('[korovan] save failed:', err)
      }),
    onSettings: opts.onSettings,
    onOpenMap: () => overworldMap.open(opts.currentZone),
  })
  hud.setHp(playerHp.hp, PLAYER_MAX_HP)
  hud.setInventory(opts.savedState?.player.inventory ?? [])
  hud.show()

  // ── Pause menu ─────────────────────────────────────────────────────────────
  let paused = false

  const pauseMenu = createPauseMenu({
    onResume: () => {
      paused = false
      canvas.requestPointerLock()
    },
    onSave: () =>
      void saveGame(0, buildSaveData(), 1).catch((err: unknown) => {
        console.warn('[korovan] save failed:', err)
      }),
    onSettings: opts.onSettings,
    onMainMenu: opts.onMainMenu,
    onOpenMap: () => {
      pauseMenu.close()
      overworldMap.open(opts.currentZone)
    },
  })

  // ── Pointer lock + resize ──────────────────────────────────────────────────
  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (document.pointerLockElement === canvas) {
      thirdPersonCam.onMouseMove(e.movementX, e.movementY)
    }
  })

  function onResize(): void {
    renderer.setSize(window.innerWidth, window.innerHeight, false)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', onResize)
  onResize()

  const hint = document.createElement('div')
  hint.id = 'pointer-hint'
  hint.textContent = 'Click to capture mouse — WASD move, Space jump, M map, Esc pause'
  document.body.appendChild(hint)

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas
    hint.style.display = locked ? 'none' : 'block'
    if (!locked && !pauseMenu.isOpen && !overworldMap.isOpen) {
      paused = true
      pauseMenu.open()
    }
  })

  canvas.addEventListener('click', () => {
    if (!pauseMenu.isOpen && !overworldMap.isOpen) canvas.requestPointerLock()
  })

  // ── Game loop ──────────────────────────────────────────────────────────────
  const loop = createLoop()

  loop.addTickCallback((dt) => {
    if (paused || overworldMap.isOpen) return

    stats.begin()

    step()
    player.update(dt, input.state, thirdPersonCam.yaw)
    thirdPersonCam.update(dt, player.getPosition())

    hud.setHp(playerHp.hp, PLAYER_MAX_HP)

    // M key → open overworld map (pulse: cleared after one tick)
    if (input.state.openMap) {
      input.state.openMap = false
      if (document.pointerLockElement === canvas) document.exitPointerLock()
      overworldMap.open(opts.currentZone)
      return
    }

    labelMesh.lookAt(camera.position)

    renderer.render(scene, camera)
    stats.end()
  })

  loop.start()
}

// ── Color utility ───────────────────────────────────────────────────────────
function dimColor(hex: number, factor: number): number {
  const r = Math.round(((hex >> 16) & 0xff) * factor)
  const g = Math.round(((hex >> 8) & 0xff) * factor)
  const b = Math.round((hex & 0xff) * factor)
  return (r << 16) | (g << 8) | b
}
