/**
 * Settings panel — nickname, audio, key-bindings.
 *
 * Replaces providerSettings.ts (BOO-485, supersedes BOO-391).
 * Provider config is server-side per P0-3/P0-4 — no provider fields in this panel.
 */
import { Howler } from 'howler'

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const LS_NICKNAME_KEY = 'korovan:nickname'
const LS_AUDIO_KEY = 'korovan:audio'
const LS_KEYBINDS_KEY = 'korovan:keybinds'

// ---------------------------------------------------------------------------
// Nickname
// ---------------------------------------------------------------------------

export function loadNickname(): string {
  return localStorage.getItem(LS_NICKNAME_KEY) ?? ''
}

export function saveNickname(name: string): void {
  const trimmed = name.trim().slice(0, 32)
  localStorage.setItem(LS_NICKNAME_KEY, trimmed)
  // Best-effort PATCH to the identity endpoint (ships with EP-2). Silently ignored if absent.
  void patchIdentity(trimmed)
}

async function patchIdentity(nickname: string): Promise<void> {
  try {
    await fetch('/api/identity/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname }),
    })
  } catch {
    // Endpoint not yet live — ignore
  }
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export interface AudioSettings {
  volume: number  // 0–1
  muted: boolean
}

const DEFAULT_AUDIO: AudioSettings = { volume: 0.6, muted: false }

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(LS_AUDIO_KEY)
    if (raw) return { ...DEFAULT_AUDIO, ...(JSON.parse(raw) as Partial<AudioSettings>) }
  } catch {
    // ignore
  }
  return { ...DEFAULT_AUDIO }
}

export function saveAudioSettings(s: AudioSettings): void {
  localStorage.setItem(LS_AUDIO_KEY, JSON.stringify(s))
  applyAudioSettings(s)
}

export function applyAudioSettings(s: AudioSettings): void {
  Howler.volume(s.muted ? 0 : s.volume)
  Howler.mute(s.muted)
}

// ---------------------------------------------------------------------------
// Key bindings (display constants; rebinder redesign is out of scope for BOO-485)
// ---------------------------------------------------------------------------

export const DEFAULT_KEYBINDS = {
  forward:  'W / ↑',
  backward: 'S / ↓',
  left:     'A / ←',
  right:    'D / →',
  jump:     'Space',
  attack:   'Left click',
  interact: 'E',
} as const

export type ActionLabel = keyof typeof DEFAULT_KEYBINDS

export function loadKeybinds(): typeof DEFAULT_KEYBINDS {
  try {
    const raw = localStorage.getItem(LS_KEYBINDS_KEY)
    if (raw) return { ...DEFAULT_KEYBINDS, ...(JSON.parse(raw) as Partial<typeof DEFAULT_KEYBINDS>) }
  } catch {
    // ignore
  }
  return { ...DEFAULT_KEYBINDS }
}

// ---------------------------------------------------------------------------
// Settings panel — DOM factory
// ---------------------------------------------------------------------------

export interface SettingsPanel {
  open(): void
  close(): void
  readonly element: HTMLElement
}

