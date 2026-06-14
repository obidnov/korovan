/**
 * In-game HUD overlay — DOM layer on top of the Three.js canvas.
 *
 * Contains:
 *   - HP bar (colour shifts green → amber → red as HP drops)
 *   - Loot counter (Gold / Wood / Iron)
 *   - Save button
 *   - Provider status pill
 *
 * Designed to be updated reactively: call setHp() each frame for smooth HP
 * bar updates; call setInventory() from the inventory onChange callback.
 */

import type { LootItem } from '../game/inventory'

export interface HudOptions {
  onSave: () => void
  onProviderSettings: () => void
}

export interface Hud {
  show(): void
  hide(): void
  /** Update the HP bar. Call every frame or on damage events. */
  setHp(hp: number, maxHp: number): void
  /** Update the loot counter. Call from inventory.onChange(). */
  setInventory(items: ReadonlyArray<LootItem>): void
  /** Update the provider status pill. */
  setProvider(id: string): void
  /** Remove HUD from DOM. */
  dispose(): void
}

/** Display labels for each loot id — defines the counter order (Gold / Wood / Iron). */
const LOOT_DISPLAY: Array<{ id: string; label: string }> = [
  { id: 'gold', label: 'Gold' },
  { id: 'wood', label: 'Wood' },
  { id: 'ironOre', label: 'Iron' },
]

export function createHud(opts: HudOptions): Hud {
  const root = document.createElement('div')
  root.id = 'hud'
  root.setAttribute('aria-label', 'Game HUD')
  root.style.display = 'none'

  // ── HP bar ────────────────────────────────────────────────────────────────
  const hpSection = document.createElement('div')
  hpSection.className = 'hud-hp'
  hpSection.setAttribute('aria-label', 'Health')

  const hpTrack = document.createElement('div')
  hpTrack.className = 'hud-hp-track'
  hpTrack.setAttribute('role', 'progressbar')
  hpTrack.setAttribute('aria-valuemin', '0')
  hpTrack.setAttribute('aria-valuenow', '100')
  hpTrack.setAttribute('aria-valuemax', '100')

  const hpFill = document.createElement('div')
  hpFill.className = 'hud-hp-fill'

  hpTrack.appendChild(hpFill)

  const hpText = document.createElement('span')
  hpText.className = 'hud-hp-text'
  hpText.textContent = '100 / 100'
  hpText.setAttribute('aria-hidden', 'true')

  hpSection.appendChild(hpTrack)
  hpSection.appendChild(hpText)

  // ── Loot counter ─────────────────────────────────────────────────────────
  const lootSection = document.createElement('div')
  lootSection.className = 'hud-loot'
  lootSection.setAttribute('aria-live', 'polite')
  lootSection.setAttribute('aria-label', 'Inventory')
  lootSection.textContent = 'Gold: 0 / Wood: 0 / Iron: 0'

  // ── Actions row (save + provider) ────────────────────────────────────────
  const actionsRow = document.createElement('div')
  actionsRow.className = 'hud-actions'

  const saveBtn = document.createElement('button')
  saveBtn.type = 'button'
  saveBtn.id = 'hud-save'
  saveBtn.className = 'hud-btn'
  saveBtn.textContent = 'Save'
  saveBtn.addEventListener('click', () => {
    opts.onSave()
    flashSave()
  })

  const providerPill = document.createElement('div')
  providerPill.id = 'hud-provider'
  providerPill.className = 'hud-provider-pill'
  providerPill.setAttribute('title', 'Click to configure AI provider')
  providerPill.setAttribute('role', 'button')
  providerPill.setAttribute('tabindex', '0')
  providerPill.textContent = 'Provider: —'
  providerPill.addEventListener('click', opts.onProviderSettings)
  providerPill.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      opts.onProviderSettings()
    }
  })

  actionsRow.appendChild(saveBtn)
  actionsRow.appendChild(providerPill)

  // ── Assemble ──────────────────────────────────────────────────────────────
  root.appendChild(hpSection)
  root.appendChild(lootSection)
  root.appendChild(actionsRow)
  document.body.appendChild(root)

  // ── Save flash ────────────────────────────────────────────────────────────
  let flashTimer: ReturnType<typeof setTimeout> | null = null

  function flashSave(): void {
    if (flashTimer) clearTimeout(flashTimer)
    saveBtn.textContent = 'Saved ✓'
    saveBtn.classList.add('hud-btn--saved')
    flashTimer = setTimeout(() => {
      saveBtn.textContent = 'Save'
      saveBtn.classList.remove('hud-btn--saved')
      flashTimer = null
    }, 1800)
  }

  // ── Public API ────────────────────────────────────────────────────────────
  let lastHpPct = -1

  return {
    show() {
      root.style.display = 'flex'
    },
    hide() {
      root.style.display = 'none'
    },

    setHp(hp: number, maxHp: number) {
      const pct = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0
      // Throttle DOM writes: only update when value changes by ≥0.5%
      if (Math.abs(pct - lastHpPct) < 0.005) return
      lastHpPct = pct

      hpFill.style.width = `${(pct * 100).toFixed(1)}%`
      // Colour: green > 60%, amber 30-60%, red < 30%
      const color =
        pct > 0.6 ? '#6abd6e' : pct > 0.3 ? '#e8a048' : '#cc3333'
      hpFill.style.background = color

      hpText.textContent = `${Math.ceil(hp)} / ${maxHp}`
      hpTrack.setAttribute('aria-valuenow', String(Math.ceil(hp)))
      hpTrack.setAttribute('aria-valuemax', String(maxHp))
    },

    setInventory(items: ReadonlyArray<LootItem>) {
      const counts: Record<string, number> = {}
      for (const item of items) counts[item.id] = (counts[item.id] ?? 0) + item.qty
      lootSection.textContent = LOOT_DISPLAY
        .map(({ id, label }) => `${label}: ${counts[id] ?? 0}`)
        .join(' / ')
    },

    setProvider(id: string) {
      providerPill.textContent = `Provider: ${id}`
    },

    dispose() {
      if (flashTimer) clearTimeout(flashTimer)
      root.remove()
    },
  }
}
