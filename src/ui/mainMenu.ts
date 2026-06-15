/**
 * Full-screen main menu overlay.
 *
 * Shown before the game starts. Hides when game begins.
 * Keyboard: Tab/Shift-Tab to navigate, Enter/Space to activate.
 * "Continue" button hidden when no save exists.
 * "Quit" shows a close-tab message (window.close() is blocked in most browsers).
 *
 * A leaderboard panel is mounted to the right of the nav column and refreshes
 * each time the menu is shown.
 */

import { createLeaderboardPanel, type LeaderboardPanel } from './leaderboard'

export interface MainMenuCallbacks {
  onNewGame: () => void
  onContinue: () => void
  onProviderSettings: () => void
}

export interface MainMenuOptions {
  /** Leaderboard zone identifier (default: 'forest'). */
  zone?: string
  /** Leaderboard faction identifier (default: 'player'). */
  faction?: string
}

export interface MainMenu {
  show(): void
  hide(): void
  setContinueAvailable(available: boolean): void
  /** Refresh the leaderboard (call after a successful score submit). */
  refreshLeaderboard(): void
  dispose(): void
}

export function createMainMenu(
  callbacks: MainMenuCallbacks,
  opts: MainMenuOptions = {},
): MainMenu {
  const { zone = 'forest', faction = 'player' } = opts

  const overlay = document.createElement('div')
  overlay.id = 'mm-overlay'
  overlay.setAttribute('role', 'main')
  overlay.setAttribute('aria-label', 'Main menu')
  overlay.style.display = 'none'

  // ── Left column: branding + nav ───────────────────────────────────────────
  const panel = document.createElement('div')
  panel.className = 'mm-panel'

  const logo = document.createElement('h1')
  logo.className = 'mm-logo'
  logo.textContent = 'Korovan'

  const subtitle = document.createElement('p')
  subtitle.className = 'mm-subtitle'
  subtitle.textContent = 'Caravan escort through the dark forest'

  const nav = document.createElement('nav')
  nav.className = 'mm-nav'
  nav.setAttribute('aria-label', 'Main menu actions')

  const newGameBtn = makeMenuBtn('New Game', 'mm-btn--primary', callbacks.onNewGame)
  newGameBtn.id = 'mm-new-game'

  const continueBtn = makeMenuBtn('Continue', '', callbacks.onContinue)
  continueBtn.id = 'mm-continue'
  continueBtn.style.display = 'none'

  const providerBtn = makeMenuBtn('Provider Settings', '', callbacks.onProviderSettings)
  providerBtn.id = 'mm-provider'

  const quitBtn = makeMenuBtn('Quit', 'mm-btn--muted', () => {
    quitMsg.style.display = 'block'
    window.close()
  })
  quitBtn.id = 'mm-quit'

  const quitMsg = document.createElement('p')
  quitMsg.className = 'mm-quit-msg'
  quitMsg.textContent = 'Close this browser tab to quit.'
  quitMsg.style.display = 'none'
  quitMsg.setAttribute('role', 'status')

  nav.appendChild(newGameBtn)
  nav.appendChild(continueBtn)
  nav.appendChild(providerBtn)
  nav.appendChild(quitBtn)

  panel.appendChild(logo)
  panel.appendChild(subtitle)
  panel.appendChild(nav)
  panel.appendChild(quitMsg)

  // ── Right column: leaderboard ─────────────────────────────────────────────
  const lbPanel: LeaderboardPanel = createLeaderboardPanel({ zone, faction })

  // ── Assemble ──────────────────────────────────────────────────────────────
  overlay.appendChild(panel)
  overlay.appendChild(lbPanel.element)
  document.body.appendChild(overlay)

  return {
    show() {
      overlay.style.display = 'flex'
      lbPanel.refresh()
      newGameBtn.focus()
    },
    hide() {
      overlay.style.display = 'none'
    },
    setContinueAvailable(available: boolean) {
      continueBtn.style.display = available ? 'block' : 'none'
    },
    refreshLeaderboard() {
      lbPanel.refresh()
    },
    dispose() {
      lbPanel.dispose()
      overlay.remove()
    },
  }
}

function makeMenuBtn(label: string, extraClass: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = ['mm-btn', extraClass].filter(Boolean).join(' ')
  btn.textContent = label
  btn.addEventListener('click', onClick)
  return btn
}
