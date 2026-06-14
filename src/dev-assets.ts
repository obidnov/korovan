import {
  AmbientLight,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  Box3,
  Vector3,
  MeshStandardMaterial,
  Mesh,
} from 'three'
import { loadGLTF } from './assets/loader.js'

interface AssetDef {
  file: string
  type: 'glb' | 'png'
  label: string
}

const ASSETS: AssetDef[] = [
  { file: 'tree.glb',          type: 'glb', label: 'tree' },
  { file: 'tree-billboard.png', type: 'png', label: 'tree billboard' },
  { file: 'house-elf.glb',     type: 'glb', label: 'house-elf' },
  { file: 'player.glb',        type: 'glb', label: 'player' },
  { file: 'soldier.glb',       type: 'glb', label: 'soldier' },
]

const grid = document.getElementById('grid')!

function makeCard(asset: AssetDef): { card: HTMLDivElement; statusEl: HTMLDivElement } {
  const card = document.createElement('div')
  card.className = 'card'

  const meta = document.createElement('div')
  meta.className = 'card-meta'
  meta.innerHTML = `
    <span class="card-name">${asset.label}</span>
    <span class="badge badge-${asset.type}">.${asset.type}</span>
  `

  const status = document.createElement('div')
  status.className = 'status'
  status.textContent = 'loading…'

  card.appendChild(meta)
  card.appendChild(status)
  grid.appendChild(card)
  return { card, statusEl: status }
}

function setupGLBPreview(card: HTMLDivElement, statusEl: HTMLDivElement, url: string) {
  const canvas = document.createElement('canvas')
  canvas.className = 'card-canvas'
  card.insertBefore(canvas, card.firstChild)

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setClearColor(0x0d0d0d)

  const scene = new Scene()
  scene.add(new AmbientLight(0xffffff, 1.2))
  const sun = new DirectionalLight(0xffffff, 2)
  sun.position.set(3, 6, 4)
  scene.add(sun)

  const camera = new PerspectiveCamera(45, 1, 0.01, 100)

  let rafId = 0
  let loaded = false

  function resize() {
    const w = canvas.clientWidth
    renderer.setSize(w, w, false)
  }

  loadGLTF(url)
    .then(({ scene: modelScene }) => {
      // Replace wireframe-grey material with a flat clay colour so shapes read clearly
      modelScene.traverse((obj) => {
        if (obj instanceof Mesh) {
          obj.material = new MeshStandardMaterial({ color: 0x8888ff, roughness: 0.8, metalness: 0 })
        }
      })

      // Auto-fit camera to model bounding sphere
      const box = new Box3().setFromObject(modelScene)
      const centre = new Vector3()
      box.getCenter(centre)
      const size = box.getSize(new Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      camera.position.set(centre.x + maxDim, centre.y + maxDim * 0.8, centre.z + maxDim * 1.5)
      camera.lookAt(centre)

      scene.add(modelScene)
      loaded = true
      statusEl.className = 'status ok'
      statusEl.textContent = `✓ loaded — ${url.split('/').pop()}`

      resize()

      let angle = 0
      function animate() {
        rafId = requestAnimationFrame(animate)
        if (!loaded) return
        angle += 0.008
        const r = maxDim * 2
        camera.position.set(
          centre.x + r * Math.sin(angle),
          centre.y + maxDim * 0.8,
          centre.z + r * Math.cos(angle),
        )
        camera.lookAt(centre)
        renderer.render(scene, camera)
      }
      animate()
    })
    .catch((err: unknown) => {
      statusEl.className = 'status error'
      statusEl.textContent = `✗ ${err instanceof Error ? err.message : String(err)}`
    })

  window.addEventListener('resize', resize)
  card.addEventListener('remove', () => {
    cancelAnimationFrame(rafId)
    renderer.dispose()
  })
}

for (const asset of ASSETS) {
  const { card, statusEl } = makeCard(asset)

  if (asset.type === 'glb') {
    setupGLBPreview(card, statusEl, `/assets/${asset.file}`)
  } else {
    // PNG billboard — show as image
    const img = document.createElement('img')
    img.className = 'card-img'
    img.src = `/assets/${asset.file}`
    img.alt = asset.label
    img.onload = () => {
      statusEl.className = 'status ok'
      statusEl.textContent = `✓ ${img.naturalWidth}×${img.naturalHeight}px`
    }
    img.onerror = () => {
      statusEl.className = 'status error'
      statusEl.textContent = '✗ failed to load'
    }
    card.insertBefore(img, card.firstChild)
  }
}
