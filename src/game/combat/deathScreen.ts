/**
 * DOM overlay for player death + respawn.
 *
 * Fades to black over 0.5 s, shows "You died" text, waits, then calls
 * the respawn callback and fades back out.
 */

export interface DeathScreen {
  /**
   * Trigger the death → fade → respawn → fade-out cycle.
   * No-op if already in progress.
   */
  show(onRespawn: () => void): void
  /** Remove the overlay from the DOM entirely. */
  dispose(): void
}

const FADE_IN_MS = 500
const HOLD_MS = 1500
const FADE_OUT_MS = 500

export function createDeathScreen(): DeathScreen {
  const overlay = document.createElement('div')
  overlay.id = 'death-overlay'
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    background: 'black',
    opacity: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    zIndex: '100',
    fontFamily: "'Georgia', serif",
    userSelect: 'none',
  })
  overlay.innerHTML = `
    <p style="color:#cc3333;font-size:2.5rem;margin:0 0 0.5rem 0;letter-spacing:0.08em">You died.</p>
    <p style="color:#aaa;font-size:1.1rem;margin:0">Respawning...</p>
  `
  document.body.appendChild(overlay)

  let active = false
  let pendingTimers: ReturnType<typeof setTimeout>[] = []

  function clearTimers() {
    for (const t of pendingTimers) clearTimeout(t)
    pendingTimers = []
  }

  return {
    show(onRespawn: () => void): void {
      if (active) return
      active = true

      overlay.style.transition = `opacity ${FADE_IN_MS}ms ease`
      overlay.style.opacity = '1'

      const holdTimer = setTimeout(() => {
        onRespawn()
        overlay.style.transition = `opacity ${FADE_OUT_MS}ms ease`
        overlay.style.opacity = '0'
        const doneTimer = setTimeout(() => {
          active = false
        }, FADE_OUT_MS)
        pendingTimers.push(doneTimer)
      }, FADE_IN_MS + HOLD_MS)

      pendingTimers.push(holdTimer)
    },

    dispose(): void {
      clearTimers()
      overlay.remove()
    },
  }
}
