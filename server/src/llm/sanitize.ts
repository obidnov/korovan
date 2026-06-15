/**
 * Input sanitizer for LLM prompt strings.
 * Spec: docs/llm-provider.md §4 (BOO-468 signed; CSO hardened via BOO-495).
 * Consumed by: EP-3 (/api/llm/decide) before building the system prompt,
 * and BC-1 (DeepSeek adapter) before persisting providerContext.
 *
 * NEVER throws — returns empty string on unexpected error.
 * Callers compare input vs output for "was modified" telemetry.
 */

import { createHash } from 'crypto'
import { logger } from '../logger'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip ASCII control chars (C0: U+0000-U+001F, DEL: U+007F),
 * C1 control chars (U+0080-U+009F -- dangerous in log viewers/terminals, BOO-495 B3),
 * and Unicode direction overrides (U+200E, U+200F, U+202A-U+202E, U+2066-U+2069).
 * Keeps horizontal/vertical whitespace: \t (\x09), \n (\x0A), \r (\x0D), space (\x20).
 */
function stripControlChars(s: string): string {
  // C0 (minus kept whitespace \x09\x0A\x0D), DEL, C1, direction overrides.
  // C1 range (U+0080-U+009F): B3 hardening -- dangerous in log viewers/terminals.
  // Direction overrides: U+200E LRM, U+200F RLM, U+202A-U+202E embedding/override,
  // U+2066-U+2069 isolate/pop-directional.
  return s.replace(
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F‎‏‪-‮⁦-⁩]/g,
    '',
  )
}

/**
 * Allowlist-only character pass (Rule 5).
 * Keeps: Unicode letters (\p{L}), digits (\p{N}), ASCII whitespace,
 * and the allowed punctuation set.
 * Backslash (\) deliberately excluded (BOO-495 B6 -- enables escape-sequence
 * injection in C-style strings / JSON parsing contexts; forward slash is fine).
 * Any character not in the allowlist is replaced with a space.
 */
