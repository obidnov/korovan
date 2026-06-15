import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import {
  saveGame,
  loadGame,
  SaveTooLargeError,
  _getOfflineBuffer,
  _resetForTest,
} from '../../src/persistence/save.js'

// ---------------------------------------------------------------------------
// MSW server — intercepts fetch in jsdom/node
// ---------------------------------------------------------------------------

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  _resetForTest()
  localStorage.clear()
})
afterAll(() => server.close())

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SLOT = 0
const PAYLOAD = { version: 1, player: { hp: 80 } }
const SAVED_AT = 1_700_000_000_000

function mockSaveOk(savedAt = SAVED_AT) {
  server.use(
    http.post('/api/saves', () => HttpResponse.json({ savedAt })),
  )
}

function mockSave409() {
  server.use(
    http.post('/api/saves', () => new HttpResponse(null, { status: 409 })),
  )
}

function mockSave413() {
  server.use(
    http.post('/api/saves', () => new HttpResponse(null, { status: 413 })),
  )
}

function mockSave400() {
  server.use(
    http.post('/api/saves', () => new HttpResponse(null, { status: 400 })),
  )
}

function mockLoadOk(payload = PAYLOAD, savedAt = SAVED_AT) {
  server.use(
    http.get('/api/saves/me', () => HttpResponse.json({ payload, savedAt })),
  )
}

function mockLoad204() {
  server.use(
    http.get('/api/saves/me', () => new HttpResponse(null, { status: 204 })),
  )
}

// ---------------------------------------------------------------------------
// saveGame — online path
// ---------------------------------------------------------------------------

describe('saveGame — online', () => {
  it('POSTs to /api/saves and returns source:"server"', async () => {
    mockSaveOk()
    const result = await saveGame(SLOT, PAYLOAD, 1)
    expect(result.source).toBe('server')
    expect(result.savedAt).toBe(SAVED_AT)
  })

  it('body contains slot, version, payload, client_clock_ms', async () => {
    let captured: unknown
    server.use(
      http.post('/api/saves', async ({ request }) => {
        captured = await request.json()
        return HttpResponse.json({ savedAt: SAVED_AT })
      }),
    )
    await saveGame(SLOT, PAYLOAD, 1)
    expect(captured).toMatchObject({ slot: SLOT, version: 1, payload: PAYLOAD })
    expect((captured as Record<string, unknown>).client_clock_ms).toBeTypeOf('number')
  })

  it('resolves savedAt from server response', async () => {
    mockSaveOk(9_999_999)
    const { savedAt } = await saveGame(SLOT, PAYLOAD, 1)
    expect(savedAt).toBe(9_999_999)
  })
})

// ---------------------------------------------------------------------------
// saveGame — conflict (409)
// ---------------------------------------------------------------------------

