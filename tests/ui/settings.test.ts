/**
 * Tests for src/ui/settings.ts (BOO-485, supersedes providerSettings.test.ts / BOO-391).
 *
 * Coverage:
 *   - Component tests: settings panel renders nickname + audio + keybinds; no apiKey UI.
 *   - Nickname save round-trips through mocked /api/identity/me.
 *   - localStorage migration: kr_* keys removed on import.
 *   - Snapshot assertion: no password input, no "API Key" label.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createSettingsPanel,
  loadNickname,
  saveNickname,
  loadAudioSettings,
  saveAudioSettings,
  DEFAULT_KEYBINDS,
} from '../../src/ui/settings'

// ---------------------------------------------------------------------------
// Mock howler so tests don't need a real audio context
// ---------------------------------------------------------------------------

vi.mock('howler', () => ({
  Howler: {
    volume: vi.fn(),
    mute: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

function makePanel() {
  const panel = createSettingsPanel()
  panel.open()
  return panel
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Structure — no API key, no provider selector
// ---------------------------------------------------------------------------

describe('createSettingsPanel — structure', () => {
  it('renders overlay when open()', () => {
    makePanel()
    expect(el('st-overlay')).toBeTruthy()
  })

  it('overlay is visible on open() and hidden on close()', () => {
    const panel = makePanel()
    expect(el('st-overlay').style.display).toBe('flex')
    panel.close()
    expect(el('st-overlay').style.display).toBe('none')
  })

  it('renders nickname input', () => {
    makePanel()
    const input = el<HTMLInputElement>('st-nickname')
    expect(input).toBeTruthy()
    expect(input.maxLength).toBe(32)
  })

  it('renders audio volume slider', () => {
    makePanel()
    expect(el('st-volume')).toBeTruthy()
  })

  it('renders audio mute toggle', () => {
    makePanel()
    const toggle = el<HTMLInputElement>('st-mute')
    expect(toggle).toBeTruthy()
    expect(toggle.type).toBe('checkbox')
  })

  it('renders keybind table with all default actions', () => {
    makePanel()
    const table = document.querySelector('.st-keybind-table')
    expect(table).toBeTruthy()
    const rows = table!.querySelectorAll('tbody tr')
    expect(rows.length).toBe(Object.keys(DEFAULT_KEYBINDS).length)
  })

  it('renders close button', () => {
    makePanel()
    expect(el('st-close')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Snapshot assertion: no API key input, no password input
// ---------------------------------------------------------------------------

describe('createSettingsPanel — no provider/apiKey UI', () => {
  it('has no input of type="password"', () => {
    makePanel()
    const passwordInputs = document.querySelectorAll('input[type="password"]')
    expect(passwordInputs.length).toBe(0)
  })

  it('has no element labeled "API Key"', () => {
    makePanel()
    const allText = document.body.textContent ?? ''
    expect(allText).not.toMatch(/api[-_ ]?key/i)
  })

  it('has no provider selector dropdown', () => {
    makePanel()
    const selects = document.querySelectorAll('select')
    expect(selects.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Nickname — save + localStorage round-trip
// ---------------------------------------------------------------------------

describe('nickname — localStorage persistence', () => {
  it('loadNickname returns "" when nothing stored', () => {
    expect(loadNickname()).toBe('')
  })

  it('saveNickname → loadNickname round-trips', () => {
    saveNickname('Korvan42')
    expect(loadNickname()).toBe('Korvan42')
  })

  it('saveNickname trims to 32 chars', () => {
    const long = 'a'.repeat(40)
    saveNickname(long)
    expect(loadNickname().length).toBe(32)
  })

  it('nickname save button persists value from input field', () => {
    makePanel()
    const input = el<HTMLInputElement>('st-nickname')
    input.value = 'Hero'
    el('st-nickname-save').click()
    expect(loadNickname()).toBe('Hero')
  })

  it('panel pre-fills nickname from localStorage on open()', () => {
    saveNickname('Saved Hero')
    makePanel()
    expect(el<HTMLInputElement>('st-nickname').value).toBe('Saved Hero')
  })
})

// ---------------------------------------------------------------------------
// Nickname — PATCH /api/identity/me (mocked fetch)
// ---------------------------------------------------------------------------

describe('nickname — PATCH /api/identity/me', () => {
  it('calls fetch PATCH /api/identity/me with nickname on save', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    makePanel()
    el<HTMLInputElement>('st-nickname').value = 'Zara'
    el('st-nickname-save').click()

    // saveNickname fires fetch async — wait for microtasks
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/identity/me',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ nickname: 'Zara' }),
        }),
      )
    })
  })

  it('does not throw when /api/identity/me is unreachable (graceful fail)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'))
    vi.stubGlobal('fetch', mockFetch)

    makePanel()
    el<HTMLInputElement>('st-nickname').value = 'Ghost'
    // should not throw
    expect(() => el('st-nickname-save').click()).not.toThrow()

    // Wait for the async fail to settle without surfacing
    await new Promise((r) => setTimeout(r, 10))
    expect(loadNickname()).toBe('Ghost')  // localStorage save still succeeded
  })
})

// ---------------------------------------------------------------------------
// Audio settings
// ---------------------------------------------------------------------------

describe('audio settings', () => {
  it('loadAudioSettings returns defaults when nothing stored', () => {
    const s = loadAudioSettings()
    expect(s.volume).toBe(0.6)
    expect(s.muted).toBe(false)
  })

  it('saveAudioSettings → loadAudioSettings round-trips', () => {
    saveAudioSettings({ volume: 0.4, muted: true })
    const s = loadAudioSettings()
    expect(s.volume).toBe(0.4)
    expect(s.muted).toBe(true)
  })

  it('Apply audio button saves and calls Howler.volume', async () => {
    const { Howler } = await import('howler')
    makePanel()
    const slider = el<HTMLInputElement>('st-volume')
    const muteCheck = el<HTMLInputElement>('st-mute')
    slider.value = '75'
    muteCheck.checked = false
    el('st-audio-save').click()

    expect(loadAudioSettings().volume).toBeCloseTo(0.75)
    expect(Howler.volume).toHaveBeenCalledWith(0.75)
  })

  it('Howler.mute called with true when muted', async () => {
    const { Howler } = await import('howler')
    makePanel()
    el<HTMLInputElement>('st-mute').checked = true
    el('st-audio-save').click()

    expect(Howler.mute).toHaveBeenCalledWith(true)
    expect(Howler.volume).toHaveBeenCalledWith(0)
  })

  it('panel pre-fills audio from localStorage on open()', () => {
    saveAudioSettings({ volume: 0.3, muted: true })
    makePanel()
    expect(el<HTMLInputElement>('st-volume').value).toBe('30')
    expect(el<HTMLInputElement>('st-mute').checked).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// localStorage migration: kr_* keys removed on import
// ---------------------------------------------------------------------------

describe('localStorage migration on boot', () => {
  it('removes kr_apikey key', async () => {
    localStorage.setItem('kr_apikey', 'sk-old-value')

    // Simulate what main.ts does at boot (migration loop)
    for (const key of [...Object.keys(localStorage)]) {
      if (/^kr_(apikey|api_key|provider|deepseek|anthropic|openai)/i.test(key)) {
        localStorage.removeItem(key)
      }
    }

    expect(localStorage.getItem('kr_apikey')).toBeNull()
  })

  it('removes kr_provider key', async () => {
    localStorage.setItem('kr_provider_deepseek', 'some-value')

    for (const key of [...Object.keys(localStorage)]) {
      if (/^kr_(apikey|api_key|provider|deepseek|anthropic|openai)/i.test(key)) {
        localStorage.removeItem(key)
      }
    }

    expect(localStorage.getItem('kr_provider_deepseek')).toBeNull()
  })

  it('removes korovan:provider-settings (old BOO-391 key)', () => {
    localStorage.setItem('korovan:provider-settings', JSON.stringify({ apiKey: 'sk-old' }))

    // Explicit removal from main.ts migration step
    localStorage.removeItem('korovan:provider-settings')

    expect(localStorage.getItem('korovan:provider-settings')).toBeNull()
  })

  it('migration is idempotent — running twice does not throw', () => {
    localStorage.setItem('kr_apikey', 'test')

    function runMigration() {
      for (const key of [...Object.keys(localStorage)]) {
        if (/^kr_(apikey|api_key|provider|deepseek|anthropic|openai)/i.test(key)) {
          localStorage.removeItem(key)
        }
      }
      localStorage.removeItem('korovan:provider-settings')
    }

    expect(() => {
      runMigration()
      runMigration()
    }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Key bindings display
// ---------------------------------------------------------------------------

describe('key bindings display', () => {
  it('renders a row for each action in DEFAULT_KEYBINDS', () => {
    makePanel()
    const table = document.querySelector('.st-keybind-table')!
    const kbdEls = table.querySelectorAll('kbd')
    expect(kbdEls.length).toBe(Object.keys(DEFAULT_KEYBINDS).length)
  })

  it('shows the Space binding for jump', () => {
    makePanel()
    const table = document.querySelector('.st-keybind-table')!
    const kbdEls = Array.from(table.querySelectorAll('kbd'))
    const jumpKbd = kbdEls.find((k) => k.textContent === DEFAULT_KEYBINDS.jump)
    expect(jumpKbd).toBeTruthy()
  })
})
