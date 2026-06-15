# Identity Model — Anonymous Cookie + Bootstrap Flow

**Issue:** BOO-470  
**Status:** CSO review pending  
**Plan ref:** PLAN.md §P0-6  
**Blocker for:** EP-2, EP-3, EP-4, EP-5, EP-7, BC-4

---

## 1. Overview

Korovan uses **anonymous cookie-based identity**. There is no email, password, or OAuth in MVP. A player is identified by a `player_id` (UUID v4) signed into an `httpOnly` cookie. The cookie is the only identity store — the client persists nothing else.

Email + passcode upgrade is deferred to P5 (§5).

---

## 2. Cookie profile

| Attribute | Value | Rationale |
|---|---|---|
| Name | `kr_pid` | Short, opaque; no PII hint |
| Value | `<player_id>.<HMAC-SHA256(player_id, COOKIE_SIGNING_SECRET)>` | Tamper-evident; server validates HMAC on every request |
| `httpOnly` | `true` | Not readable from JS; prevents XSS exfiltration |
| `Secure` | `true` | HTTPS-only (P0-2 platform terminates TLS) |
| `SameSite` | `Lax` | Game is same-origin static-asset + same-origin API; Lax sufficient |
| `Path` | `/` | Sent on all requests |
| `Max-Age` | `31536000` (1 year) | Long-lived; renewed on each authenticated request |
| `Domain` | unset (host-only) | No subdomain sharing in MVP |

### 2.1 Cookie value format

```
kr_pid=<player_id>.<HMAC-SHA256 hex>
```

- `player_id`: UUID v4 (`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`).
- `HMAC-SHA256 hex`: 64-char lowercase hex digest.
- Separator: exactly one `.` dot. Player IDs contain hyphens, not dots, so splitting on the first dot after the UUID is unambiguous. Implementation must split on the **last** dot to be robust against future value changes; or better: split on the position after the fixed-length UUID (36 chars).

Recommended split: `const [playerId, sig] = [raw.slice(0, 36), raw.slice(37)]` (index 36 is the dot).

### 2.2 HMAC signing

```
HMAC-SHA256(key=COOKIE_SIGNING_SECRET, message=player_id)
```

- `COOKIE_SIGNING_SECRET` is a server-only env var — never shipped to the client.
- Minimum secret length: 32 bytes (256 bits). Reject on startup if shorter.
- Validation must use **constant-time comparison** (`crypto.timingSafeEqual`) to prevent timing attacks.

---

## 3. Bootstrap flow — `POST /api/identity/bootstrap`

### 3.1 Request

```
POST /api/identity/bootstrap
Content-Type: application/json

{ "nickname": "Vasya" }   // nickname is optional
```

No auth required. Any existing cookie is ignored if present (re-bootstrap path handled in §3.3).

### 3.2 Happy path — new identity

1. Server reads body; `nickname` is optional (may be absent, `null`, or `""`).
2. Server sanitizes nickname per P0-4 sanitizer:
   - Truncate to ≤ 32 characters.
   - Strip control characters (U+0000–U+001F, U+007F–U+009F).
   - Replace jailbreak prefixes (`"Ignore all previous"`, `"You are now"`, etc.) with `[redacted]`.
   - Result may be `null` (omitted or empty-after-sanitization → NULL in DB).
3. Server generates `player_id = crypto.randomUUID()`.
4. Server inserts `players` row:
   ```sql
   INSERT INTO players (id, nickname, created_at)
   VALUES (player_id, sanitized_nickname, NOW())
   ```
5. Server computes `sig = HMAC-SHA256(player_id, COOKIE_SIGNING_SECRET)`.
6. Server sets `Set-Cookie: kr_pid=<player_id>.<sig>; …` (full attributes from §2).
7. Server returns `200 OK`:
   ```json
   { "player_id": "<uuid>", "nickname": "<string or null>" }
   ```

### 3.3 Re-bootstrap with existing valid cookie

If the request arrives with a valid `kr_pid` cookie:
1. Validate HMAC (§4.1).
2. Look up `players` row by `player_id`.
3. If row exists: return `200 OK` with existing `{ player_id, nickname }`. **No new row, no cookie rotation.**
4. If row missing (deleted): treat as first-time visit (step 3.2 flow).

### 3.4 Re-bootstrap with invalid/tampered cookie

1. HMAC validation fails.
2. Drop cookie via `Set-Cookie: kr_pid=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`.
3. Proceed as first-time visit (§3.2 flow).

### 3.5 Response shape contract

```ts
interface BootstrapResponse {
  player_id: string   // UUID v4
  nickname: string | null
}
```

---

## 4. Cookie authentication middleware

