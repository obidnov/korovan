/**
 * Quest panel overlay — toggled with J key from HUD.
 *
 * Shows three sections:
 *   Available  — accept / decline buttons
 *   Active     — track toggle; mark-complete button (dev shortcut for D2 testing)
 *   Completed  — read-only list
 *
 * The panel does NOT own quest state; it reads from QuestManager and mutates via
 * its callbacks so the manager stays the single source of truth.
 */

import type { QuestView } from '../game/quests/questTypes'

export interface QuestPanelCallbacks {
  onAccept: (id: string) => void
  onDecline: (id: string) => void
  onComplete: (id: string) => void
  onToggleTrack: (id: string) => void
}

export interface QuestPanel {
  open(): void
  close(): void
  toggle(): void
  /** Re-render with fresh quest list. Call from questManager.onChange(). */
  refresh(quests: ReadonlyArray<QuestView>): void
  readonly isOpen: boolean
  dispose(): void
}

export function createQuestPanel(callbacks: QuestPanelCallbacks): QuestPanel {
  let _isOpen = false

  const overlay = document.createElement('div')
  overlay.id = 'qp-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-labelledby', 'qp-title')
  overlay.style.display = 'none'

  const panel = document.createElement('div')
  panel.className = 'qp-panel'

  const header = document.createElement('div')
  header.className = 'qp-header'

  const title = document.createElement('h2')
  title.id = 'qp-title'
  title.className = 'qp-title'
  title.textContent = 'Quests'

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'qp-close'
  closeBtn.setAttribute('aria-label', 'Close quest panel')
  closeBtn.textContent = '✕'
  closeBtn.addEventListener('click', () => close())

  header.appendChild(title)
  header.appendChild(closeBtn)

  const body = document.createElement('div')
  body.className = 'qp-body'
  body.id = 'qp-body'

  panel.appendChild(header)
  panel.appendChild(body)
  overlay.appendChild(panel)
  document.body.appendChild(overlay)

  // ── Keyboard: J or Escape close the panel ────────────────────────────────
  function onKeydown(e: KeyboardEvent): void {
    if (!_isOpen) return
    if (e.code === 'Escape' || e.code === 'KeyJ') {
      e.stopPropagation()
      close()
    }
  }
  window.addEventListener('keydown', onKeydown, true) // capture phase so Esc doesn't also trigger pause

  // ── Focus trap ────────────────────────────────────────────────────────────
  function onFocusTrap(e: KeyboardEvent): void {
    if (!_isOpen || e.key !== 'Tab') return
    const focusable = [...panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex="0"]',
    )]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
  panel.addEventListener('keydown', onFocusTrap)

  // ── Render helpers ────────────────────────────────────────────────────────

  function rewardLabel(q: QuestView): string {
    const parts: string[] = []
    if (q.reward.currency) parts.push(`${q.reward.currency} gold`)
    if (q.reward.items) {
      for (const item of q.reward.items) {
        parts.push(`${item.qty}× ${item.id}`)
      }
    }
    return parts.length > 0 ? `Reward: ${parts.join(', ')}` : ''
  }

  function makeQuestCard(q: QuestView): HTMLElement {
    const card = document.createElement('div')
    card.className = 'qp-card'
    card.dataset.questId = q.id

    const cardTitle = document.createElement('div')
    cardTitle.className = 'qp-card-title'
    cardTitle.textContent = q.title

    const desc = document.createElement('div')
    desc.className = 'qp-card-desc'
    desc.textContent = q.description

    card.appendChild(cardTitle)
    card.appendChild(desc)

    const reward = rewardLabel(q)
    if (reward) {
      const rewardEl = document.createElement('div')
      rewardEl.className = 'qp-card-reward'
      rewardEl.textContent = reward
      card.appendChild(rewardEl)
    }

    const actions = document.createElement('div')
    actions.className = 'qp-card-actions'

    if (q.status === 'available') {
      const acceptBtn = document.createElement('button')
      acceptBtn.type = 'button'
      acceptBtn.className = 'qp-btn qp-btn--accept'
      acceptBtn.textContent = 'Accept'
      acceptBtn.addEventListener('click', () => callbacks.onAccept(q.id))

      const declineBtn = document.createElement('button')
      declineBtn.type = 'button'
      declineBtn.className = 'qp-btn qp-btn--decline'
      declineBtn.textContent = 'Decline'
      declineBtn.addEventListener('click', () => callbacks.onDecline(q.id))

      actions.appendChild(acceptBtn)
      actions.appendChild(declineBtn)
    }

    if (q.status === 'active') {
      const trackBtn = document.createElement('button')
      trackBtn.type = 'button'
      trackBtn.className = q.tracked
        ? 'qp-btn qp-btn--track qp-btn--tracking'
        : 'qp-btn qp-btn--track'
      trackBtn.textContent = q.tracked ? 'Tracking ✓' : 'Track'
      trackBtn.setAttribute('aria-pressed', String(q.tracked))
      trackBtn.addEventListener('click', () => callbacks.onToggleTrack(q.id))

      // Dev shortcut — lets testers mark complete without D2 objective logic
      const completeBtn = document.createElement('button')
      completeBtn.type = 'button'
      completeBtn.className = 'qp-btn qp-btn--complete'
      completeBtn.textContent = 'Complete (dev)'
      completeBtn.addEventListener('click', () => callbacks.onComplete(q.id))

      actions.appendChild(trackBtn)
      actions.appendChild(completeBtn)
    }

    if (actions.children.length > 0) card.appendChild(actions)

    return card
  }

  function makeSection(heading: string, quests: QuestView[]): HTMLElement {
    const section = document.createElement('section')
    section.className = 'qp-section'
    section.setAttribute('aria-label', heading)

    const h3 = document.createElement('h3')
    h3.className = 'qp-section-heading'
    h3.textContent = heading

    section.appendChild(h3)

    if (quests.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'qp-empty'
      empty.textContent = 'None'
      section.appendChild(empty)
    } else {
      for (const q of quests) {
        section.appendChild(makeQuestCard(q))
      }
    }

    return section
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function open(): void {
    _isOpen = true
    overlay.style.display = 'flex'
    closeBtn.focus()
  }

  function close(): void {
    _isOpen = false
    overlay.style.display = 'none'
  }

  return {
    open,
    close,
    toggle() {
      if (_isOpen) { close() } else { open() }
    },

    refresh(quests) {
      body.innerHTML = ''

      const available = quests.filter((q) => q.status === 'available')
      const active = quests.filter((q) => q.status === 'active')
      const completed = quests.filter((q) => q.status === 'completed')

      body.appendChild(makeSection('Available', available))
      body.appendChild(makeSection('Active', active))
      body.appendChild(makeSection('Completed', completed))
    },

    get isOpen() {
      return _isOpen
    },

    dispose() {
      window.removeEventListener('keydown', onKeydown, true)
      overlay.remove()
    },
  }
}