describe('saveGame — 409 conflict', () => {
  it('throws a save-conflict error (recoverable)', async () => {
    mockSave409()
    await expect(saveGame(SLOT, PAYLOAD, 1)).rejects.toMatchObject({
      code: 'save-conflict',
      status: 409,
    })
  })

  it('does NOT buffer the save on 409', async () => {
    mockSave409()
    await expect(saveGame(SLOT, PAYLOAD, 1)).rejects.toThrow()
    expect(_getOfflineBuffer().size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// saveGame — too large (413 / 400)
// ---------------------------------------------------------------------------

describe('saveGame — SaveTooLargeError', () => {
  it('throws SaveTooLargeError on 413', async () => {
    mockSave413()
    await expect(saveGame(SLOT, PAYLOAD, 1)).rejects.toBeInstanceOf(SaveTooLargeError)
  })

  it('throws SaveTooLargeError on 400', async () => {
    mockSave400()
    await expect(saveGame(SLOT, PAYLOAD, 1)).rejects.toBeInstanceOf(SaveTooLargeError)
  })
})

// ---------------------------------------------------------------------------
// saveGame — offline path (buffering)
// ---------------------------------------------------------------------------

describe('saveGame — offline / buffer', () => {
  it('buffers and returns source:"buffer" when network is down', async () => {
    server.use(http.post('/api/saves', () => HttpResponse.error()))
    const result = await saveGame(SLOT, PAYLOAD, 1)
    expect(result.source).toBe('buffer')
  })

  it('buffer holds the buffered save keyed by slot', async () => {
    server.use(http.post('/api/saves', () => HttpResponse.error()))
    await saveGame(SLOT, PAYLOAD, 1)
    expect(_getOfflineBuffer().has(SLOT)).toBe(true)
  })

  it('buffer keeps only the latest save per slot (overwrites old)', async () => {
    server.use(http.post('/api/saves', () => HttpResponse.error()))
    const payloadOld = { version: 1, player: { hp: 99 } }
    const payloadNew = { version: 1, player: { hp: 50 } }
    await saveGame(SLOT, payloadOld, 1)
    await saveGame(SLOT, payloadNew, 1)
    expect(_getOfflineBuffer().get(SLOT)?.payload).toEqual(payloadNew)
    expect(_getOfflineBuffer().size).toBe(1)
  })

  it('flushes buffer on next successful saveGame call', async () => {
    // First call: offline → buffer
    server.use(http.post('/api/saves', () => HttpResponse.error()))
    await saveGame(SLOT, PAYLOAD, 1)
    expect(_getOfflineBuffer().size).toBe(1)

    // Come back online: next call succeeds → buffer flushed
    const posted: unknown[] = []
    server.use(
      http.post('/api/saves', async ({ request }) => {
        posted.push(await request.json())
        return HttpResponse.json({ savedAt: SAVED_AT })
      }),
    )
    const newPayload = { version: 1, player: { hp: 60 } }
    const result = await saveGame(SLOT, newPayload, 1)
    expect(result.source).toBe('server')
    // flushBuffer() is fire-and-forget; poll until the async flush settles
    await vi.waitFor(() => expect(_getOfflineBuffer().size).toBe(0), { timeout: 2000 })
  })
})

// ---------------------------------------------------------------------------
// loadGame — online path
// ---------------------------------------------------------------------------

describe('loadGame — online', () => {
  it('GETs /api/saves/me?slot=N and returns payload', async () => {
    mockLoadOk()
    const result = await loadGame(SLOT)
    expect(result).not.toBeNull()
    expect(result?.payload).toEqual(PAYLOAD)
    expect(result?.savedAt).toBe(SAVED_AT)
  })

  it('returns null when server responds 204 (no save)', async () => {
    mockLoad204()
    const result = await loadGame(SLOT)
    expect(result).toBeNull()
  })

  it('returns null when network is down', async () => {
    server.use(http.get('/api/saves/me', () => HttpResponse.error()))
    const result = await loadGame(SLOT)
    expect(result).toBeNull()
  })

  it('passes slot as query param', async () => {
    let capturedSlot: string | null = null
    server.use(
      http.get('/api/saves/me', ({ request }) => {
        capturedSlot = new URL(request.url).searchParams.get('slot')
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await loadGame(2)
    expect(capturedSlot).toBe('2')
  })
})

// ---------------------------------------------------------------------------
// localStorage migration
// ---------------------------------------------------------------------------

describe('localStorage migration', () => {
  beforeEach(() => {
    // Guarantee clean state for migration tests (reset flag + clear storage)
    _resetForTest()
    localStorage.clear()
  })

  it('migrates kr_save_slot0 into offline buffer on first loadGame call', async () => {
    const legacySave = { version: 1, player: { hp: 100 } }
    localStorage.setItem('kr_save_slot0', JSON.stringify(legacySave))

    // Server has no save yet
    mockLoad204()

    await loadGame(SLOT)

    expect(_getOfflineBuffer().has(SLOT)).toBe(true)
    expect(_getOfflineBuffer().get(SLOT)?.payload).toEqual(legacySave)
  })

  it('removes kr_save_slot0 from localStorage after migration', async () => {
    localStorage.setItem('kr_save_slot0', JSON.stringify({ version: 1 }))
    mockLoad204()

    await loadGame(SLOT)

    expect(localStorage.getItem('kr_save_slot0')).toBeNull()
  })

  it('does not re-run migration on subsequent loadGame calls', async () => {
    localStorage.setItem('kr_save_slot0', JSON.stringify({ version: 1, player: { hp: 90 } }))
    mockLoad204()

    await loadGame(SLOT)           // migration runs here → key deleted, buffer set
    _getOfflineBuffer().clear()     // clear buffer to detect if re-buffered

    server.resetHandlers()
    mockLoad204()
    await loadGame(SLOT)           // migration must NOT re-run

    expect(_getOfflineBuffer().size).toBe(0) // nothing re-buffered
  })

  it('silently discards corrupt legacy save and removes the key', async () => {
    localStorage.setItem('kr_save_slot0', 'NOT_VALID_JSON')
    mockLoad204()

    await loadGame(SLOT)

    expect(localStorage.getItem('kr_save_slot0')).toBeNull()
    expect(_getOfflineBuffer().size).toBe(0) // corrupt save is not buffered
  })

  it('migration + server has existing save returns server save', async () => {
    localStorage.setItem('kr_save_slot0', JSON.stringify({ version: 1, player: { hp: 1 } }))
    const serverPayload = { version: 1, player: { hp: 95 } }
    mockLoadOk(serverPayload)

    const result = await loadGame(SLOT)

    expect(result?.payload).toEqual(serverPayload) // server save wins
    expect(localStorage.getItem('kr_save_slot0')).toBeNull() // key still removed
  })
})