File: `server/src/middleware/cookieAuth.ts`

Runs before every cookie-authenticated endpoint. See reference skeleton at `server/src/middleware/cookieAuth.ts`.

### 4.1 Validation algorithm

```
1. Read req.cookies['kr_pid']
2. If absent → next() (unauthenticated; endpoint decides if 401)
3. Split: playerId = raw.slice(0, 36), sig = raw.slice(37)
4. Recompute expected = HMAC-SHA256(playerId, COOKIE_SIGNING_SECRET)
5. timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
6. On match:
   a. Load players row by playerId
   b. If missing: drop cookie (Set-Cookie: kr_pid=; Max-Age=0 …), next() unauthenticated
   c. If found: set req.player = { id, nickname }; next()
7. On mismatch:
   a. Drop cookie (Set-Cookie: kr_pid=; Max-Age=0 …)
   b. return res.status(401).json({ error: 'invalid_cookie' })
      (bootstrap endpoint is exempted from this 401)
```

### 4.2 TypeScript extension

```ts
// server/src/types/express.d.ts
declare namespace Express {
  interface Request {
    player?: { id: string; nickname: string | null }
  }
}
```

---

## 5. Nickname management

### 5.1 Initial capture

Set at bootstrap time (optional). Stored in `players.nickname` (nullable VARCHAR(32)).

### 5.2 Display fallback

When `nickname` is `null`, display layer uses `"Anonymous #<player_id.slice(0,6)>"`.

### 5.3 Update endpoint (P1)

`PATCH /api/identity/me` — same sanitization as §3.2 step 2. Requires valid cookie auth. Out of scope for P0.

---

## 6. `players` table schema

```sql
CREATE TABLE players (
  id           CHAR(36)     NOT NULL PRIMARY KEY,  -- UUID v4
  nickname     VARCHAR(32)  NULL,
  cookie_version INT        NOT NULL DEFAULT 1,     -- era tracker for secret rotation
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                            ON UPDATE CURRENT_TIMESTAMP(3)
);
```

`cookie_version` is not read on the hot path — it's a forensic/analytics column incremented during secret rotation (§8.2).

---

## 7. Threat model

### In scope

| Threat | Mitigation |
|---|---|
| **Forged `player_id`** | HMAC validation — cannot produce a valid sig without `COOKIE_SIGNING_SECRET` |
| **Replay across users** | HMAC is tied to the specific `player_id`; replaying another player's cookie requires knowing their ID and the secret |
| **Cookie theft via stored XSS** | `httpOnly` — cookie not accessible from JS |
| **Timing attack on HMAC compare** | `crypto.timingSafeEqual` — constant-time byte comparison |
| **Nickname injection into LLM prompts** | P0-4 sanitizer; jailbreak-prefix replacement |
| **MITM cookie interception** | `Secure` flag + platform-level TLS (P0-2) |

### Out of scope for P0

- Device fingerprinting
- Account recovery without email
- CSRF (game is a single-page app; all mutating requests use `Content-Type: application/json`, which a form-based CSRF attack cannot set; SameSite=Lax also mitigates)

---

## 8. Future upgrade path (P5 — informational only)

**Nothing in P0/P1 implements this.** Documented here to constrain schema decisions.

### 8.1 Email + passcode cross-device upgrade

1. User submits email on a settings page (P5 UI).
2. Server stores hashed passcode in new `email_credentials` table; links to existing `player_id`.
3. Server sends passcode via SMTP/SES.
4. User confirms → cookie identity is "promoted"; `players.email` becomes a NOT NULL alternate key.
5. New device: email → passcode → server issues `kr_pid` tied to the existing `player_id`.

### 8.2 Signing-secret rotation

- Rotation invalidates all cookies (acceptable MVP behavior; users re-bootstrap new identity).
- `players.cookie_version` is incremented to track the era for forensic queries.
- Future: multi-version validation (attempt current secret first, then previous) to allow zero-downtime rotation.

### Constraint

`player_id` is and remains the canonical identity key. Do not make `email` a primary key. The `players` table's primary key stays `id` (UUID v4).

---

## 9. Acceptance criteria

- [ ] Spec doc lives at `docs/identity.md` ✓ (this file)
- [ ] Cookie attributes set per §2 (httpOnly + Secure + SameSite=Lax)
- [ ] HMAC validation uses `crypto.timingSafeEqual`
- [ ] CSO `cso-signoff: approved` on §2 (cookie profile) and §4 (validation algorithm)
- [ ] Bootstrap returns `{ player_id, nickname }` + sets cookie atomically (one response)
- [ ] Re-bootstrap with valid cookie does NOT create a duplicate `players` row (§3.3)
