/**
 * Full-screen main menu overlay.
 *
 * Shown before the game starts. Hides when game begins.
 * Keyboard: Tab/Shift-Tab to navigate, Enter/Space to activate.
 * "Continue" button hidden when no save exists.
 * "Quit" shows a close-tab message (window.close() is blocked in most browsers).
 */

export interface MainMenuCallbacks {
  onNewGame: () => void
  onContinue: () => void
  onProviderSettings: () => void
}

export interface MainMenu {
  show(): void
  hide(): void
  setContinueAvailable(available: boolean): void
}

export function createMainMenu(callbacks: MainMenuCallbacks): MainMenu {
  const overlay = document.createElement('div')
  overlay.id = 'mm-overlay'
  overlay.setAttribute('role', 'main')
  overlay.setAttribute('aria-label', 'Main menu')
  overlay.style.display = 'none'

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
  overlay.appendChild(panel)
  document.body.appendChild(overlay)

  return {
    show() {
      overlay.style.display = 'flex'
      newGameBtn.focus()
    },
    hide() {
      overlay.style.display = 'none'
    },
    setContinueAvailable(available: boolean) {
      continueBtn.style.display = available ? 'block' : 'none'
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