function applyAllowlist(s: string): string {
  // Allowed punctuation: . , - _ ' " ! ? ( ) [ ] @ # % & * + = /
  // \[ and \] are escaped to avoid ambiguity inside the character class.
  // Backslash excluded per BOO-495 B6.
  return s.replace(/[^\p{L}\p{N}\s.,\-_'"!?()\[\]@#%&*+=/]/gu, ' ')
}

/**
 * Truncate to `maxBytes` UTF-8 bytes without splitting a code point.
 * Applied LAST so that rule expansions (e.g. [FILTERED] replacements) do not
 * exceed the cap silently -- truncation always guarantees the final cap.
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
// Template-injection substitutions (Rule 3 -- order matters, applied left-to-right)
// ---------------------------------------------------------------------------

type Sub = readonly [RegExp, string]

/**
 * Template-syntax replacements that neutralize prompt-templating engine injection.
 * Both RAW OPENERS and COMPLETE SEQUENCES are replaced -- defence-in-depth against
 * dangling/malformed sequences, e.g. "${SYSTEM_PROMPT" (no closing brace) is caught
 * by the raw-${ entry (BOO-495 B4).
 */
const TEMPLATE_SUBS: readonly Sub[] = [
  [/`/g, "'"],        // backtick -> apostrophe
  [/\$\{/g, '$['],   // raw ${ opener -- catches dangling ${EXPR and complete ${...}
  [/<%/g, '<['],     // raw <% opener -- catches dangling <%EXPR and complete <%...%>
  [/\{\{/g, '{['],   // raw {{ opener -- catches dangling {{EXPR and complete {{...}}
  [/\}\}/g, '}]'],   // raw }} closer -- symmetric defence (BOO-495 B7 echo-path)
]

// ---------------------------------------------------------------------------
// Jailbreak-prefix patterns (Rule 4)
// Maintained by CSO + BD. Last updated: 2026-06-15 per BOO-495.
// ---------------------------------------------------------------------------

/**
 * Case-insensitive patterns indicating prompt-injection attempts.
 * Each occurrence is replaced with FILTERED placeholder.
 * More-specific patterns come before their prefix to ensure the more-specific
 * replacement fires first if different placeholders are ever introduced.
 *
 * Multi-word patterns use \s+ (not literal space) so double-space, tab,
 * NBSP (U+00A0), and other Unicode whitespace do not bypass detection.
 * Colon-terminated keywords use \s* before ':' to block "system :" bypass.
 * JavaScript's \s matches U+00A0 and other Unicode whitespace even without /u.
 *
 * Ownership: CSO + BD jointly own updates.
 * Last updated: 2026-06-15 per BOO-481 CSO rejection (whitespace-bypass fix).
 */
export const JAILBREAK_PREFIXES: readonly RegExp[] = [
  // Instruction-override openers
  /ignore\s+previous/gi,
  /ignore\s+above/gi,
  /disregard/gi,                    // catches bare "disregard" + "disregard all"
  /new\s+instructions/gi,
  /forget/gi,
  // Role-play / persona hijacking (BOO-495 B5)
  /you\s+are\s+now/gi,
  /act\s+as/gi,
  /roleplay\s+as/gi,
  /your\s+new\s+role/gi,
  /from\s+now\s+on/gi,
  /as\s+an\s+ai/gi,
  /respond\s+with/gi,
  /let'?s\s+play/gi,               // "let's play" and "lets play"
  // Prompt-structure injection
  /system\s*:/gi,                   // \s* blocks "system :" space-before-colon bypass
  /###\s*instruction\s*:/gi,        // must precede bare ### so more-specific fires first
  /###/g,
  /assistant\s*:/gi,                // \s* blocks "assistant :" space-before-colon bypass
  // Model-specific special tokens (BOO-495 B5)
  /<\|im_start\|>/gi,
  /<\|system\|>/gi,
  /<\|user\|>/gi,
  /<\|assistant\|>/gi,
  /<\|endoftext\|>/gi,
  /\[INST\]/gi,
  /<\/s>/gi,
]

const FILTERED = '[FILTERED]'

// ---------------------------------------------------------------------------
// Output-validator (post-sanitize assertion -- spec §4 output-validator contract)
// ---------------------------------------------------------------------------

/**
 * Asserts the sanitized string has no remaining forbidden substrings and is
 * within its field byte cap. Called by adapters BEFORE interpolating the
 * sanitized value into a prompt template.
 *
 * If any assertion fails (i.e. a sanitizer bug let something through), this
 * substitutes the field placeholder and emits a structured warn log so that
 * sanitizer regressions surface in observability rather than shipping silently
 * (BOO-495 B8). The original raw string is NEVER in the log -- only its SHA-256.
 *
 * @param sanitized   Output of sanitizeUserString / a higher-level wrapper.
 * @param maxBytes    Per-field UTF-8 byte cap.
 * @param field       Field identifier for logging (e.g. "nickname", "idle.reason").
 * @param placeholder Placeholder to substitute on failure (e.g. "[PLAYER]", "[ITEM]").
 */
export function validateSanitizedOutput(
  sanitized: string,
  maxBytes: number,
  field: string,
  placeholder: string,
): string {
  // Forbidden substrings that must not survive sanitization (BOO-495 B7 adds }}).
  const FORBIDDEN = ['`', '${', '<%', '{{', '}}'] as const
  const hasForbidden = FORBIDDEN.some((f) => sanitized.includes(f))
  const tooLong = Buffer.byteLength(sanitized, 'utf8') > maxBytes
  const empty = sanitized.length === 0

  if (hasForbidden || tooLong || empty) {
    // Structured log: original raw content deliberately excluded (PII / injection material).
    const originalSha256 = createHash('sha256').update(sanitized).digest('hex')
    logger.warn({
      event: 'sanitizer_post_validate_substitution',
      field,
      originalSha256,
      placeholder,
      reason: hasForbidden
        ? 'forbidden_substring'
        : tooLong
          ? 'exceeds_cap'
          : 'empty_after_sanitize',
    })
    return placeholder
  }

  return sanitized
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * General-purpose string sanitizer.
 * Applies Rules 2-5 from docs/llm-provider.md §4 in order, then truncates
 * (Rule 1 truncation applied last to guarantee the cap after rule expansions).
 *
 * @param input     Raw user-controlled (or assistant-generated echo-path) string.
 * @param maxBytes  Maximum UTF-8 byte length.
 */
export function sanitizeUserString(input: string, maxBytes: number): string {
  try {
    // Rule 2 -- strip C0 + DEL + C1 control chars + direction overrides
    let s = stripControlChars(input)

    // Rule 3 -- template-syntax replacement (raw openers + complete sequences)
    for (const [pattern, replacement] of TEMPLATE_SUBS) {
      s = s.replace(pattern, replacement)
    }

    // Rule 4 -- jailbreak-prefix replacement
    for (const pattern of JAILBREAK_PREFIXES) {
      s = s.replace(pattern, FILTERED)
    }

    // Rule 5 -- whitespace collapse then allowlist-only character pass.
    // Collapse first so runs of mixed whitespace become a single space before
    // the allowlist step replaces non-allowlisted chars with spaces.
    s = s.replace(/\s+/g, ' ').trim()
    s = applyAllowlist(s)
    s = s.replace(/\s+/g, ' ').trim() // second pass to clean up allowlist-induced spaces

    // Rule 1 -- UTF-8 byte truncation (last, ensures cap holds after all replacements)
    return truncateToByteLength(s, maxBytes)
  } catch {
    // Safety net: return empty string rather than surfacing an unexpected internal error.
    return ''
  }
}

/**
 * Sanitize a player-set nickname. Hard cap: 32 UTF-8 bytes.
 * Spec: docs/llm-provider.md §4 per-field cap table, row "nickname".
 */
export function sanitizeNickname(input: string): string {
  return sanitizeUserString(input, 32)
}

/**
 * Sanitize a user-visible item name. Hard cap: 64 UTF-8 bytes.
 * Spec: docs/llm-provider.md §4 per-field cap table, row "item name".
 */
export function sanitizeItemName(input: string): string {
  return sanitizeUserString(input, 64)
}

/**
 * Sanitize an assistant-generated idle.reason string before it is echoed
 * into the next-tick prompt via AgentSessionState.providerContext.
 *
 * idle.reason is LLM-generated (not user-controlled), but constitutes a
 * BOO-405 (b-2) prompt-recursion surface: the value from tick N is re-fed to
 * the LLM at tick N+1 inside providerContext. Without sanitization on this
 * echo path the LLM can inject directives to itself across ticks.
 * Applying the same full pipeline prevents cross-tick self-injection.
 *
 * Cross-link: BOO-405. Hard cap: 128 UTF-8 bytes (mirrors IdleSchema.reason.max(128)).
 * Spec: docs/llm-provider.md §4 per-field cap table, row "idle.reason".
 */
export function sanitizeIdleReason(input: string): string {
  return sanitizeUserString(input, 128)
}
