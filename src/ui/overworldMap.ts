/**
 * Overworld map screen — shows 4 zone hotspots with click-to-travel.
 *
 * Design decision (BOO-551): option (a) — 2D overlay map with click-to-travel
 * + scene swap. Fastest delivery given single-zone monolith origin.
 *
 * Keyboard: Tab to navigate zones, Enter/Space to select, Escape to close.
 */

import { ZONE_IDS, ZONE_META, type ZoneId } from '../world/zones'

export interface OverworldMapCallbacks {
  /** Called when the user confirms travel to a different zone. */
  onTravel: (zoneId: ZoneId) => void
}

export interface OverworldMap {
  open(currentZone: ZoneId): void
  close(): void
  readonly isOpen: boolean
}

export function createOverworldMap(callbacks: OverworldMapCallbacks): OverworldMap {
  let _isOpen = false
  let _currentZone: ZoneId = 'elf-forest'
  let _pendingZone: ZoneId | null = null

  // ── Root overlay ────────────────────────────────────────────────────────────
  const overlay = document.createElement('div')
  overlay.id = 'ow-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-labelledby', 'ow-title')
  overlay.style.display = 'none'

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = document.createElement('div')
  header.className = 'ow-header'

  const title = document.createElement('h2')
  title.id = 'ow-title'
  title.className = 'ow-title'
  title.textContent = 'Overworld Map'

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'ow-close'
  closeBtn.textContent = '✕'
  closeBtn.setAttribute('aria-label', 'Close map')
  closeBtn.addEventListener('click', () => close())

  header.appendChild(title)
  header.appendChild(closeBtn)

  // ── Map area ────────────────────────────────────────────────────────────────
  const mapArea = document.createElement('div')
  mapArea.className = 'ow-map'
  mapArea.setAttribute('role', 'group')
  mapArea.setAttribute('aria-label', 'Zone selection')

  // Terrain background — stylized ASCII/SVG inline, no asset dependency
  const mapBg = document.createElement('div')
  mapBg.className = 'ow-map-bg'
  mapBg.innerHTML = buildMapSvg()
  mapArea.appendChild(mapBg)

  // Zone hotspot buttons (positioned over the SVG via mapPos percentages)
  const hotspotBtns: Record<ZoneId, HTMLButtonElement> = {} as Record<ZoneId, HTMLButtonElement>

  for (const zoneId of ZONE_IDS) {
    const meta = ZONE_META[zoneId]
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'ow-hotspot'
    btn.dataset.zone = zoneId
    btn.style.left = `${meta.mapPos.x}%`
    btn.style.top = `${meta.mapPos.y}%`
    btn.setAttribute('aria-label', `Travel to ${meta.label}`)

    const dot = document.createElement('span')
    dot.className = 'ow-hotspot-dot'
    dot.setAttribute('aria-hidden', 'true')

    const label = document.createElement('span')
    label.className = 'ow-hotspot-label'
    label.textContent = meta.label

    btn.appendChild(dot)
    btn.appendChild(label)
    btn.addEventListener('click', () => onHotspotClick(zoneId))
    mapArea.appendChild(btn)
    hotspotBtns[zoneId] = btn
  }

  // ── Info panel ───────────────────────────────────────────────────────────────
  const infoPanel = document.createElement('div')
  infoPanel.className = 'ow-info'

  const infoName = document.createElement('p')
  infoName.className = 'ow-info-name'
  infoName.textContent = 'Select a zone'

  const infoDesc = document.createElement('p')
  infoDesc.className = 'ow-info-desc'
  infoDesc.textContent = ''

  const travelBtn = document.createElement('button')
  travelBtn.type = 'button'
  travelBtn.className = 'ow-travel-btn'
  travelBtn.textContent = 'Travel'
  travelBtn.disabled = true
  travelBtn.addEventListener('click', () => {
    if (_pendingZone && _pendingZone !== _currentZone) {
      callbacks.onTravel(_pendingZone)
    }
  })

  const currentZoneNote = document.createElement('p')
  currentZoneNote.className = 'ow-current-note'

  infoPanel.appendChild(infoName)
  infoPanel.appendChild(infoDesc)
  infoPanel.appendChild(travelBtn)
  infoPanel.appendChild(currentZoneNote)

  // ── Assemble ────────────────────────────────────────────────────────────────
  const inner = document.createElement('div')
  inner.className = 'ow-inner'
  inner.appendChild(header)
  inner.appendChild(mapArea)
  inner.appendChild(infoPanel)

  overlay.appendChild(inner)
  document.body.appendChild(overlay)

  // ── Keyboard nav ────────────────────────────────────────────────────────────
  overlay.addEventListener('keydown', (e) => {
    if (!_isOpen) return
    if (e.key === 'Escape') {
      close()
      return
    }
  })

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function onHotspotClick(zoneId: ZoneId): void {
    _pendingZone = zoneId
    const meta = ZONE_META[zoneId]
    infoName.textContent = meta.label
    infoDesc.textContent = meta.description

    const isCurrent = zoneId === _currentZone
    travelBtn.disabled = isCurrent
    travelBtn.textContent = isCurrent ? 'Current Zone' : `Travel to ${meta.label}`
    currentZoneNote.textContent = isCurrent ? '(You are here)' : ''

    // Highlight selected hotspot
    for (const id of ZONE_IDS) {
      hotspotBtns[id].classList.toggle('ow-hotspot--selected', id === zoneId)
    }
  }

  function refreshCurrentMarkers(): void {
    for (const id of ZONE_IDS) {
      hotspotBtns[id].classList.toggle('ow-hotspot--current', id === _currentZone)
    }
  }

  function close(): void {
    _isOpen = false
    _pendingZone = null
    overlay.style.display = 'none'
    // Clear selection state
    infoName.textContent = 'Select a zone'
    infoDesc.textContent = ''
    travelBtn.disabled = true
    travelBtn.textContent = 'Travel'
    currentZoneNote.textContent = ''
    for (const id of ZONE_IDS) {
      hotspotBtns[id].classList.remove('ow-hotspot--selected')
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  return {
    open(currentZone: ZoneId) {
      _isOpen = true
      _currentZone = currentZone
      _pendingZone = null
      overlay.style.display = 'flex'
      refreshCurrentMarkers()
      // Pre-select current zone in info panel
      onHotspotClick(currentZone)
      closeBtn.focus()
    },
    close() {
      close()
    },
    get isOpen() {
      return _isOpen
    },
  }
}

// ── Inline SVG map background ───────────────────────────────────────────────
// Simple stylized map without external assets.
function buildMapSvg(): string {
  return `<svg
    viewBox="0 0 400 300"
    xmlns="http://www.w3.org/2000/svg"
    style="width:100%;height:100%"
    aria-hidden="true"
  >
    <!-- Base terrain -->
    <rect width="400" height="300" fill="#1a1a0e"/>
    <!-- Western forest mass (elf forest) -->
    <ellipse cx="80" cy="185" rx="70" ry="55" fill="#1a3018" opacity="0.9"/>
    <ellipse cx="65" cy="170" rx="40" ry="30" fill="#1e3d1a" opacity="0.7"/>
    <!-- Central plains (neutral humans) -->
    <rect x="120" y="100" width="160" height="130" rx="20" fill="#2a2a14" opacity="0.7"/>
    <!-- Northern palace area -->
    <polygon points="230,20 330,20 360,100 200,100" fill="#1e2230" opacity="0.85"/>
    <!-- Mountain range south-east (villain mountain) -->
    <polygon points="280,180 380,130 400,220 380,280 280,290" fill="#1a1018" opacity="0.9"/>
    <polygon points="310,140 370,130 400,170 360,220 300,220" fill="#221520" opacity="0.8"/>
    <!-- Road network -->
    <path d="M80 185 Q 160 180 200 145 Q 260 100 295 80" stroke="#3a3020" stroke-width="5" fill="none" opacity="0.7"/>
    <path d="M200 145 L 330 200" stroke="#3a3020" stroke-width="5" fill="none" opacity="0.7"/>
    <!-- Decorative mountain peaks -->
    <polyline points="290,200 310,150 330,200" fill="none" stroke="#2e1e2a" stroke-width="2"/>
    <polyline points="330,200 350,145 380,200" fill="none" stroke="#2e1e2a" stroke-width="2"/>
    <!-- Forest trees (simplified circles) -->
    <circle cx="50" cy="160" r="8" fill="#183018" opacity="0.6"/>
    <circle cx="75" cy="155" r="10" fill="#183018" opacity="0.6"/>
    <circle cx="95" cy="165" r="9" fill="#183018" opacity="0.6"/>
    <circle cx="60" cy="185" r="9" fill="#183018" opacity="0.6"/>
    <circle cx="100" cy="195" r="8" fill="#183018" opacity="0.6"/>
    <!-- Palace symbol -->
    <rect x="280" y="50" width="26" height="22" fill="#2a3050" opacity="0.7" rx="2"/>
    <rect x="278" y="44" width="8" height="12" fill="#2a3050" opacity="0.8"/>
    <rect x="298" y="44" width="8" height="12" fill="#2a3050" opacity="0.8"/>
    <!-- Border frame -->
    <rect x="2" y="2" width="396" height="296" fill="none" stroke="#3a3020" stroke-width="3" rx="4"/>
  </svg>`
}
