/**
 * Server-backed save persistence with offline buffer and sync-on-reconnect.
 *
 * Public API:
 *   saveGame(slot, payload, version) → { savedAt, source: "server"|"buffer" }
 *   loadGame(slot) → { payload, savedAt } | null
 *
 * Offline: saves are kept in an in-memory buffer (latest per slot) and flushed
 * when the browser comes back online or when the next saveGame call succeeds.
 *
 * Migration: legacy localStorage key 'kr_save_slot0' is migrated once on first
 * loadGame call, buffered to the server, then the key is deleted.
 *
 * Supersedes: BOO-393 (localStorage-only save/storage.ts)
 */

const LEGACY_LS_KEY = 'kr_save_slot0'
const API_SAVES = '/api/saves'

export class SaveTooLargeError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Save rejected by server (HTTP ${status})`)
    this.name = 'SaveTooLargeError'
    this.status = status
  }
}

export interface SaveConflictError extends Error {
  readonly code: 'save-conflict'
  readonly status: 409
}

interface BufferedSave {
  payload: object
  version: number
  client_clock_ms: number
}

const offlineBuffer = new Map<number, BufferedSave>()
let migrationDone = false

// CR-5 hook: called when server returns 401 so the bootstrap flow can re-auth
let onAuthRequired: (() => Promise<void>) | null = null

export function setAuthRequiredHook(fn: () => Promise<void>): void {
  onAuthRequired = fn
}

// Flush all buffered slots to the server; silently skips slots that still fail
async function flushBuffer(): Promise<void> {
  for (const [slot, buffered] of [...offlineBuffer.entries()]) {
    let res: Response
    try {
      res = await fetch(API_SAVES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot, ...buffered }),
      })
    } catch {
      continue // still offline — leave in buffer
    }
    if (res.ok) offlineBuffer.delete(slot)
  }
}

// Wire up browser online event (no-op in test environments that don't fire it)
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flushBuffer())
}

export async function saveGame(
  slot: number,
  payload: object,
  version: number,
): Promise<{ savedAt: number; source: 'server' | 'buffer' }> {
  const client_clock_ms = Date.now()

  let res: Response
  try {
    res = await fetch(API_SAVES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, version, payload, client_clock_ms }),
    })
  } catch {
    // Network down — buffer this save
    offlineBuffer.set(slot, { payload, version, client_clock_ms })
    return { savedAt: client_clock_ms, source: 'buffer' }
  }

  if (res.status === 409) {
    const err = Object.assign(new Error('Save version conflict (older version rejected)'), {
      code: 'save-conflict' as const,
      status: 409 as const,
    })
    throw err
  }

  if (res.status === 413 || res.status === 400) {
    throw new SaveTooLargeError(res.status)
  }

  if (!res.ok) {
    throw new Error(`Unexpected save response: ${res.status}`)
  }

  // Successful POST — flush any buffered saves from prior offline period
  if (offlineBuffer.size > 0) void flushBuffer()

  const data = (await res.json()) as { savedAt?: number }
  return { savedAt: data.savedAt ?? client_clock_ms, source: 'server' }
}

export async function loadGame(
  slot: number,
): Promise<{ payload: object; savedAt: number } | null> {
  // One-time localStorage migration (runs only on first loadGame call per session)
  if (!migrationDone) {
    migrationDone = true
    try {
      const legacyRaw = localStorage.getItem(LEGACY_LS_KEY)
      if (legacyRaw !== null) {
        const legacyData = JSON.parse(legacyRaw) as object
        offlineBuffer.set(slot, { payload: legacyData, version: 1, client_clock_ms: Date.now() })
        localStorage.removeItem(LEGACY_LS_KEY)
      }
    } catch {
      // Corrupt or inaccessible localStorage — clear silently
      try { localStorage.removeItem(LEGACY_LS_KEY) } catch { /* ignore */ }
    }
  }

  let res: Response
  try {
    res = await fetch(`${API_SAVES}/me?slot=${slot}`)
  } catch {
    // Network down — no cached server save available
    return null
  }

  if (res.status === 204) return null

  if (res.status === 401) {
    if (onAuthRequired) {
      await onAuthRequired()
      // Retry once after re-auth
      try {
        const retry = await fetch(`${API_SAVES}/me?slot=${slot}`)
        if (retry.ok) {
          const data = (await retry.json()) as { payload: object; savedAt: number }
          return { payload: data.payload, savedAt: data.savedAt }
        }
      } catch { /* ignore retry failure */ }
    }
    return null
  }

  if (!res.ok) return null

  const data = (await res.json()) as { payload: object; savedAt: number }
  return { payload: data.payload, savedAt: data.savedAt }
}

// Test helpers — not for production use
export function _getOfflineBuffer(): Map<number, BufferedSave> {
  return offlineBuffer
}

export function _resetForTest(): void {
  offlineBuffer.clear()
  migrationDone = false
  onAuthRequired = null
}
