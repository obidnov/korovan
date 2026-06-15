const REDACT_KEY = /secret|token|key|password/i
const REDACT_HEADERS = new Set(['authorization', 'cookie'])

export function redactRecord(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    result[k] = REDACT_KEY.test(k) || REDACT_HEADERS.has(k.toLowerCase()) ? '[REDACTED]' : v
  }
  return result
}

type Level = 'info' | 'warn' | 'error'

export type LogLine = Record<string, unknown> & { ts: string; level: Level }

function write(level: Level, fields: Record<string, unknown>): void {
  const line: LogLine = { ts: new Date().toISOString(), level, ...fields }
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