export function createSettingsPanel(): SettingsPanel {
  const overlay = document.createElement('div')
  overlay.id = 'st-overlay'
  overlay.className = 'st-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-labelledby', 'st-title')
  overlay.style.display = 'none'

  const panel = document.createElement('div')
  panel.className = 'st-panel'

  const title = document.createElement('h2')
  title.id = 'st-title'
  title.className = 'st-title'
  title.textContent = 'Settings'

  // ── Nickname section ──────────────────────────────────────────────────────
  const nicknameSection = makeSection('Nickname')

  const nicknameInput = document.createElement('input')
  nicknameInput.type = 'text'
  nicknameInput.id = 'st-nickname'
  nicknameInput.className = 'st-input'
  nicknameInput.placeholder = 'Your nickname'
  nicknameInput.maxLength = 32
  nicknameInput.setAttribute('aria-label', 'Nickname')
  nicknameInput.setAttribute('autocomplete', 'off')

  const charCount = document.createElement('span')
  charCount.id = 'st-nickname-count'
  charCount.className = 'st-char-count'
  charCount.setAttribute('aria-live', 'polite')
  charCount.textContent = '0 / 32'

  nicknameInput.addEventListener('input', () => {
    charCount.textContent = `${nicknameInput.value.length} / 32`
  })

  const nicknameRow = document.createElement('div')
  nicknameRow.className = 'st-input-row'
  nicknameRow.appendChild(nicknameInput)
  nicknameRow.appendChild(charCount)

  const nicknameSaveBtn = document.createElement('button')
  nicknameSaveBtn.type = 'button'
  nicknameSaveBtn.id = 'st-nickname-save'
  nicknameSaveBtn.className = 'st-btn st-btn--primary'
  nicknameSaveBtn.textContent = 'Save nickname'

  const nicknameResult = document.createElement('div')
  nicknameResult.id = 'st-nickname-result'
  nicknameResult.className = 'st-result'
  nicknameResult.setAttribute('aria-live', 'polite')
  nicknameResult.setAttribute('role', 'status')

  nicknameSaveBtn.addEventListener('click', () => {
    const name = nicknameInput.value.trim()
    saveNickname(name)
    nicknameResult.textContent = name ? `Nickname saved as "${name.slice(0, 32)}".` : 'Nickname cleared.'
    nicknameResult.className = 'st-result st-result--success'
    // Flash then clear
    setTimeout(() => {
      nicknameResult.textContent = ''
      nicknameResult.className = 'st-result'
    }, 2500)
  })

  nicknameSection.appendChild(nicknameRow)
  nicknameSection.appendChild(nicknameSaveBtn)
  nicknameSection.appendChild(nicknameResult)

  // ── Audio section ─────────────────────────────────────────────────────────
  const audioSection = makeSection('Audio')

  // Volume slider
  const volumeGroup = document.createElement('div')
  volumeGroup.className = 'st-field'

  const volumeLabel = document.createElement('label')
  volumeLabel.htmlFor = 'st-volume'
  volumeLabel.className = 'st-label'
  volumeLabel.textContent = 'Volume'

  const volumeRow = document.createElement('div')
  volumeRow.className = 'st-slider-row'

  const volumeSlider = document.createElement('input')
  volumeSlider.type = 'range'
  volumeSlider.id = 'st-volume'
  volumeSlider.className = 'st-slider'
  volumeSlider.min = '0'
  volumeSlider.max = '100'
  volumeSlider.value = String(Math.round(DEFAULT_AUDIO.volume * 100))
  volumeSlider.setAttribute('aria-label', 'Master volume')

  const volumeValSpan = document.createElement('span')
  volumeValSpan.id = 'st-volume-val'
  volumeValSpan.className = 'st-slider-val'
  volumeValSpan.textContent = `${Math.round(DEFAULT_AUDIO.volume * 100)}%`

  volumeSlider.addEventListener('input', () => {
    volumeValSpan.textContent = `${volumeSlider.value}%`
  })

  volumeRow.appendChild(volumeSlider)
  volumeRow.appendChild(volumeValSpan)
  volumeGroup.appendChild(volumeLabel)
  volumeGroup.appendChild(volumeRow)

  // Mute toggle
  const muteGroup = document.createElement('div')
  muteGroup.className = 'st-field st-field--inline'

  const muteLabel = document.createElement('label')
  muteLabel.htmlFor = 'st-mute'
  muteLabel.className = 'st-label'
  muteLabel.textContent = 'Mute all audio'

  const muteToggle = document.createElement('input')
  muteToggle.type = 'checkbox'
  muteToggle.id = 'st-mute'
  muteToggle.className = 'st-checkbox'
  muteToggle.checked = DEFAULT_AUDIO.muted

  muteGroup.appendChild(muteToggle)
  muteGroup.appendChild(muteLabel)

  const audioSaveBtn = document.createElement('button')
  audioSaveBtn.type = 'button'
  audioSaveBtn.id = 'st-audio-save'
  audioSaveBtn.className = 'st-btn st-btn--primary'
  audioSaveBtn.textContent = 'Apply audio'

  const audioResult = document.createElement('div')
  audioResult.id = 'st-audio-result'
  audioResult.className = 'st-result'
  audioResult.setAttribute('aria-live', 'polite')
  audioResult.setAttribute('role', 'status')

  audioSaveBtn.addEventListener('click', () => {
    const settings: AudioSettings = {
      volume: parseInt(volumeSlider.value, 10) / 100,
      muted: muteToggle.checked,
    }
    saveAudioSettings(settings)
    audioResult.textContent = settings.muted
      ? 'Audio muted.'
      : `Volume set to ${volumeSlider.value}%.`
    audioResult.className = 'st-result st-result--success'
    setTimeout(() => {
      audioResult.textContent = ''
      audioResult.className = 'st-result'
    }, 2500)
  })

  audioSection.appendChild(volumeGroup)
  audioSection.appendChild(muteGroup)
  audioSection.appendChild(audioSaveBtn)
  audioSection.appendChild(audioResult)

  // ── Key bindings section ──────────────────────────────────────────────────
  const keybindSection = makeSection('Key Bindings')

  const keybindNote = document.createElement('p')
  keybindNote.className = 'st-note'
  keybindNote.textContent = 'Default bindings — rebinding coming in a future release.'
  keybindSection.appendChild(keybindNote)

  const keybindTable = document.createElement('table')
  keybindTable.className = 'st-keybind-table'
  keybindTable.setAttribute('aria-label', 'Key bindings')

  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')
  for (const col of ['Action', 'Key']) {
    const th = document.createElement('th')
    th.className = 'st-keybind-th'
    th.textContent = col
    headerRow.appendChild(th)
  }
  thead.appendChild(headerRow)
  keybindTable.appendChild(thead)

  const tbody = document.createElement('tbody')
  const ACTION_LABELS: Record<ActionLabel, string> = {
    forward:  'Move forward',
    backward: 'Move backward',
    left:     'Move left',
    right:    'Move right',
    jump:     'Jump',
    attack:   'Attack',
    interact: 'Interact',
  }

  const binds = loadKeybinds()
  for (const [action, keyLabel] of Object.entries(binds) as Array<[ActionLabel, string]>) {
    const tr = document.createElement('tr')
    const tdAction = document.createElement('td')
    tdAction.className = 'st-keybind-td'
    tdAction.textContent = ACTION_LABELS[action]

    const tdKey = document.createElement('td')
    tdKey.className = 'st-keybind-td st-keybind-key'
    const kbd = document.createElement('kbd')
    kbd.textContent = keyLabel
    tdKey.appendChild(kbd)

    tr.appendChild(tdAction)
    tr.appendChild(tdKey)
    tbody.appendChild(tr)
  }
  keybindTable.appendChild(tbody)
  keybindSection.appendChild(keybindTable)

  // ── Close button ──────────────────────────────────────────────────────────
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.id = 'st-close'
  closeBtn.className = 'st-btn'
  closeBtn.textContent = 'Close'
  closeBtn.addEventListener('click', closePanel)

  // Click outside panel to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePanel()
  })

  // Esc to close
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel()
  })

  // ── Assemble ──────────────────────────────────────────────────────────────
  panel.appendChild(title)
  panel.appendChild(nicknameSection)
  panel.appendChild(audioSection)
  panel.appendChild(keybindSection)
  panel.appendChild(closeBtn)
  overlay.appendChild(panel)
  document.body.appendChild(overlay)

  // ── Internal helpers ──────────────────────────────────────────────────────
  function fillFromStorage(): void {
    const nickname = loadNickname()
    nicknameInput.value = nickname
    charCount.textContent = `${nickname.length} / 32`

    const audio = loadAudioSettings()
    volumeSlider.value = String(Math.round(audio.volume * 100))
    volumeValSpan.textContent = `${Math.round(audio.volume * 100)}%`
    muteToggle.checked = audio.muted
  }

  function closePanel(): void {
    overlay.style.display = 'none'
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    open() {
      fillFromStorage()
      nicknameResult.textContent = ''
      nicknameResult.className = 'st-result'
      audioResult.textContent = ''
      audioResult.className = 'st-result'
      overlay.style.display = 'flex'
      nicknameInput.focus()
    },
    close: closePanel,
    get element() {
      return overlay
    },
  }
}

// ---------------------------------------------------------------------------
// DOM helper
// ---------------------------------------------------------------------------

function makeSection(heading: string): HTMLElement {
  const section = document.createElement('section')
  section.className = 'st-section'
  const h3 = document.createElement('h3')
  h3.className = 'st-section-title'
  h3.textContent = heading
  section.appendChild(h3)
  return section
}
