import { createProvider } from '../ai/client'
import { LLMError } from '../ai/types'
import type { ProviderSettings } from '../ai/types'

const LS_KEY = 'korovan:provider-settings'

const DEEPSEEK_DEFAULTS = {
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  timeoutSecs: 20,
} as const

const ERROR_MESSAGES: Record<string, string> = {
  auth: 'Authentication failed — check your API key.',
  'rate-limited': 'Rate limit reached — try again in a few moments.',
  timeout: 'Request timed out — the provider may be slow or unreachable.',
  network: 'Network error — check your internet connection.',
  'provider-unreachable': 'Provider unreachable — verify the base URL.',
  'invalid-shape': 'Unexpected response from provider — the adapter may need updating.',
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

export function loadProviderSettings(): Partial<ProviderSettings> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as Partial<ProviderSettings>) : {}
  } catch {
    return {}
  }
}

export function saveProviderSettings(s: ProviderSettings): void {
  localStorage.setItem(LS_KEY, JSON.stringify(s))
}

export function clearProviderSettings(): void {
  localStorage.removeItem(LS_KEY)
}

// ---------------------------------------------------------------------------
// Panel factory
// ---------------------------------------------------------------------------

export interface ProviderSettingsPanel {
  open: () => void
  close: () => void
  element: HTMLElement
}

