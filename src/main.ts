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
import { createCaravanFsm, CARAVAN_ROUTE, CARAVAN_INTERACT_RANGE } from './world/caravan'
import { createCartEntity, buildCartMesh } from './game/caravan/cartEntity'
import { createEscortEntity, type EscortEntity } from './game/caravan/escortEntity'
import { createLootHud } from './game/caravan/lootHud'
import { createInventory, LOOT_GOLD, LOOT_WOOD, LOOT_IRON_ORE } from './game/inventory'
import {
  createProviderSettingsPanel,
  loadProviderSettings,
} from './ui/providerSettings'
import { createMainMenu } from './ui/mainMenu'
import { createHud } from './ui/hud'
import { createPauseMenu } from './ui/pauseMenu'
import { showToast } from './ui/toast'
import { hasSave, loadRaw, persistRaw } from './save/storage'
import { validateSaveV1, type SaveV1 } from './save/schema'
import type { ProviderSettings } from './ai/types'
import { submitScore, ApiError } from './api/leaderboard'

// ---------------------------------------------------------------------------
// Leaderboard constants
// ---------------------------------------------------------------------------

const LB_ZONE = 'forest'
const LB_FACTION = 'player'

/** Score = weighted loot sum: gold×10, wood×5, ironOre×15. */
function computeScore(items: ReadonlyArray<{ id: string; qty: number }>): number {
  const weights: Record<string, number> = { gold: 10, wood: 5, ironOre: 15 }
  return items.reduce((acc, { id, qty }) => acc + (weights[id] ?? 1) * qty, 0)
}

// ---------------------------------------------------------------------------
// Combat constants
// ---------------------------------------------------------------------------

const PLAYER_MAX_HP = 100
const SWORD_DAMAGE = 25
const SOLDIER_MELEE_DAMAGE = 10
const ESCORT_MELEE_DAMAGE = 10
const PLAYER_HIT_RADIUS = 1.1
const PLAYER_HIT_REACH = 1.3

// ---------------------------------------------------------------------------
// Escort spawn offsets (relative to cart centre)
// ---------------------------------------------------------------------------

const ESCORT_OFFSETS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -2, z: 0 },
  { x: 2, z: 0 },
]

// ---------------------------------------------------------------------------
// Provider settings panel — shared between main menu and HUD
// ---------------------------------------------------------------------------

const providerSettingsPanel = createProviderSettingsPanel()

// ---------------------------------------------------------------------------
// Main menu — shown immediately before game loads
// ---------------------------------------------------------------------------

const mainMenu = createMainMenu(
  {
    onNewGame: () => startGame(null),
    onContinue: () => {
      const raw = loadRaw()
      let savedState: SaveV1 | null = null
      if (raw !== null) {
        try {
          savedState = validateSaveV1(raw)
        } catch {
          // Corrupt save — start fresh
          console.warn('[korovan] corrupt save data, starting fresh')
        }
      }
      startGame(savedState)
    },
    onProviderSettings: () => providerSettingsPanel.open(),
  },
  { zone: LB_ZONE, faction: LB_FACTION },
)

mainMenu.setContinueAvailable(hasSave())
mainMenu.show()

// ---------------------------------------------------------------------------
// Game bootstrap — called once per session (New Game or Continue)
// ---------------------------------------------------------------------------

