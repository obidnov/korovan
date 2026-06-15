/**
 * Input sanitizer for LLM prompt strings.
 * Spec: docs/llm-provider.md §4 (BOO-468) / BOO-481.
 * Consumed by: EP-3 (/api/llm/decide) before building the system prompt,
 * and BC-1 (DeepSeek adapter) before persisting providerContext.
 *
 * NEVER throws — caller compares input vs output for "was modified" telemetry.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip ASCII control chars except horizontal whitespace: keep \t \n \r space. */
function stripControlChars(s: string): string {
  // Keep: \x09 (\t), \x0A (\n), \x0D (\r), \x20 (space)
  // Remove: \x00–\x08, \x0B, \x0C, \x0E–\x1F, \x7F
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

/**
 * Truncate to `maxBytes` UTF-8 bytes without splitting a code point.
 * Walks the string code-point-by-code-point so emoji (4-byte) are never
 * split mid-sequence, which would produce invalid UTF-8.
 */
function truncateToByteLength(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s
  let bytes = 0
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i) ?? 0
    // Surrogate pair in JS string: codePoint > 0xFFFF uses 2 UTF-16 code units.
    const charLen = cp > 0xffff ? 2 : 1
    const byteLen = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
    if (bytes + byteLen > maxBytes) return s.slice(0, i)
    bytes += byteLen
    i += charLen
  }
  return s
}

// ---------------------------------------------------------------------------
// Template-injection substitutions (order matters: applied left-to-right)
// ---------------------------------------------------------------------------

type Sub = readonly [RegExp, string]

/**
 * Template syntax that could confuse downstream LLM prompt templating engines
 * (Jinja2-style, ERB/EJS, Handlebars, JS template literals).
 * Each is replaced with a visually distinct safe alternative.
 */
const TEMPLATE_SUBS: readonly Sub[] = [
  [/`/g, "'"],       // backtick → apostrophe
  [/\$\{/g, '$['],   // JS template literal open: ${ → $[
  [/<%/g, '<['],     // ERB/EJS: <% → <[
  [/\{\{/g, '{['],   // Handlebars/Jinja2: {{ → {[
]

// ---------------------------------------------------------------------------
// Jailbreak-prefix patterns (maintained here per spec — review on each sprint)
// ---------------------------------------------------------------------------

/**
 * Case-insensitive patterns that indicate prompt-injection attempts.
 * More-specific patterns (e.g. '### Instruction:') listed before their
 * prefix ('###') so the more-specific replacement fires first if different
 * placeholders are ever needed in future.
 */
const JAILBREAK_PATTERNS: readonly RegExp[] = [
  /ignore previous/gi,
  /disregard all/gi,
  /system:/gi,
  /assistant:/gi,
  /###\s*instruction:/gi, // must precede bare ### below
  /###/g,
]

const FILTERED = '[FILTERED]'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * General-purpose string sanitizer.
 * @param input   Raw user-controlled string.
 * @param maxLen  Maximum byte length (UTF-8). Truncates after all substitutions.
 */
export function sanitizeUserString(input: string, maxLen: number): string {
  try {
    let s = stripControlChars(input)

    for (const [pattern, replacement] of TEMPLATE_SUBS) {
      s = s.replace(pattern, replacement)
    }

    for (const pattern of JAILBREAK_PATTERNS) {
      s = s.replace(pattern, FILTERED)
    }

    // Collapse consecutive whitespace (incl. \t \n \r) to a single space, trim.
    s = s.replace(/\s+/g, ' ').trim()

    return truncateToByteLength(s, maxLen)
  } catch {
    // Safety net: return empty string rather than surfacing an unexpected error.
    return ''
  }
}

/** Sanitize a user-visible nickname. Hard cap: 32 bytes. */
export function sanitizeNickname(input: string): string {
  return sanitizeUserString(input, 32)
}

/** Sanitize a user-visible item name. Hard cap: 64 bytes. */
export function sanitizeItemName(input: string): string {
  return sanitizeUserString(input, 64)
}
