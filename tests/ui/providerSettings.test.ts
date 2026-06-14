import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createProviderSettingsPanel,
  loadProviderSettings,
  saveProviderSettings,
  clearProviderSettings,
} from '../../src/ui/providerSettings'
import { LLMError } from '../../src/ai/types'
import type { LLMProvider, ProviderSettings } from '../../src/ai/types'

// ---------------------------------------------------------------------------
// Mock createProvider so tests never hit the real adapter registry
// ---------------------------------------------------------------------------

const mockCreateProvider = vi.fn<(s: ProviderSettings) => LLMProvider>()

vi.mock('../../src/ai/client', () => ({
  createProvider: (s: ProviderSettings) => mockCreateProvider(s),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePanel() {
  const panel = createProviderSettingsPanel()
  panel.open()
  return panel
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

function fillForm(
  baseUrl = 'https://api.deepseek.com/v1',
  model = 'deepseek-chat',
  apiKey = 'sk-test',
  timeoutSecs = '20',
) {
  const baseUrlInput = el<HTMLInputElement>('ps-base-url')
  const modelInput = el<HTMLInputElement>('ps-model')
  const apiKeyInput = el<HTMLInputElement>('ps-api-key')
  const timeoutSlider = el<HTMLInputElement>('ps-timeout')

  baseUrlInput.value = baseUrl
  modelInput.value = model
  apiKeyInput.value = apiKey
  timeoutSlider.value = timeoutSecs
  // Fire input event so the label updates
  timeoutSlider.dispatchEvent(new Event('input'))
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  mockCreateProvider.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Structural / rendering tests
// ---------------------------------------------------------------------------

describe('createProviderSettingsPanel — structure', () => {
  it('renders overlay, panel, and all required fields when open()', () => {
    makePanel()
    expect(el('ps-overlay')).toBeTruthy()
    expect(el('ps-base-url')).toBeTruthy()
    expect(el('ps-model')).toBeTruthy()
    expect(el('ps-api-key')).toBeTruthy()
    expect(el('ps-timeout')).toBeTruthy()
    expect(el('ps-test')).toBeTruthy()
    expect(el('ps-save')).toBeTruthy()
    expect(el('ps-forget')).toBeTruthy()
    expect(el('ps-close')).toBeTruthy()
  })

  it('shows overlay on open() and hides on close()', () => {
    const panel = makePanel()
    expect(el('ps-overlay').style.display).toBe('flex')
    panel.close()
    expect(el('ps-overlay').style.display).toBe('none')
  })

  it('API key input is type="password"', () => {
    makePanel()
    expect(el<HTMLInputElement>('ps-api-key').type).toBe('password')
  })

  it('provider dropdown is disabled and has tabIndex -1', () => {
    makePanel()
    const select = document
      .querySelector<HTMLSelectElement>('.ps-select')!
    expect(select.disabled).toBe(true)
    expect(select.tabIndex).toBe(-1)
  })

  it('provider dropdown only has the DeepSeek option', () => {
    makePanel()
    const select = document.querySelector<HTMLSelectElement>('.ps-select')!
    expect(select.options).toHaveLength(1)
    expect(select.options[0].value).toBe('deepseek')
  })

  it('displays security warning text', () => {
    makePanel()
    const warning = document.querySelector('.ps-warning')
    expect(warning?.textContent).toContain('stored in this browser only')
  })

  it('"Use default" pre-fills base URL', () => {
    makePanel()
    el<HTMLInputElement>('ps-base-url').value = ''
    el('ps-use-default').click()
    expect(el<HTMLInputElement>('ps-base-url').value).toBe(
      'https://api.deepseek.com/v1',
    )
  })

  it('timeout slider label updates on input', () => {
    makePanel()
    const slider = el<HTMLInputElement>('ps-timeout')
    slider.value = '42'
    slider.dispatchEvent(new Event('input'))
    expect(el('ps-timeout-val').textContent).toBe('42 s')
  })
})

// ---------------------------------------------------------------------------
// Test connection — success path
// ---------------------------------------------------------------------------

describe('Test connection — success', () => {
  it('calls createProvider with form values and shows elapsed-time message', async () => {
    mockCreateProvider.mockReturnValue({
      complete: async () => ({ content: 'pong' }),
    })

    makePanel()
    fillForm()
    el('ps-test').click()

    // Wait for async ping to resolve
    await vi.waitFor(() =>
      expect(el('ps-result').textContent).toMatch(/Reached model `deepseek-chat` in \d+ ms/),
    )

    expect(el('ps-result').classList.contains('ps-result--success')).toBe(true)
    expect(mockCreateProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'deepseek', model: 'deepseek-chat' }),
    )
  })

  it('re-enables the test button after success', async () => {
    mockCreateProvider.mockReturnValue({ complete: async () => ({ content: 'ok' }) })
    makePanel()
    fillForm()
    el('ps-test').click()

    await vi.waitFor(() =>
      expect(el<HTMLButtonElement>('ps-test').disabled).toBe(false),
    )
    expect(el<HTMLButtonElement>('ps-test').textContent).toBe('Test connection')
  })
})

// ---------------------------------------------------------------------------
// Test connection — failure paths (one per LLMErrorCode + unknown)
// ---------------------------------------------------------------------------

const ERROR_CASES: Array<[string, string]> = [
  ['auth', 'Authentication failed'],
  ['rate-limited', 'Rate limit reached'],
  ['timeout', 'Request timed out'],
  ['network', 'Network error'],
  ['provider-unreachable', 'Provider unreachable'],
  ['invalid-shape', 'Unexpected response'],
]

describe('Test connection — failure modes', () => {
  for (const [code, expectedSnippet] of ERROR_CASES) {
    it(`shows human-friendly message for LLMError(${code})`, async () => {
      mockCreateProvider.mockReturnValue({
        complete: () => Promise.reject(new LLMError(code as never, 'test error')),
      })

      makePanel()
      fillForm()
      el('ps-test').click()

      await vi.waitFor(() =>
        expect(el('ps-result').textContent).toContain(expectedSnippet),
      )

      expect(el('ps-result').classList.contains('ps-result--error')).toBe(true)
    })
  }

  it('does not echo apiKey in error result for auth failure', async () => {
    mockCreateProvider.mockReturnValue({
      complete: () => Promise.reject(new LLMError('auth', 'invalid key sk-super-secret')),
    })

    makePanel()
    fillForm(undefined, undefined, 'sk-super-secret')
    el('ps-test').click()

    await vi.waitFor(() =>
      expect(el('ps-result').textContent).not.toBe(''),
    )

    expect(el('ps-result').textContent).not.toContain('sk-super-secret')
  })

  it('shows fallback message for non-LLMError exceptions', async () => {
    mockCreateProvider.mockReturnValue({
      complete: () => Promise.reject(new Error('unexpected')),
    })

    makePanel()
    fillForm()
    el('ps-test').click()

    await vi.waitFor(() =>
      expect(el('ps-result').textContent).toContain('Network error'),
    )
  })

  it('re-enables the test button after failure', async () => {
    mockCreateProvider.mockReturnValue({
      complete: () => Promise.reject(new LLMError('network', 'err')),
    })
    makePanel()
    fillForm()
    el('ps-test').click()

    await vi.waitFor(() =>
      expect(el<HTMLButtonElement>('ps-test').disabled).toBe(false),
    )
  })
})

// ---------------------------------------------------------------------------
// Save / Forget / persistence
// ---------------------------------------------------------------------------

describe('Save and persistence', () => {
  it('Save button persists form values to localStorage', () => {
    makePanel()
    fillForm('https://custom.deepseek.com/v1', 'deepseek-coder', 'sk-abc', '30')
    el('ps-save').click()

    const stored = loadProviderSettings()
    expect(stored.baseUrl).toBe('https://custom.deepseek.com/v1')
    expect(stored.model).toBe('deepseek-coder')
    expect(stored.apiKey).toBe('sk-abc')
    expect(stored.timeoutMs).toBe(30_000)
  })

  it('open() pre-fills form from localStorage', () => {
    saveProviderSettings({
      id: 'deepseek',
      baseUrl: 'https://api.example.com',
      model: 'my-model',
      apiKey: 'sk-stored',
      timeoutMs: 15_000,
    })

    const panel = createProviderSettingsPanel()
    panel.open()

    expect(el<HTMLInputElement>('ps-base-url').value).toBe('https://api.example.com')
    expect(el<HTMLInputElement>('ps-model').value).toBe('my-model')
    expect(el<HTMLInputElement>('ps-api-key').value).toBe('sk-stored')
    expect(el<HTMLInputElement>('ps-timeout').value).toBe('15')
  })
})

describe('Forget provider', () => {
  it('clears localStorage and resets form fields', () => {
    saveProviderSettings({
      id: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-xyz',
      timeoutMs: 20_000,
    })

    makePanel()
    el('ps-forget').click()

    expect(localStorage.getItem('korovan:provider-settings')).toBeNull()
    expect(el<HTMLInputElement>('ps-base-url').value).toBe('')
    expect(el<HTMLInputElement>('ps-model').value).toBe('')
    expect(el<HTMLInputElement>('ps-api-key').value).toBe('')
    expect(el<HTMLInputElement>('ps-timeout').value).toBe('20')
    expect(el('ps-result').textContent).toBe('')
  })
})

// ---------------------------------------------------------------------------
// localStorage helpers — unit tests
// ---------------------------------------------------------------------------

describe('localStorage helpers', () => {
  it('loadProviderSettings returns {} when nothing stored', () => {
    expect(loadProviderSettings()).toEqual({})
  })

  it('round-trips saveProviderSettings → loadProviderSettings', () => {
    const s = {
      id: 'deepseek' as const,
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-roundtrip',
      timeoutMs: 20_000,
    }
    saveProviderSettings(s)
    expect(loadProviderSettings()).toEqual(s)
  })

  it('clearProviderSettings removes the entry', () => {
    saveProviderSettings({
      id: 'deepseek',
      baseUrl: 'x',
      model: 'y',
      apiKey: 'z',
      timeoutMs: 1000,
    })
    clearProviderSettings()
    expect(loadProviderSettings()).toEqual({})
  })

  it('loadProviderSettings returns {} on malformed JSON', () => {
    localStorage.setItem('korovan:provider-settings', '{bad json')
    expect(loadProviderSettings()).toEqual({})
  })
})
