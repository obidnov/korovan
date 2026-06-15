/**
 * Nickname capture modal — shown on first visit when bootstrap returns nickname=null.
 * Also exports patchNickname() for use by CR-1's settings panel.
 */

const PATCH_URL = '/api/identity/me'

export class NicknameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NicknameError'
  }
}

/**
 * PATCH /api/identity/me { nickname } — standalone helper consumed by CR-1.
 * Throws NicknameError on 400 (sanitizer rejection), Error on other failures.
 */
export async function patchNickname(nickname: string): Promise<void> {
  const resp = await fetch(PATCH_URL, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname }),
  })

  if (resp.status === 400) {
    const json = (await resp.json().catch(() => ({} as Record<string, unknown>))) as {
      message?: string
    }
    throw new NicknameError(json.message ?? 'Nickname not allowed — please try another.')
  }

  if (!resp.ok) {
    throw new Error(`PATCH /api/identity/me failed: ${resp.status}`)
  }
}

/**
 * Renders a "Welcome — pick a nickname" modal and resolves when the user
 * submits or skips. Callers set kr_first_visit_done after this resolves.
 */
export async function showNicknameModal(): Promise<void> {
  return new Promise<void>((resolve) => {
    const overlay = document.createElement('div')
    overlay.id = 'nn-overlay'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-labelledby', 'nn-title')

    const panel = document.createElement('div')
    panel.className = 'nn-panel'

    const title = document.createElement('h2')
    title.id = 'nn-title'
    title.className = 'nn-title'
    title.textContent = 'Welcome to Korovan!'

    const subtitle = document.createElement('p')
    subtitle.className = 'nn-subtitle'
    subtitle.textContent =
      'Choose a nickname to appear on the leaderboard. You can change it later in settings.'

    const field = document.createElement('div')
    field.className = 'nn-field'

    const input = document.createElement('input')
    input.id = 'nn-input'
    input.type = 'text'
    input.className = 'nn-input'
    input.placeholder = 'Nickname…'
    input.maxLength = 20
    input.autocomplete = 'username'
    input.setAttribute('aria-label', 'Nickname')
    input.setAttribute('aria-describedby', 'nn-error')

    const errorEl = document.createElement('p')
    errorEl.id = 'nn-error'
    errorEl.className = 'nn-error'
    errorEl.setAttribute('aria-live', 'polite')
    errorEl.style.display = 'none'

    field.appendChild(input)
    field.appendChild(errorEl)

    const actions = document.createElement('div')
    actions.className = 'nn-actions'

    const submitBtn = document.createElement('button')
    submitBtn.id = 'nn-submit'
    submitBtn.type = 'button'
    submitBtn.className = 'nn-btn nn-btn--primary'
    submitBtn.textContent = 'Save nickname'

    const skipBtn = document.createElement('button')
    skipBtn.id = 'nn-skip'
    skipBtn.type = 'button'
    skipBtn.className = 'nn-btn'
    skipBtn.textContent = 'Skip'

    actions.appendChild(submitBtn)
    actions.appendChild(skipBtn)

    panel.appendChild(title)
    panel.appendChild(subtitle)
    panel.appendChild(field)
    panel.appendChild(actions)
    overlay.appendChild(panel)
    document.body.appendChild(overlay)

    input.focus()

    function showError(msg: string): void {
      errorEl.textContent = msg
      errorEl.style.display = 'block'
    }

    function clearError(): void {
      errorEl.textContent = ''
      errorEl.style.display = 'none'
    }

    function close(): void {
      overlay.remove()
      resolve()
    }

    async function handleSubmit(): Promise<void> {
      const nickname = input.value.trim()
      if (!nickname) {
        showError('Please enter a nickname, or click Skip.')
        return
      }

      clearError()
      submitBtn.disabled = true
      submitBtn.textContent = 'Saving…'

      try {
        await patchNickname(nickname)
        close()
      } catch (err) {
        const msg =
          err instanceof NicknameError
            ? err.message
            : 'Couldn\'t save nickname — please try again.'
        showError(msg)
        submitBtn.disabled = false
        submitBtn.textContent = 'Save nickname'
      }
    }

    submitBtn.addEventListener('click', () => {
      void handleSubmit()
    })

    skipBtn.addEventListener('click', () => {
      close()
    })

    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void handleSubmit()
      }
    })
  })
}
