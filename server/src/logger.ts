const REDACT_KEY = /api[-_]?key|secret|password|token|authorization|cookie|signing|credential/i
const REDACT_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'set-cookie'])
const VALUE_SHAPE_RE = /sk-[A-Za-z0-9_-]{20,}/g

function redactString(s: string): string {
  return s.replace(VALUE_SHAPE_RE, '[REDACTED]')
}

function redactValue(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return redactString(v)
  if (Array.isArray(v)) {
    return v.map((el) => (typeof el === 'string' ? redactString(el) : el))
  }
  if (v instanceof Error) {
    return {
      name: v.name,
      message: redactString(v.message),
      stack: v.stack ? redactString(v.stack) : undefined,
    }
  }
  if (v !== null && typeof v === 'object') {
    if (depth >= 8) return '[DEPTH_CAP]'
    return redactRecord(v as Record<string, unknown>, depth + 1)
  }
  return v
}

export function redactRecord(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEY.test(k) || REDACT_HEADERS.has(k.toLowerCase())) {
      result[k] = '[REDACTED]'
    } else {
      result[k] = redactValue(v, depth)
    }
  }
  return result
}

type Level = 'info' | 'warn' | 'error'

export type LogLine = Record<string, unknown> & { ts: string; level: Level }

function write(level: Level, fields: Record<string, unknown>): void {
  const line: LogLine = { ts: new Date().toISOString(), level, ...redactRecord(fields) }
  if (logger.sink) {
    logger.sink(line)
  } else {
    process.stdout.write(JSON.stringify(line) + '\n')
  }
}

// Replaceable sink for tests — assign logger.sink = fn; restore to null after.
export const logger = {
  sink: null as ((line: LogLine) => void) | null,
  info(fields: Record<string, unknown>): void {
    write('info', fields)
  },
  warn(fields: Record<string, unknown>): void {
    write('warn', fields)
  },
  error(fields: Record<string, unknown>): void {
    write('error', fields)
  },
}
