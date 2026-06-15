import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { createLeaderboardPanel } from '../../src/ui/leaderboard'
import { submitScore, ApiError } from '../../src/api/leaderboard'

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LB_URL = '/api/leaderboard'

function makeEntries(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    nickname: `Player${i + 1}`,
    score: 1000 - i * 100,
  }))
}

function waitForContent(el: HTMLElement, check: (el: HTMLElement) => boolean, timeout = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const poll = () => {
      if (check(el)) return resolve()
      if (Date.now() - start > timeout) return reject(new Error('Timed out waiting for content'))
      setTimeout(poll, 10)
    }
    poll()
  })
}

// ---------------------------------------------------------------------------
// LeaderboardPanel — GET tests
// ---------------------------------------------------------------------------

describe('LeaderboardPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders 3 entries in rank order after GET returns them', async () => {
    const entries = makeEntries(3)
    server.use(
      http.get(LB_URL, () => HttpResponse.json({ entries })),
    )

    const panel = createLeaderboardPanel({ zone: 'forest', faction: 'player' })
    document.body.appendChild(panel.element)

    await waitForContent(panel.element, (el) => el.querySelectorAll('tbody tr').length === 3)

    const rows = panel.element.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(3)

    const cells0 = rows[0].querySelectorAll('td')
    expect(cells0[0].textContent).toBe('1')
    expect(cells0[1].textContent).toBe('Player1')
    expect(cells0[2].textContent).toBe('1000')

    const cells2 = rows[2].querySelectorAll('td')
    expect(cells2[0].textContent).toBe('3')
    expect(cells2[1].textContent).toBe('Player3')

    panel.dispose()
  })

  it('shows empty state when GET returns zero entries', async () => {
    server.use(
      http.get(LB_URL, () => HttpResponse.json({ entries: [] })),
    )

    const panel = createLeaderboardPanel({ zone: 'forest', faction: 'player' })
    document.body.appendChild(panel.element)

    await waitForContent(panel.element, (el) =>
      el.querySelector('.lb-state--empty') !== null,
    )

    const emptyMsg = panel.element.querySelector('.lb-state--empty')
    expect(emptyMsg?.textContent).toContain('No scores yet')
    expect(panel.element.querySelector('tbody')).toBeNull()

    panel.dispose()
  })

  it('shows error state when GET fails', async () => {
    server.use(
      http.get(LB_URL, () => HttpResponse.json({ error: 'oops' }, { status: 500 })),
    )

    const panel = createLeaderboardPanel({ zone: 'forest', faction: 'player' })
    document.body.appendChild(panel.element)

    await waitForContent(panel.element, (el) =>
      el.querySelector('.lb-state--error') !== null,
    )

    const errMsg = panel.element.querySelector('.lb-state--error')
    expect(errMsg?.textContent).toContain('try again')

    panel.dispose()
  })

  it('passes zone and faction as query params', async () => {
    let capturedUrl = ''
    server.use(
      http.get(LB_URL, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({ entries: [] })
      }),
    )

    const panel = createLeaderboardPanel({ zone: 'desert', faction: 'bandit', limit: 10 })
    document.body.appendChild(panel.element)

    await waitForContent(panel.element, (el) => el.querySelector('.lb-state--empty') !== null)

    expect(capturedUrl).toContain('zone=desert')
    expect(capturedUrl).toContain('faction=bandit')
    expect(capturedUrl).toContain('limit=10')

    panel.dispose()
  })
})

// ---------------------------------------------------------------------------
// submitScore — POST tests
// ---------------------------------------------------------------------------

describe('submitScore', () => {
  it('returns rank on 201 success', async () => {
    server.use(
      http.post(LB_URL, () => HttpResponse.json({ rank: 5 }, { status: 201 })),
    )

    const result = await submitScore({ zone: 'forest', faction: 'player', score: 500 })
    expect(result.rank).toBe(5)
  })

  it('throws ApiError with status 429 on rate-limit', async () => {
    server.use(
      http.post(LB_URL, () => HttpResponse.json({ error: 'too many requests' }, { status: 429 })),
    )

    await expect(
      submitScore({ zone: 'forest', faction: 'player', score: 100 }),
    ).rejects.toSatisfy((err: unknown) => err instanceof ApiError && (err as ApiError).status === 429)
  })

  it('calls bootstrap then retries on 401, succeeds', async () => {
    let callCount = 0
    server.use(
      http.post(LB_URL, () => {
        callCount++
        if (callCount === 1) {
          return HttpResponse.json({ error: 'unauthorized' }, { status: 401 })
        }
        return HttpResponse.json({ rank: 3 }, { status: 201 })
      }),
    )

    let bootstrapCalled = false
    const bootstrap = async () => {
      bootstrapCalled = true
    }

    const result = await submitScore(
      { zone: 'forest', faction: 'player', score: 200 },
      { bootstrap },
    )

    expect(bootstrapCalled).toBe(true)
    expect(callCount).toBe(2)
    expect(result.rank).toBe(3)
  })

  it('throws on 401 when no bootstrap provided', async () => {
    server.use(
      http.post(LB_URL, () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
    )

    await expect(
      submitScore({ zone: 'forest', faction: 'player', score: 50 }),
    ).rejects.toSatisfy((err: unknown) => err instanceof ApiError && (err as ApiError).status === 401)
  })

  it('200 response body is parsed (server returns 200, not 201)', async () => {
    server.use(
      http.post(LB_URL, () => HttpResponse.json({ rank: 1 }, { status: 200 })),
    )

    const result = await submitScore({ zone: 'forest', faction: 'player', score: 9999 })
    expect(result.rank).toBe(1)
  })
})
