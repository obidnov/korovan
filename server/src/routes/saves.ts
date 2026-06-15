import { Router } from 'express'
import type { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { getDb } from '../db'

const SAVE_MAX_BYTES_DEFAULT = 64 * 1024
// P1 spec: slot 0 only; accept 0–9 to leave room for future multi-slot without schema change.
const SLOT_MAX = 9

export const savesRouter = Router()

const maxBytes = parseInt(process.env.SAVE_MAX_BYTES ?? String(SAVE_MAX_BYTES_DEFAULT), 10)

savesRouter.post('/', (req: Request, res: Response): void => {
  if (!req.player) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const body = req.body as {
    slot?: unknown
    version?: unknown
    payload?: unknown
    client_clock_ms?: unknown
  }

  if (body.slot == null || body.version == null || body.payload == null) {
    res
      .status(400)
      .json({ error: 'missing_fields', required: ['slot', 'version', 'payload'] })
    return
  }

  const slot = Number(body.slot)
  const version = Number(body.version)

  // M9: upper bound on slot prevents unbounded slot-space growth.
  if (!Number.isInteger(slot) || slot < 0 || slot > SLOT_MAX) {
    res.status(400).json({
      error: 'invalid_fields',
      detail: `slot must be integer 0–${SLOT_MAX}`,
    })
    return
  }

  if (!Number.isInteger(version) || version < 0) {
    res.status(400).json({
      error: 'invalid_fields',
      detail: 'version must be a non-negative integer',
    })
    return
  }

  // client_clock_ms is optional wrapper field; fall back to server time if absent.
  const clientClockMs =
    body.client_clock_ms != null && Number.isInteger(Number(body.client_clock_ms))
      ? Number(body.client_clock_ms)
      : Date.now()

  let payloadStr: string
  try {
    payloadStr = JSON.stringify(body.payload)
  } catch {
    res.status(400).json({ error: 'invalid_payload' })
    return
  }

  if (Buffer.byteLength(payloadStr, 'utf8') > maxBytes) {
    res.status(413).json({ error: 'payload_too_large', max_bytes: maxBytes })
    return
  }

  const db = getDb()
  const playerId = req.player.id
  const now = Date.now()

  type SaveResult =
    | { conflict: true; storedVersion: number }
    | { save_id: string; updated_at: number }

  // M8: better-sqlite3 transaction auto-rolls back on any exception thrown inside.
  const upsert = db.transaction((): SaveResult => {
    const existing = db
      .prepare<[string, number]>(
        'SELECT save_id, version FROM saves WHERE player_id = ? AND slot = ?',
      )
      .get(playerId, slot) as { save_id: string; version: number } | undefined

    if (existing) {
      if (version < existing.version) {
        return { conflict: true, storedVersion: existing.version }
      }
      db.prepare(
        'UPDATE saves SET version = ?, payload = ?, updated_at = ?, client_clock_ms = ? WHERE save_id = ?',
      ).run(version, payloadStr, now, clientClockMs, existing.save_id)
      return { save_id: existing.save_id, updated_at: now }
    }

    const saveId = randomUUID()
    db.prepare(
      'INSERT INTO saves (save_id, player_id, slot, version, payload, updated_at, client_clock_ms)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(saveId, playerId, slot, version, payloadStr, now, clientClockMs)
    return { save_id: saveId, updated_at: now }
  })

  const result = upsert()

  if ('conflict' in result) {
    res.status(409).json({ error: 'version_conflict', stored_version: result.storedVersion })
    return
  }

  res.status(200).json({ save_id: result.save_id, updated_at: result.updated_at })
})
