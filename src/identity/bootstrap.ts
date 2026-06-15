import { showNicknameModal } from './nicknameModal'

const BOOTSTRAP_URL = '/api/identity/bootstrap'
const FIRST_VISIT_KEY = 'kr_first_visit_done'

const MAX_RETRIES = 5
const BASE_DELAY_MS = 500

export interface BootstrapResult {
  playerId: string
  nickname: string | null
}

let _playerId: string | null = null

export function getPlayerId(): string | null {
  return _playerId
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pre-game-load hook. Shows a connection overlay, calls POST /api/identity/bootstrap
 * with retry/backoff, then optionally prompts for a nickname on first visit.
 * Resolves only after a successful bootstrap — game scenes must not mount before this.
 */
export async function runBootstrap(): Promise<BootstrapResult> {
  const { overlay, setStatus, waitForManualRetry } = mountBootstrapOverlay()

  let result: BootstrapResult
  try {
    result = await retryLoop(setStatus, waitForManualRetry)
  } finally {
    overlay.remove()
  }

  _playerId = result.playerId

  if (result.nickname === null && localStorage.getItem(FIRST_VISIT_KEY) !== '1') {
    await showNicknameModal()
  }
  localStorage.setItem(FIRST_VISIT_KEY, '1')

  return result
}

/**
 * Lightweight re-authentication helper for use by CR-2 / CR-3 / CR-4
 * after receiving a 401 on any API call. Does NOT show any UI.
 */
export async function reBootstrap(): Promise<BootstrapResult> {
  const resp = await fetch(BOOTSTRAP_URL, { method: 'POST', credentials: 'include' })
  if (!resp.ok) throw new Error(`reBootstrap HTTP ${resp.status}`)
  const json = (await resp.json()) as { player_id: string; nickname: string | null }
  _playerId = json.player_id
  return { playerId: json.player_id, nickname: json.nickname }
}

// ---------------------------------------------------------------------------
// Internal retry loop
// ---------------------------------------------------------------------------

async function callBootstrapOnce(): Promise<BootstrapResult> {
  const resp = await fetch(BOOTSTRAP_URL, { method: 'POST', credentials: 'include' })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const json = (await resp.json()) as { player_id: string; nickname: string | null }
  return { playerId: json.player_id, nickname: json.nickname }
}

async function retryLoop(
  setStatus: (msg: string) => void,
  waitForManualRetry: () => Promise<void>,
): Promise<BootstrapResult> {
  for (;;) {
    setStatus('Connecting…')
    let lastErr: unknown

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await callBootstrapOnce()
      } catch (err) {
        lastErr = err
        if (attempt < MAX_RETRIES - 1) {
          const delayMs = BASE_DELAY_MS * 2 ** attempt
          const delaySec = Math.ceil(delayMs / 1000)
          setStatus(`Couldn’t connect — retrying in ${delaySec}s…`)
          await sleep(delayMs)
        }
      }
    }

    console.warn('[korovan/bootstrap] max retries exhausted:', lastErr)
    setStatus('Connection failed.')
    await waitForManualRetry()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Bootstrap overlay DOM
// ---------------------------------------------------------------------------

interface BootstrapOverlay {
  overlay: HTMLElement
  setStatus: (msg: string) => void
  waitForManualRetry: () => Promise<void>
}

function mountBootstrapOverlay(): BootstrapOverlay {
  const overlay = document.createElement('div')
  overlay.id = 'bs-overlay'
  overlay.setAttribute('role', 'alertdialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-labelledby', 'bs-title')
  overlay.setAttribute('aria-describedby', 'bs-status')

  const panel = document.createElement('div')
  panel.className = 'bs-panel'

  const title = document.createElement('h1')
  title.id = 'bs-title'
  title.className = 'bs-title'
  title.textContent = 'Korovan'

  const statusEl = document.createElement('p')
  statusEl.id = 'bs-status'
  statusEl.className = 'bs-status'
  statusEl.setAttribute('aria-live', 'polite')
  statusEl.setAttribute('role', 'status')
  statusEl.textContent = 'Connecting…'

  const retryBtn = document.createElement('button')
  retryBtn.id = 'bs-retry'
  retryBtn.type = 'button'
  retryBtn.className = 'bs-btn'
  retryBtn.textContent = 'Retry'
  retryBtn.style.display = 'none'

  panel.appendChild(title)
  panel.appendChild(statusEl)
  panel.appendChild(retryBtn)
  overlay.appendChild(panel)
  document.body.appendChild(overlay)

  function setStatus(msg: string): void {
    statusEl.textContent = msg
    retryBtn.style.display = 'none'
  }

  function waitForManualRetry(): Promise<void> {
    retryBtn.style.display = 'block'
    retryBtn.focus()
    return new Promise<void>((resolve) => {
      retryBtn.addEventListener('click', () => resolve(), { once: true })
    })
  }

  return { overlay, setStatus, waitForManualRetry }
}
