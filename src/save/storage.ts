/**
 * localStorage-backed save persistence.
 *
 * Decoupled from the schema so that callers decide what to validate.
 * Use validateSaveV1() from schema.ts to parse the raw value.
 */

const SAVE_KEY = 'korovan:save'

export function hasSave(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== null
  } catch {
    return false
  }
}

export function loadRaw(): unknown | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function persistRaw(data: unknown): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data))
  } catch {
    // localStorage quota exceeded or disabled — silently ignore
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    // ignore
  }
}
