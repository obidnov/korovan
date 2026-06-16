#!/usr/bin/env bash
# check-no-secrets-committed.sh
# CI gate: exit non-zero if any committed/staged file contains a credential-shaped value.
# Sourced from BOO-463 §2.1 + §4 redaction rules.
# RE wires this as a required check on the `develop` branch (GitHub Actions).

set -euo pipefail

# Patterns from §4.1 (field-name) and §4.2 (value-shape) — redaction class: strict.
# We grep staged+committed content (not .env.local which is gitignored).

CREDENTIAL_PATTERNS=(
  # §4.2 value-shape — OpenAI-family and Anthropic keys
  'sk-[A-Za-z0-9_-]{20,}'
  'sk-ant-[A-Za-z0-9_-]{20,}'
  # Inline Bearer token literals (not env-var references)
  'Bearer [A-Za-z0-9._~+/=-]{20,}'
  # 64-hex string (COOKIE_SIGNING_SECRET shape: openssl rand -hex 32)
  '[0-9a-f]{64}'
)

# Files to skip (binary, lock files, expected output)
EXCLUDE_PATTERNS=(
  '*.png' '*.jpg' '*.jpeg' '*.gif' '*.ico' '*.woff' '*.woff2' '*.ttf'
  '*.lock' 'pnpm-lock.yaml' 'package-lock.json' 'yarn.lock'
  'docs/runbooks/secret-rotation.md'  # contains example patterns, not real secrets
  'scripts/check-no-secrets-committed.sh'  # this file itself
)

# Build the git grep exclude args
EXCLUDE_ARGS=()
for p in "${EXCLUDE_PATTERNS[@]}"; do
  EXCLUDE_ARGS+=(":(exclude)$p")
done

FOUND=0

for pattern in "${CREDENTIAL_PATTERNS[@]}"; do
  # Search committed content (HEAD) and staged changes
  if git grep -qE "$pattern" HEAD -- "${EXCLUDE_ARGS[@]}" 2>/dev/null; then
    echo "❌ SECRET PATTERN FOUND IN COMMITTED FILES: $pattern"
    git grep -nE "$pattern" HEAD -- "${EXCLUDE_ARGS[@]}" 2>/dev/null | head -20
    FOUND=1
  fi
  # Also check staged (index) content not yet in HEAD
  if git diff --cached -U0 | grep -E "^\+" | grep -qE "$pattern" 2>/dev/null; then
    echo "❌ SECRET PATTERN FOUND IN STAGED CHANGES: $pattern"
    git diff --cached -U0 | grep -E "^\+" | grep -E "$pattern" | head -20
    FOUND=1
  fi
done

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "ABORT: Potential secrets detected in committed or staged content."
  echo "Review the matches above. If a match is a false positive (e.g. a test fixture"
  echo "placeholder), add the specific file to the exclude list in this script and"
  echo "document the rationale with a comment. Do NOT commit real secret values."
  echo ""
  echo "See: docs/secrets.md §4 (redaction rules) and docs/runbooks/secret-rotation.md"
  exit 1
fi

echo "✓ No secret patterns found in committed or staged files."
exit 0
