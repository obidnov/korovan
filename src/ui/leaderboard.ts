/**
 * Leaderboard panel — mounts inside the main menu.
 *
 * Fetches GET /api/leaderboard and renders a ranked table of top scores.
 * Exposes refresh() so callers can reload after a successful submit.
 *
 * States:
 *   loading  — spinner text
 *   empty    — "no scores yet — be the first!"
 *   error    — "could not load — try again"  (retry button)
 *   loaded   — rank / nickname / score rows
 */

import { fetchLeaderboard, type LeaderboardEntry } from '../api/leaderboard'

export interface LeaderboardPanelOptions {
  zone: string
  faction: string
  limit?: number
}

export interface LeaderboardPanel {
  /** Returns the root element to append wherever needed. */
  element: HTMLElement
  /** Re-fetch and re-render. */
  refresh(): void
  /** Cancel any in-flight fetch (call on unmount). */
  dispose(): void
}

export function createLeaderboardPanel(opts: LeaderboardPanelOptions): LeaderboardPanel {
  const { zone, faction, limit = 20 } = opts

  const root = document.createElement('div')
  root.id = 'lb-panel'
  root.className = 'lb-panel'
  root.setAttribute('aria-label', 'Leaderboard')
  root.setAttribute('role', 'region')

  const heading = document.createElement('h2')
  heading.className = 'lb-heading'
  heading.textContent = 'Leaderboard'
  root.appendChild(heading)

  const content = document.createElement('div')
  content.className = 'lb-content'
  root.appendChild(content)

  let aborted = false
  let currentFetch: AbortController | null = null

  function render(state: 'loading' | 'empty' | 'error' | 'loaded', entries?: LeaderboardEntry[]): void {
    content.innerHTML = ''

    if (state === 'loading') {
      const msg = document.createElement('p')
      msg.className = 'lb-state lb-state--loading'
      msg.textContent = 'Loading…'
      content.appendChild(msg)
      return
    }

    if (state === 'error') {
      const msg = document.createElement('p')
      msg.className = 'lb-state lb-state--error'
      msg.textContent = 'Could not load — try again.'

      const retryBtn = document.createElement('button')
      retryBtn.type = 'button'
      retryBtn.className = 'lb-retry-btn'
      retryBtn.textContent = 'Retry'
      retryBtn.addEventListener('click', () => load())

      content.appendChild(msg)
      content.appendChild(retryBtn)
      return
    }

    if (state === 'empty') {
      const msg = document.createElement('p')
      msg.className = 'lb-state lb-state--empty'
      msg.textContent = 'No scores yet — be the first!'
      content.appendChild(msg)
      return
    }

    // loaded
    const table = document.createElement('table')
    table.className = 'lb-table'
    table.setAttribute('aria-label', 'Top scores')

    const thead = document.createElement('thead')
    thead.innerHTML = `
      <tr>
        <th scope="col" class="lb-col--rank">#</th>
        <th scope="col" class="lb-col--name">Player</th>
        <th scope="col" class="lb-col--score">Score</th>
        <th scope="col" class="lb-col--time">When</th>
      </tr>
    `
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    for (const entry of entries ?? []) {
      const tr = document.createElement('tr')
      tr.className = 'lb-row'

      const tdRank = document.createElement('td')
      tdRank.textContent = String(entry.rank)

      const tdName = document.createElement('td')
      tdName.textContent = entry.nickname

      const tdScore = document.createElement('td')
      tdScore.textContent = String(entry.score)

      const tdTime = document.createElement('td')
      tdTime.textContent = entry.submittedAt ? formatAge(entry.submittedAt) : '—'

      tr.appendChild(tdRank)
      tr.appendChild(tdName)
      tr.appendChild(tdScore)
      tr.appendChild(tdTime)
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
    content.appendChild(table)
  }

  function load(): void {
    if (currentFetch) currentFetch.abort()
    const ctrl = new AbortController()
    currentFetch = ctrl

    render('loading')

    fetchLeaderboard(zone, faction, limit)
      .then((res) => {
        if (ctrl.signal.aborted || aborted) return
        if (res.entries.length === 0) {
          render('empty')
        } else {
          render('loaded', res.entries)
        }
      })
      .catch(() => {
        if (ctrl.signal.aborted || aborted) return
        render('error')
      })
  }

  // Initial load
  load()

  return {
    element: root,
    refresh() {
      if (!aborted) load()
    },
    dispose() {
      aborted = true
      if (currentFetch) currentFetch.abort()
    },
  }
}

/** Returns "N min ago" for recent entries or "N h ago" for older ones. */
function formatAge(isoString: string): string {
  const diffMs = Date.now() - Date.parse(isoString)
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}
