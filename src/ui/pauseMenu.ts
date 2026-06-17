/**
 * Pause menu overlay — triggered by Esc (pointer-lock release).
 *
 * Traps focus while open (Tab cycles through menu buttons only).
 * "Resume" re-acquires pointer lock and returns to gameplay.
 * "Main Menu" reloads the page (simplest clean-slate approach for P1).
 */

export interface PauseMenuCallbacks {
  onResume: () => void
  onSave: () => void
  onSettings: () => void
  onMainMenu: () => void
  onOpenMap: () => void
}

export interface PauseMenu {
  open(): void
  close(): void
  readonly isOpen: boolean
}

export function createPauseMenu(callbacks: PauseMenuCallbacks): PauseMenu {
  let _isOpen = false

  const overlay = document.createElement('div')
  overlay.id = 'pm-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-labelledby', 'pm-title')
  overlay.style.display = 'none'

  const panel = document.createElement('div')
  panel.className = 'pm-panel'

  const title = document.createElement('h2')
  title.id = 'pm-title'
  title.className = 'pm-title'
  title.textContent = 'Paused'

  const nav = document.createElement('nav')
  nav.className = 'pm-nav'
  nav.setAttribute('aria-label', 'Pause menu')

  const resumeBtn = makeBtn('Resume', 'pm-btn--primary', () => {
    callbacks.onResume()
    close()
  })
  resumeBtn.id = 'pm-resume'

  const saveBtn = makeBtn('Save', '', () => {
    callbacks.onSave()
    flashSaveBtn()
  })
  saveBtn.id = 'pm-save'

  const travelBtn = makeBtn('Travel (Map)', '', () => {
    close()
    callbacks.onOpenMap()
  })
  travelBtn.id = 'pm-travel'

  const providerBtn = makeBtn('Settings', '', () => {
    callbacks.onSettings()
    // Keep pause menu open so user can return to it after settings
  })
  providerBtn.id = 'pm-settings'

  const mainMenuBtn = makeBtn('Main Menu', 'pm-btn--muted', () => {
    callbacks.onMainMenu()
    // onMainMenu is expected to trigger page reload
  })
  mainMenuBtn.id = 'pm-main-menu'

  nav.appendChild(resumeBtn)
  nav.appendChild(saveBtn)
  nav.appendChild(travelBtn)
  nav.appendChild(providerBtn)
  nav.appendChild(mainMenuBtn)

  panel.appendChild(title)
  panel.appendChild(nav)
  overlay.appendChild(panel)
  document.body.appendChild(overlay)

  // ── Focus trap ─────────────────────────────────────────────────────────────
  const focusable = [resumeBtn, saveBtn, travelBtn, providerBtn, mainMenuBtn]

  overlay.addEventListener('keydown', (e) => {
    if (!_isOpen) return
    if (e.key === 'Escape') {
      callbacks.onResume()
      close()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const idx = focusable.indexOf(document.activeElement as HTMLButtonElement)
      const next = e.shiftKey
        ? (idx - 1 + focusable.length) % focusable.length
        : (idx + 1) % focusable.length
      focusable[next].focus()
    }
  })

  // ── Save flash ─────────────────────────────────────────────────────────────
  let flashTimer: ReturnType<typeof setTimeout> | null = null

  function flashSaveBtn(): void {
    if (flashTimer) clearTimeout(flashTimer)
    saveBtn.textContent = 'Saved ✓'
    saveBtn.classList.add('pm-btn--saved')
    flashTimer = setTimeout(() => {
      saveBtn.textContent = 'Save'
      saveBtn.classList.remove('pm-btn--saved')
      flashTimer = null
    }, 1800)
  }

  // ── Private open/close ─────────────────────────────────────────────────────
  function close(): void {
    _isOpen = false
    overlay.style.display = 'none'
    if (flashTimer) {
      clearTimeout(flashTimer)
      saveBtn.textContent = 'Save'
      saveBtn.classList.remove('pm-btn--saved')
      flashTimer = null
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    open() {
      _isOpen = true
      overlay.style.display = 'flex'
      resumeBtn.focus()
    },
    close() {
      close()
    },
    get isOpen() {
      return _isOpen
    },
  }
}

function makeBtn(label: string, extraClass: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = ['pm-btn', extraClass].filter(Boolean).join(' ')
  btn.textContent = label
  btn.addEventListener('click', onClick)
  return btn
}
