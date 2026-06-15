import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { runBootstrap, reBootstrap, getPlayerId } from '../../src/identity/bootstrap'

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => server.close())

// ---------------------------------------------------------------------------
// DOM + localStorage reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  // Reset the internal _playerId state by mocking getPlayerId's backing var.
  // We achieve this by re-importing via the live module, which is fine since
  // the module-level var is reset indirectly through each runBootstrap() call.
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function el(id: string): HTMLElement | null {
  return document.getElementById(id)
}

function bootstrapHandler(
  playerId = 'test-player-uuid',
  nickname: string | null = null,
) {
  return http.post('/api/identity/bootstrap', () =>
    HttpResponse.json({ player_id: playerId, nickname }),
  )
}

function patchNicknameHandler(statusCode = 200) {
  return http.patch('/api/identity/me', () =>
    statusCode === 200
      ? HttpResponse.json({ player_id: 'test-player-uuid', nickname: 'tester' })
      : new HttpResponse(JSON.stringify({ message: 'Nickname contains forbidden words.' }), {
          status: statusCode,
          headers: { 'Content-Type': 'application/json' },
        }),
  )
}

// ---------------------------------------------------------------------------
// Happy path — fresh visit (nickname === null, first_visit_done not set)
// ---------------------------------------------------------------------------

describe('runBootstrap — fresh visit', () => {
  it('calls POST /api/identity/bootstrap and resolves with player data', async () => {
    server.use(bootstrapHandler('pid-fresh', null), patchNicknameHandler())

    // Skip the nickname modal automatically (simulate skip click)
    const origCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag)
      if (tag === 'div' && !document.getElementById('nn-overlay')) {
        // after overlay is mounted, auto-click skip
        setTimeout(() => {
          const skip = document.getElementById('nn-skip')
          skip?.click()
        }, 0)
      }
      return el
    })

    const result = await runBootstrap()

    expect(result.playerId).toBe('pid-fresh')
    expect(result.nickname).toBeNull()
    expect(getPlayerId()).toBe('pid-fresh')
  })

  it('shows the nickname modal when nickname is null and first_visit_done is not set', async () => {
    server.use(bootstrapHandler('pid-modal', null), patchNicknameHandler())

    let nicknameModalAppeared = false
    const origAppendChild = document.body.appendChild.bind(document.body)
    vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
      const el = node as HTMLElement
      if (el.id === 'nn-overlay') nicknameModalAppeared = true
      // Auto-skip
      setTimeout(() => {
        const skip = document.getElementById('nn-skip')
        skip?.click()
      }, 0)
      return origAppendChild(node)
    })

    await runBootstrap()

    expect(nicknameModalAppeared).toBe(true)
    expect(localStorage.getItem('kr_first_visit_done')).toBe('1')
  })

  it('sets kr_first_visit_done="1" after first visit (whether submitted or skipped)', async () => {
    server.use(bootstrapHandler('pid-flag', null), patchNicknameHandler())

    const origAppend = document.body.appendChild.bind(document.body)
    vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
      setTimeout(() => document.getElementById('nn-skip')?.click(), 0)
      return origAppend(node)
    })

    expect(localStorage.getItem('kr_first_visit_done')).toBeNull()
    await runBootstrap()
    expect(localStorage.getItem('kr_first_visit_done')).toBe('1')
  })
})

// ---------------------------------------------------------------------------
// Returning visit — nickname already set, no modal
// ---------------------------------------------------------------------------

describe('runBootstrap — returning visit', () => {
  it('does not show nickname modal when server returns a non-null nickname', async () => {
    server.use(bootstrapHandler('pid-returning', 'adventurer'))

    let nicknameModalAppeared = false
    const orig = document.body.appendChild.bind(document.body)
    vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
      if ((node as HTMLElement).id === 'nn-overlay') nicknameModalAppeared = true
      return orig(node)
    })

    const result = await runBootstrap()

    expect(result.nickname).toBe('adventurer')
    expect(nicknameModalAppeared).toBe(false)
  })

  it('does not show modal when kr_first_visit_done="1" is set, even if nickname is null', async () => {
    localStorage.setItem('kr_first_visit_done', '1')
    server.use(bootstrapHandler('pid-returning2', null))

    let nicknameModalAppeared = false
    const orig = document.body.appendChild.bind(document.body)
    vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
      if ((node as HTMLElement).id === 'nn-overlay') nicknameModalAppeared = true
      return orig(node)
    })

    await runBootstrap()

    expect(nicknameModalAppeared).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Bootstrap overlay DOM
