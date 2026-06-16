import * as THREE from 'three'

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ForestOpts {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** Geometry for the 3D tree used in the near band (typically from a .glb). */
  treeGeometry: THREE.BufferGeometry
  treeMaterial: THREE.Material | THREE.Material[]
  /** Texture for the always-facing-camera billboard quads in the far band. */
  billboardTexture: THREE.Texture
  /** Total trees scattered across the world. Default 6 000. */
  treeCount?: number
  /** Scatter radius from world origin (m). Default 200. */
  worldRadius?: number
  /** Near/far swap distance (m). Default 60. */
  nearRadius?: number
  /** Hysteresis band to prevent popping (m). Default 5. */
  hysteresis?: number
  /** Max rendered near (3D) instances. Default 500. */
  nearBudget?: number
  /** Max rendered far (billboard) instances. Default 5 000. */
  farBudget?: number
  /** PRNG seed — same seed always produces the same layout. Default 0xb33f. */
  seed?: number
  /** Height of each billboard quad (m). Default 4. */
  treeHeight?: number
  /** Width of each billboard quad (m). Default 2. */
  treeWidth?: number
  /** Show dev overlay with near/far counts. Default false. */
  showOverlay?: boolean
}

export interface ForestHandle {
  /** Call once per frame, before renderer.render(). */
  update(): void
  /** Remove all scene objects and DOM elements; safe to call once. */
  dispose(): void
  /** Active near-band (3D instanced) count from the last frame. */
  getNearCount(): number
  /** Active far-band (billboard) count from the last frame. */
  getFarCount(): number
}

// ─── Seeded PRNG: mulberry32 ─────────────────────────────────────────────────
// Fast, no deps, good distribution — safe to embed in a game module.

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── Layout generation (pure — no Three.js, exported for unit testing) ───────

/**
 * Scatter `count` trees uniformly inside a circle of `worldRadius` metres.
 * Deterministic: the same (count, worldRadius, seed) always returns the same
 * sequence of [x, z] pairs.
 */
export function generateTreeLayout(
  count: number,
  worldRadius: number,
  seed: number,
): [number, number][] {
  const rng = mulberry32(seed)
  const out: [number, number][] = []
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2
    // sqrt(r) maps uniform [0,1) to area-uniform radius distribution
    const r = Math.sqrt(rng()) * worldRadius
    out.push([r * Math.cos(angle), r * Math.sin(angle)])
  }
  return out
}

// ─── Internal tree state ─────────────────────────────────────────────────────

interface TreeEntry {
  x: number
  z: number
  /** Pre-baked random Y rotation so 3D instances don't all face the same way. */
  yRot: number
  /** Current LOD band — true = near/3D, false = far/billboard. */
  inNear: boolean
}

// ─── spawnForest ─────────────────────────────────────────────────────────────

