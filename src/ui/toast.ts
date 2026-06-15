/**
 * Lightweight toast notification — renders a non-blocking status message for
 * 3 s then auto-dismisses.  At most one toast visible at a time.
 */

let activeToast: HTMLElement | null = null
let dismissTimer: ReturnType<typeof setTimeout> | null = null

export function showToast(message: string, variant: 'success' | 'error' = 'success'): void {
  if (activeToast) {
    clearTimeout(dismissTimer!)
    activeToast.remove()
    activeToast = null
  }

  const el = document.createElement('div')
  el.id = 'game-toast'
  el.className = `game-toast game-toast--${variant}`
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  el.textContent = message
  document.body.appendChild(el)
  activeToast = el

  dismissTimer = setTimeout(() => {
    el.remove()
    if (activeToast === el) activeToast = null
    dismissTimer = null
  }, 3000)
}