// ---------------------------------------------------------------------------

describe('runBootstrap — bootstrap overlay', () => {
  it('mounts #bs-overlay during bootstrap and removes it on success', async () => {
    let overlayMounted = false
    server.use(bootstrapHandler('pid-overlay'))

    // Intercept the first appendChild call to check overlay presence
    const orig = document.body.appendChild.bind(document.body)
    vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
      const result = orig(node)
      if ((node as HTMLElement).id === 'bs-overlay') overlayMounted = true
      return result
    })

    await runBootstrap()

    expect(overlayMounted).toBe(true)
    expect(el('bs-overlay')).toBeNull() // removed after success
  })
})

// ---------------------------------------------------------------------------
// Network failures + retry flow
// ---------------------------------------------------------------------------

describe('runBootstrap — network failures', () => {
  it('retries on HTTP 503 and eventually succeeds', async () => {
    vi.useFakeTimers()
    let calls = 0

    server.use(
      http.post('/api/identity/bootstrap', () => {
        calls++
        if (calls < 3) return new HttpResponse(null, { status: 503 })
        return HttpResponse.json({ player_id: 'pid-retry', nickname: 'retried' })
      }),
    )

    const promise = runBootstrap()
    // Advance through the retry delays
    await vi.runAllTimersAsync()
    const result = await promise

    vi.useRealTimers()

    expect(result.playerId).toBe('pid-retry')
    expect(calls).toBe(3)
  })

  it('shows retry button after MAX_RETRIES exhausted, resolves on click', async () => {
    vi.useFakeTimers()
    let totalCalls = 0
    let showedRetryButton = false

    server.use(
      http.post('/api/identity/bootstrap', () => {
        totalCalls++
        // First 5 calls fail; 6th succeeds (after manual retry)
        if (totalCalls <= 5) return new HttpResponse(null, { status: 503 })
        return HttpResponse.json({ player_id: 'pid-manual', nickname: null })
      }),
    )

    const promise = runBootstrap()

    // Advance timers through all retry delays
    await vi.runAllTimersAsync()

    // After 5 failures the retry button should be visible
    const retryBtn = el('bs-retry') as HTMLButtonElement | null
    expect(retryBtn).not.toBeNull()
    expect(retryBtn!.style.display).not.toBe('none')
    showedRetryButton = true

    // Simulate user clicking retry — triggers another attempt
    retryBtn!.click()

    // Let the 6th call complete
    await vi.runAllTimersAsync()

    // Skip any nickname modal
    document.getElementById('nn-skip')?.click()

    const result = await promise
    vi.useRealTimers()

    expect(showedRetryButton).toBe(true)
    expect(result.playerId).toBe('pid-manual')
  })
})

// ---------------------------------------------------------------------------
// reBootstrap() — lightweight re-auth helper
// ---------------------------------------------------------------------------

describe('reBootstrap', () => {
  it('calls POST /api/identity/bootstrap and returns result', async () => {
    server.use(bootstrapHandler('pid-reauth', 'adventurer'))

    const result = await reBootstrap()

    expect(result.playerId).toBe('pid-reauth')
    expect(result.nickname).toBe('adventurer')
    expect(getPlayerId()).toBe('pid-reauth')
  })

  it('throws on non-2xx response', async () => {
    server.use(
      http.post('/api/identity/bootstrap', () => new HttpResponse(null, { status: 401 })),
    )

    await expect(reBootstrap()).rejects.toThrow('reBootstrap HTTP 401')
  })

  it('can be used to retry a downstream 401 — updates player id', async () => {
    // Scenario: player_id was stale, reBootstrap gets a fresh one
    server.use(bootstrapHandler('pid-new-session', 'explorer'))

    const before = getPlayerId()
    await reBootstrap()
    const after = getPlayerId()

    expect(before).not.toBe('pid-new-session') // was stale or null
    expect(after).toBe('pid-new-session')
  })
})