export function spawnForest(opts: ForestOpts): ForestHandle {
  const {
    scene,
    camera,
    treeGeometry,
    treeMaterial,
    billboardTexture,
    treeCount = 6_000,
    worldRadius = 200,
    nearRadius = 60,
    hysteresis = 5,
    nearBudget = 500,
    farBudget = 5_000,
    seed = 0xb33f,
    treeHeight = 4,
    treeWidth = 2,
    showOverlay = false,
  } = opts

  // Trees leave the near band once they cross nearRadius + hysteresis,
  // preventing pop when the camera sits right at the threshold.
  const exitNearDist = nearRadius + hysteresis

  // ── Tree positions + per-tree state ──────────────────────────────────────
  // Use a second RNG stream (XOR seed) for per-tree Y rotation so the two
  // streams don't interfere with each other.
  const rotRng = mulberry32(seed ^ 0x1337dead)
  const trees: TreeEntry[] = generateTreeLayout(treeCount, worldRadius, seed).map(([x, z]) => ({
    x,
    z,
    yRot: rotRng() * Math.PI * 2,
    inNear: false,
  }))

  // ── Near InstancedMesh (3D) ───────────────────────────────────────────────
  const nearMesh = new THREE.InstancedMesh(treeGeometry, treeMaterial, nearBudget)
  nearMesh.count = 0
  nearMesh.frustumCulled = false // we cull per-instance manually below
  nearMesh.castShadow = true
  nearMesh.receiveShadow = true
  scene.add(nearMesh)

  // ── Far InstancedMesh (billboard) ────────────────────────────────────────
  const billboardGeo = new THREE.PlaneGeometry(treeWidth, treeHeight)
  const billboardMat = new THREE.MeshBasicMaterial({
    map: billboardTexture,
    alphaTest: 0.5, // cutout alpha — no sorting needed, depth writes correctly
    side: THREE.DoubleSide,
  })
  const farMesh = new THREE.InstancedMesh(billboardGeo, billboardMat, farBudget)
  farMesh.count = 0
  farMesh.frustumCulled = false
  scene.add(farMesh)

  // ── Dev overlay ───────────────────────────────────────────────────────────
  let overlayEl: HTMLDivElement | null = null
  if (showOverlay) {
    overlayEl = document.createElement('div')
    overlayEl.id = 'forest-overlay'
    const s = overlayEl.style
    s.position = 'fixed'
    s.top = '50px'
    s.left = '8px'
    s.fontFamily = 'monospace'
    s.fontSize = '12px'
    s.color = '#00ff88'
    s.background = 'rgba(0,0,0,0.55)'
    s.padding = '4px 8px'
    s.borderRadius = '4px'
    s.zIndex = '9999'
    s.pointerEvents = 'none'
    document.body.appendChild(overlayEl)
  }

  // ── Per-frame scratch objects (allocated once to avoid GC pressure) ───────
  const _frustum = new THREE.Frustum()
  const _projScreen = new THREE.Matrix4()
  const _mat = new THREE.Matrix4()
  const _camPos = new THREE.Vector3()
  const _sphere = new THREE.Sphere(new THREE.Vector3(), 0)
  // Bounding sphere radius used for frustum culling: half-diagonal of the tree quad
  const _cullR = Math.sqrt(treeWidth * treeWidth + treeHeight * treeHeight) * 0.5 + 0.5

  let _nearCount = 0
  let _farCount = 0

  // ── update ────────────────────────────────────────────────────────────────
  function update(): void {
    camera.updateMatrixWorld()
    _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    _frustum.setFromProjectionMatrix(_projScreen)
    camera.getWorldPosition(_camPos)

    let ni = 0 // near instance cursor
    let fi = 0 // far  instance cursor

    for (const tree of trees) {
      // Horizontal distance (XZ only) from camera to tree
      const dx = tree.x - _camPos.x
      const dz = tree.z - _camPos.z
      const dist = Math.sqrt(dx * dx + dz * dz)

      // ── LOD hysteresis state machine ──────────────────────────────────
      // Enter near when dist < nearRadius; leave near when dist > exitNearDist.
      // The 5 m dead-band in between prevents oscillation at the boundary.
      if (tree.inNear) {
        if (dist > exitNearDist) tree.inNear = false
      } else {
        if (dist < nearRadius) tree.inNear = true
      }

      // ── Frustum cull — bounding sphere at tree centre ─────────────────
      _sphere.center.set(tree.x, treeHeight * 0.5, tree.z)
      _sphere.radius = _cullR
      if (!_frustum.intersectsSphere(_sphere)) continue

      if (tree.inNear) {
        if (ni >= nearBudget) continue
        // 3D tree: random Y rotation, root anchored at y = 0
        _mat.makeRotationY(tree.yRot)
        _mat.setPosition(tree.x, 0, tree.z)
        nearMesh.setMatrixAt(ni, _mat)
        ni++
      } else {
        if (fi >= farBudget) continue
        // Billboard: rotate around Y so the quad's +Z normal faces the camera.
        // PlaneGeometry normal is +Z; atan2(-dx, -dz) gives the angle from +Z
        // toward the direction (camera - tree) projected onto XZ.
        const yAngle = Math.atan2(-dx, -dz)
        _mat.makeRotationY(yAngle)
        // Billboard centre sits at half-height above the ground
        _mat.setPosition(tree.x, treeHeight * 0.5, tree.z)
        farMesh.setMatrixAt(fi, _mat)
        fi++
      }
    }

    nearMesh.count = ni
    nearMesh.instanceMatrix.needsUpdate = true

    farMesh.count = fi
    farMesh.instanceMatrix.needsUpdate = true

    _nearCount = ni
    _farCount = fi

    if (overlayEl) {
      overlayEl.textContent = `near: ${ni} | far: ${fi}`
    }
  }

  // ── dispose ───────────────────────────────────────────────────────────────
  function dispose(): void {
    scene.remove(nearMesh)
    scene.remove(farMesh)
    nearMesh.dispose()
    farMesh.dispose()
    billboardGeo.dispose()
    billboardMat.dispose()
    overlayEl?.remove()
    overlayEl = null
  }

  return {
    update,
    dispose,
    getNearCount: () => _nearCount,
    getFarCount: () => _farCount,
  }
}