export function createProviderSettingsPanel(): ProviderSettingsPanel {
  // Overlay
  const overlay = document.createElement('div')
  overlay.id = 'ps-overlay'
  overlay.className = 'ps-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-labelledby', 'ps-title')
  overlay.style.display = 'none'

  const panel = document.createElement('div')
  panel.className = 'ps-panel'

  // Title
  const title = document.createElement('h2')
  title.id = 'ps-title'
  title.className = 'ps-title'
  title.textContent = 'AI Provider Settings'

  // Security warning — shown at the top so it cannot be missed
  const warning = document.createElement('p')
  warning.className = 'ps-warning'
  warning.textContent =
    'Your API key is stored in this browser only and sent directly to the provider. Clear browser storage to remove.'

  // Provider dropdown — structurally present, disabled; placeholder for post-P1 adapters
  const providerGroup = makeGroup('Provider')
  const providerSelect = document.createElement('select')
  providerSelect.className = 'ps-select'
  providerSelect.disabled = true
  providerSelect.tabIndex = -1            // keyboard-inaccessible per acceptance criteria
  providerSelect.setAttribute('aria-disabled', 'true')
  providerSelect.title = 'Additional providers ship post-P1'
  const dsOpt = document.createElement('option')
  dsOpt.value = 'deepseek'
  dsOpt.textContent = 'DeepSeek'
  providerSelect.appendChild(dsOpt)
  providerGroup.appendChild(providerSelect)

  // Base URL + "Use default" inline link
  const baseUrlGroup = makeGroup('Base URL')
  const baseUrlRow = document.createElement('div')
  baseUrlRow.className = 'ps-input-row'
  const baseUrlInput = document.createElement('input')
  baseUrlInput.type = 'text'
  baseUrlInput.id = 'ps-base-url'
  baseUrlInput.className = 'ps-input'
  baseUrlInput.placeholder = DEEPSEEK_DEFAULTS.baseUrl
  const useDefaultBtn = document.createElement('button')
  useDefaultBtn.type = 'button'
  useDefaultBtn.id = 'ps-use-default'
  useDefaultBtn.className = 'ps-link-btn'
  useDefaultBtn.textContent = 'Use default'
  useDefaultBtn.addEventListener('click', () => {
    baseUrlInput.value = DEEPSEEK_DEFAULTS.baseUrl
  })
  baseUrlRow.appendChild(baseUrlInput)
  baseUrlRow.appendChild(useDefaultBtn)
  baseUrlGroup.appendChild(baseUrlRow)

  // Model ID
  const modelGroup = makeGroup('Model ID')
  const modelInput = document.createElement('input')
  modelInput.type = 'text'
  modelInput.id = 'ps-model'
  modelInput.className = 'ps-input'
  modelInput.placeholder = DEEPSEEK_DEFAULTS.model
  modelGroup.appendChild(modelInput)

  // API Key — masked
  const apiKeyGroup = makeGroup('API Key')
  const apiKeyInput = document.createElement('input')
  apiKeyInput.type = 'password'
  apiKeyInput.id = 'ps-api-key'
  apiKeyInput.className = 'ps-input'
  apiKeyInput.placeholder = 'sk-…'
  apiKeyInput.autocomplete = 'off'
  apiKeyGroup.appendChild(apiKeyInput)

  // Timeout slider (1–60 s, default 20 s)
  const timeoutGroup = makeGroup('Timeout')
  const timeoutRow = document.createElement('div')
  timeoutRow.className = 'ps-timeout-row'
  const timeoutSlider = document.createElement('input')
  timeoutSlider.type = 'range'
  timeoutSlider.id = 'ps-timeout'
  timeoutSlider.className = 'ps-slider'
  timeoutSlider.min = '1'
  timeoutSlider.max = '60'
  timeoutSlider.value = String(DEEPSEEK_DEFAULTS.timeoutSecs)
  const timeoutValSpan = document.createElement('span')
  timeoutValSpan.id = 'ps-timeout-val'
  timeoutValSpan.textContent = `${DEEPSEEK_DEFAULTS.timeoutSecs} s`
  timeoutSlider.addEventListener('input', () => {
    timeoutValSpan.textContent = `${timeoutSlider.value} s`
  })
  timeoutRow.appendChild(timeoutSlider)
  timeoutRow.appendChild(timeoutValSpan)
  timeoutGroup.appendChild(timeoutRow)

  // Buttons
  const actions = document.createElement('div')
  actions.className = 'ps-actions'

  const testBtn = document.createElement('button')
  testBtn.type = 'button'
  testBtn.id = 'ps-test'
  testBtn.className = 'ps-btn ps-btn--primary'
  testBtn.textContent = 'Test connection'

  const saveBtn = document.createElement('button')
  saveBtn.type = 'button'
  saveBtn.id = 'ps-save'
  saveBtn.className = 'ps-btn ps-btn--primary'
  saveBtn.textContent = 'Save'

  const forgetBtn = document.createElement('button')
  forgetBtn.type = 'button'
  forgetBtn.id = 'ps-forget'
  forgetBtn.className = 'ps-btn ps-btn--danger'
  forgetBtn.textContent = 'Forget provider'

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.id = 'ps-close'
  closeBtn.className = 'ps-btn'
  closeBtn.textContent = 'Close'

  actions.appendChild(testBtn)
  actions.appendChild(saveBtn)
  actions.appendChild(forgetBtn)
  actions.appendChild(closeBtn)

  // Result panel — live region so screen readers announce changes
  const resultEl = document.createElement('div')
  resultEl.id = 'ps-result'
  resultEl.className = 'ps-result'
  resultEl.setAttribute('aria-live', 'polite')
  resultEl.setAttribute('role', 'status')

  // Assemble
  panel.appendChild(title)
  panel.appendChild(warning)
  panel.appendChild(providerGroup)
  panel.appendChild(baseUrlGroup)
  panel.appendChild(modelGroup)
  panel.appendChild(apiKeyGroup)
  panel.appendChild(timeoutGroup)
  panel.appendChild(actions)
  panel.appendChild(resultEl)
  overlay.appendChild(panel)
  document.body.appendChild(overlay)

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  function readForm(): ProviderSettings {
    return {
      id: 'deepseek',
      baseUrl: baseUrlInput.value.trim() || DEEPSEEK_DEFAULTS.baseUrl,
      model: modelInput.value.trim() || DEEPSEEK_DEFAULTS.model,
      apiKey: apiKeyInput.value,
      timeoutMs: parseInt(timeoutSlider.value, 10) * 1_000,
    }
  }

  function fillForm(s: Partial<ProviderSettings>): void {
    if (s.baseUrl) baseUrlInput.value = s.baseUrl
    if (s.model) modelInput.value = s.model
    if (s.apiKey) apiKeyInput.value = s.apiKey
    if (s.timeoutMs !== undefined) {
      const secs = Math.min(60, Math.max(1, Math.round(s.timeoutMs / 1_000)))
      timeoutSlider.value = String(secs)
      timeoutValSpan.textContent = `${secs} s`
    }
  }

  function setResult(text: string, variant: 'success' | 'error' | ''): void {
    resultEl.textContent = text
    resultEl.className =
      'ps-result' + (variant ? ` ps-result--${variant}` : '')
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  testBtn.addEventListener('click', () => {
    void runPing()
  })

  async function runPing(): Promise<void> {
    const settings = readForm()
    testBtn.disabled = true
    testBtn.textContent = 'Testing…'
    setResult('', '')

    const t0 = performance.now()
    try {
      const provider = createProvider(settings)
      await provider.complete([{ role: 'user', content: 'ping' }])
      const elapsedMs = Math.round(performance.now() - t0)
      setResult(`Reached model \`${settings.model}\` in ${elapsedMs} ms`, 'success')
    } catch (err) {
      const code = err instanceof LLMError ? err.code : 'network'
      // Never echo apiKey in the error path
      setResult(ERROR_MESSAGES[code] ?? 'Unknown error. Check the browser console.', 'error')
    } finally {
      testBtn.disabled = false
      testBtn.textContent = 'Test connection'
    }
  }

  saveBtn.addEventListener('click', () => {
    saveProviderSettings(readForm())
    setResult('Settings saved.', 'success')
  })

  forgetBtn.addEventListener('click', () => {
    clearProviderSettings()
    baseUrlInput.value = ''
    modelInput.value = ''
    apiKeyInput.value = ''
    timeoutSlider.value = String(DEEPSEEK_DEFAULTS.timeoutSecs)
    timeoutValSpan.textContent = `${DEEPSEEK_DEFAULTS.timeoutSecs} s`
    setResult('', '')
  })

  closeBtn.addEventListener('click', close)

  // Click outside panel to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function open(): void {
    fillForm(loadProviderSettings())
    setResult('', '')
    overlay.style.display = 'flex'
  }

  function close(): void {
    overlay.style.display = 'none'
  }

  return { open, close, element: overlay }
}

// ---------------------------------------------------------------------------
// DOM helper
// ---------------------------------------------------------------------------

function makeGroup(labelText: string): HTMLElement {
  const group = document.createElement('div')
  group.className = 'ps-field'
  const lbl = document.createElement('label')
  lbl.className = 'ps-label'
  lbl.textContent = labelText
  group.appendChild(lbl)
  return group
}