async function startGame(savedState: SaveV1 | null): Promise<void> {
  mainMenu.hide()

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

    // Submit run score non-blockingly (must not stall the death screen)
    const runScore = computeScore(inventory.list())
    submitScore({ zone: LB_ZONE, faction: LB_FACTION, score: runScore })
      .then(({ rank }) => {
        showToast(`Submitted! Rank #${rank}.`, 'success')
        mainMenu.refreshLeaderboard()
      })
      .catch((err: unknown) => {
        const status = err instanceof ApiError ? err.status : 0
        if (status === 429) {
          showToast("Couldn't submit — keep playing!", 'error')
        } else if (status === 0) {
          // Network failure — silent; toast would only alarm the player
          console.warn('[korovan] leaderboard submit failed (network)')
        } else {
          showToast("Couldn't submit — keep playing!", 'error')
        }
      })

    deathScreen.show(() => {
      playerHp.reset()
      pendingRespawn = true
      isRespawning = false
    })
  })

  // -------------------------------------------------------------------------
  // Palace soldiers
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

  // -------------------------------------------------------------------------
  // Caravan system
  // -------------------------------------------------------------------------

  const caravanFsm = createCaravanFsm(savedState?.world.caravanState ?? {})
  const initialCartPos = CARAVAN_ROUTE[0]

  const cartMesh = buildCartMesh()
  const cartEntity = createCartEntity(cartMesh, scene, world, initialCartPos)

  const lootHud = createLootHud()
  const inventory = createInventory(savedState?.player.inventory ?? [])

  const escorts: EscortEntity[] = []

  async function spawnEscorts(cartPosition: { x: number; z: number }): Promise<void> {
    for (let i = 0; i < ESCORT_OFFSETS.length; i++) {
      const offset = ESCORT_OFFSETS[i]
      let escortMesh: THREE.Object3D
      try {
        const gltf = await loadGLTF('/assets/soldier.glb')
        escortMesh = gltf.scene.clone(true)
        escortMesh.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true
        })
      } catch {
        escortMesh = buildSoldierMesh()
      }
      escorts.push(
        createEscortEntity(
          {
            id: `escort-${i}`,
            startPosition: {
              x: cartPosition.x + offset.x,
              y: 0,
              z: cartPosition.z + offset.z,
            },
            offset,
          },
          escortMesh,
          scene,
          world,
        ),
      )
    }
  }

  await spawnEscorts(initialCartPos)

  // Restore HP and position from save
  if (savedState !== null) {
    const savedHp = savedState.player.hp
    if (savedHp < PLAYER_MAX_HP) {
      playerHp.takeDamage(PLAYER_MAX_HP - savedHp)
    }
    const [px, py, pz] = savedState.player.position
    player.teleport({ x: px, y: py, z: pz })
  }

  // -------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------

  const ps = loadProviderSettings() as Partial<ProviderSettings>
  const providerLabel: string = ps.id ?? 'scripted-fallback'

  function buildSaveData(): SaveV1 {
    const pos = player.getPosition()
    const cur = loadProviderSettings() as Partial<ProviderSettings>
    const provider: ProviderSettings = {
      id: cur.id ?? 'deepseek',
      baseUrl: cur.baseUrl ?? 'https://api.deepseek.com/v1',
      model: cur.model ?? 'deepseek-chat',
      apiKey: '',
      timeoutMs: cur.timeoutMs ?? 20_000,
    }
    return {
      version: 1,
      player: {
        hp: playerHp.hp,
        position: [pos.x, pos.y, pos.z],
        inventory: inventory.toSave(),
      },
      world: {
        caravanState: caravanFsm.toSaveState(),
      },
      settings: { provider },
    }
  }

  const hud = createHud({
    onSave: () => persistRaw(buildSaveData()),
    onProviderSettings: () => providerSettingsPanel.open(),
  })
  hud.setHp(playerHp.hp, PLAYER_MAX_HP)
  hud.setInventory(inventory.list())
  hud.setProvider(providerLabel)
  hud.show()

  inventory.onChange((items) => hud.setInventory(items))

  // -------------------------------------------------------------------------
  // Pause menu
  // -------------------------------------------------------------------------

  let paused = false

  const pauseMenu = createPauseMenu({
    onResume: () => {
      paused = false
      canvas.requestPointerLock()
    },
    onSave: () => persistRaw(buildSaveData()),
    onProviderSettings: () => providerSettingsPanel.open(),
    onMainMenu: () => location.reload(),
  })

  // -------------------------------------------------------------------------
  // Pointer lock + resize
  // -------------------------------------------------------------------------

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
  hint.textContent =
    'Click to capture mouse — WASD move, Space jump, LMB attack, E interact, Esc pause'
  document.body.appendChild(hint)

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas
    hint.style.display = locked ? 'none' : 'block'

    // Pointer lock released (Esc during play) → open pause menu
    if (!locked && !pauseMenu.isOpen) {
      paused = true
      pauseMenu.open()
    }
  })

  canvas.addEventListener('click', () => {
    if (!pauseMenu.isOpen) canvas.requestPointerLock()
  })

  // -------------------------------------------------------------------------
  // Game loop
  // -------------------------------------------------------------------------

  const loop = createLoop()

  loop.addTickCallback((dt) => {
    if (paused) return

    stats.begin()

    if (pendingRespawn) {
      pendingRespawn = false
      player.teleport({ x: 0, y: 2, z: 0 })
    }

    step()
    player.update(dt, input.state, thirdPersonCam.yaw)
    thirdPersonCam.update(dt, player.getPosition())

    const playerPos = player.getPosition()

    // Update HP bar every frame (throttled inside setHp)
    hud.setHp(playerHp.hp, PLAYER_MAX_HP)

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

      for (const escort of escorts) {
        const snap = escort.fsm.getSnapshot()
        if (snap.isDead) continue
        const dx = snap.position.x - hitCX
        const dy = snap.position.y - hitCY
        const dz = snap.position.z - hitCZ
        if (dx * dx + dy * dy + dz * dz <= rSq) {
          escort.takeDamage(SWORD_DAMAGE)
          didHit = true
        }
      }

      if (didHit) hit.play()
    }

    // -----------------------------------------------------------------------
    // Palace soldier AI tick
    // -----------------------------------------------------------------------

    const playerInput = {
      playerPosition: { x: playerPos.x, y: playerPos.y, z: playerPos.z },
    }
    const worldSnap = { playerPosition: playerInput.playerPosition, playerInLineOfSight: true }
    aiScheduler.onStrategicTick(soldiers.map((s) => s.fsm), worldSnap)

    for (let i = soldiers.length - 1; i >= 0; i--) {
      const soldier = soldiers[i]

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

    // -----------------------------------------------------------------------
    // Caravan FSM tick
    // -----------------------------------------------------------------------

    caravanFsm.tick(dt)
    const caravanSnap = caravanFsm.getSnapshot()

    cartEntity.sync(caravanSnap)

    if (caravanSnap.didRespawn) {
      void spawnEscorts(caravanSnap.cartPosition)
    }

    // -----------------------------------------------------------------------
    // Escort AI tick
    // -----------------------------------------------------------------------

    const cartPos2D = caravanSnap.cartPosition
    const player2D = { x: playerPos.x, z: playerPos.z }

    for (let i = escorts.length - 1; i >= 0; i--) {
      const escort = escorts[i]

      const snapBefore = escort.fsm.getSnapshot()
      const escortSwingsNow =
        snapBefore.stateId === 'attack' && snapBefore.attackCooldownRemaining === 0

      escort.tick(dt, { playerPosition: player2D, cartPosition: cartPos2D })

      if (escortSwingsNow && !playerHp.isDead && !isRespawning) {
        playerHp.takeDamage(ESCORT_MELEE_DAMAGE)
        hit.play()
      }

      if (escort.fsm.getSnapshot().shouldRemove) {
        escort.dispose(scene, world)
        escorts.splice(i, 1)
      }
    }

    // -----------------------------------------------------------------------
    // Caravan loot interaction
    // -----------------------------------------------------------------------

    const allEscortsDead = escorts.length > 0 && escorts.every((e) => e.fsm.getSnapshot().isDead)
    const cartXZ = caravanSnap.cartPosition
    const pdx = playerPos.x - cartXZ.x
    const pdz = playerPos.z - cartXZ.z
    const distToCart = Math.sqrt(pdx * pdx + pdz * pdz)

    const canLoot =
      caravanSnap.stateId === 'active' &&
      allEscortsDead &&
      distToCart <= CARAVAN_INTERACT_RANGE

    lootHud.setPromptVisible(canLoot)

    if (canLoot && input.state.interact) {
      caravanFsm.loot()
      lootHud.setPromptVisible(false)
      lootHud.flashLooted()
      inventory.add({ id: LOOT_GOLD, qty: 50 })
      inventory.add({ id: LOOT_WOOD, qty: 5 })
      inventory.add({ id: LOOT_IRON_ORE, qty: 2 })
    }

    renderer.render(scene, camera)

    stats.end()
  })

  loop.start()
}
