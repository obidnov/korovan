# Secret Rotation Runbook — korovan backend

**Document owner:** Release Engineer
**Created:** 2026-06-15
**Parent spec:** [BOO-463](paperclip://issues/BOO-463) (P0-3 secrets-handling spec), §5
**Deploy topology:** Fly.io free-tier single-VM — see `docs/deploy-target.md`

---

## Preamble

This runbook documents manual secret rotation procedures for the korovan backend on the
**Fly.io free-tier single-VM topology** pinned by BOO-462.

### Restart-window behavior (source: BOO-484 + CSO sign-off on BOO-462, note 2)

On the current single-VM Fly.io topology, `fly secrets set` triggers a **per-machine
stop+start** — a brief **~10–30 s outage** with no rolling overlap, because there is only
one machine to roll. This is the documented Fly.io behavior, not a bug, and is consistent
with P0-3 §5.2 ("accept temporary outage over continued exposure"; no dual-secret grace
window in MVP).

> Source: CSO sign-off on BOO-462, `approved-with-notes`, Note 2
> (comment `8b4af498-3a49-4672-873d-468bcd0af116` on BOO-462).
> Captured as a content requirement in BOO-484.

Every per-secret section below includes an **"Expected restart window"** callout with
boundary details specific to that secret class.

### Change log

| Date | Change | Issue |
|---|---|---|
| 2026-06-15 | Initial — all three secret classes + restart-window notes | [BOO-484](paperclip://issues/BOO-484) |

---

## Prerequisites

```bash
flyctl version           # Fly CLI installed
fly auth whoami          # authenticated
# App name matches fly.toml (typically "korovan")
```

---

## §5.1 — AI provider key rotation

**Secrets covered:** `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_COMPAT_KEY`

### When to rotate
- On suspected or confirmed key leak (immediate; see Leak-response priority below).
- On provider recommendation.
- Periodically per provider policy (varies; check dashboard settings).

### Leak-response priority

**Revoke at the provider dashboard FIRST — do not wait for the Fly secret update.**

1. Go to the provider dashboard (DeepSeek / Anthropic / OpenAI-compatible) and revoke the
   compromised key. This stops billing exposure immediately.
2. Generate a replacement key in the dashboard.
3. Set the new key via Fly (step 3 in Rotation steps below).

### Rotation steps

1. Generate a new API key at the provider dashboard.
2. Rotate via Fly CLI:
   ```bash
   # Replace DEEPSEEK_API_KEY with the relevant secret name
   fly secrets set DEEPSEEK_API_KEY=<new-key> --app korovan
   ```
3. Monitor the restart (see **Expected restart window** below).
4. Verify boot log:
   ```bash
   fly logs --app korovan
   # Expect: "<SECRET_NAME>: configured" (presence, not value)
   # Must NOT appear: "<SECRET_NAME>: missing" or adapter-disabled warnings
   ```
5. Smoke-test: send a test LLM-decide request (or hit `/healthz`).

### Expected restart window

> **~10–30 s stop+start during `fly secrets set`** — single-VM topology.
>
> | Boundary | Behavior |
> |---|---|
> | SQLite database (`/data/korovan.db`) | **Untouched.** Persistent Fly volume survives all restarts. |
> | Ephemeral container filesystem | Reset on each restart. No persistent state stored there. |
> | In-flight HTTP connections | **Drop** at stop. Clients will see TCP connection errors. |
>
> No in-flight LLM-decide requests are retried automatically in the current MVP.

### Scheduling guidance

- **Leak-response:** Rotate immediately. Provider revoke (step 1) takes effect instantly;
  the Fly secret update follows as fast as possible.
- **Planned rotations:** Prefer a low-traffic window (e.g. overnight) to minimize request
  failures during the restart window.

### Future scale path

When deployment scales to **≥2 Fly machines**, `fly secrets set` triggers a **rolling
restart** (one machine at a time, with healthy overlap). This eliminates the total-outage
window. Update this note to reflect rolling semantics at that time. No spec change needed —
doc-text refresh only.

---

## §5.2 — Cookie signing secret rotation

**Secret:** `COOKIE_SIGNING_SECRET`

### When to rotate
- Every **90 days** (planned cadence per P0-3 §1).
- On suspected or confirmed secret leak (immediate).

### Session invalidation

Rotating `COOKIE_SIGNING_SECRET` **immediately invalidates all existing user sessions** —
every active user is logged out. This is acceptable in MVP: there is no email-recovery or
session-continuity flow; users receive a new cookie on their next request.

### Rotation steps

1. Generate a new signing secret (≥32 bytes, cryptographically random):
   ```bash
   openssl rand -hex 32
   ```
2. Set via Fly CLI:
   ```bash
   fly secrets set COOKIE_SIGNING_SECRET=<new-secret> --app korovan
   ```
3. Monitor the restart (see **Expected restart window** below).
4. Verify: confirm existing sessions are rejected and users receive fresh cookies on
   next login. No error in `fly logs` beyond normal session-rejected messages.
5. Record the rotation date (for next 90-day reminder).

### Expected restart window

> **~10–30 s stop+start during `fly secrets set`** — single-VM topology.
>
> | Boundary | Behavior |
> |---|---|
> | SQLite database (`/data/korovan.db`) | **Untouched.** Session state is cookie-based (not in SQLite); no data loss. |
> | Ephemeral container filesystem | Reset. |
> | In-flight HTTP connections | **Drop.** Active sessions invalidated (expected; this is the rotation effect). |
>
> Users who experience a dropped connection will see a login prompt on refresh — this is
> the expected post-rotation behavior.

### Scheduling guidance

- **Planned rotations (90-day cadence):** Rotate in a low-traffic window. Notify active
  demo participants in advance when possible — they will be logged out.
- **Leak-response:** Rotate immediately. Session disruption is acceptable.

### Future scale path

When ≥2 machines: service restart becomes rolling (no total-outage window). Session
invalidation still applies immediately across all machines simultaneously — all cookies
signed with the old secret are rejected at first request, regardless of which machine
handles it. Update the restart note to reflect rolling restart semantics; the session
invalidation behavior does not change.

---

## §5.3 — Database URL rotation

**Secret:** `DATABASE_URL`

### When to rotate
- On storage reconfiguration or database file path change.
- On confirmed credential leak (if the URL embeds credentials — not the case in the current
  local SQLite topology; see Current topology note below).
- Not on a periodic cadence in the current topology.

### Current topology note

In the current Fly.io SQLite setup, `DATABASE_URL` is a local filesystem path
(e.g. `sqlite:///data/korovan.db`). It does **not** embed network credentials. Rotation
is primarily relevant for:

- **Path changes** — if the database file location is reconfigured.
- **Future Turso / LibSQL migration** — if the project moves to a networked SQLite
  provider, the URL will embed an auth token or password and periodic rotation becomes
  necessary. Update this section at that time.

### Rotation steps

1. Confirm the new `DATABASE_URL` value (new path, new connection string, or new
   credentials for a networked provider).
2. **If the database file is being moved:** migrate data out-of-band first (operator action)
   before updating the URL — the server will immediately try to open the new path on boot.
3. Set via Fly CLI:
   ```bash
   fly secrets set DATABASE_URL=<new-url> --app korovan
   ```
4. Monitor the restart (see **Expected restart window** below).
5. Verify boot log:
   ```bash
   fly logs --app korovan
   # Expect: successful database connection log; no "DATABASE_URL: missing" or migration errors
   ```
6. Smoke-test: write + read a save record to confirm the database is live at the new path.

### Expected restart window

> **~10–30 s stop+start during `fly secrets set`** — single-VM topology.
>
> | Boundary | Behavior |
> |---|---|
> | SQLite database (`/data/korovan.db`) | **Untouched.** The file on the persistent volume is preserved regardless of the URL change. |
> | Ephemeral container filesystem | Reset. |
> | In-flight HTTP connections | **Drop.** Any in-progress save or read requests fail. |
>
> **Data-loss risk (path change):** If the new `DATABASE_URL` points to a path other than
> the existing populated file, the server opens (or creates) that path on boot — it will
> appear to start with an empty database. Verify the new path resolves to the correct
> populated file before setting.

### Scheduling guidance

- **Planned rotations / path changes:** Always rotate in a low-traffic window. Complete
  the data migration (step 2) before setting the new URL.
- **Leak-response:** Rotate immediately if credentials are compromised. Applies primarily
  in the networked-provider future topology.

### Future scale path

When the project migrates to a networked SQLite provider (e.g. Turso / LibSQL),
`DATABASE_URL` will embed credentials. At that point:
- Add a periodic rotation cadence.
- Confirm the provider supports zero-downtime credential rotation (e.g. dual-token grace
  period at the provider level).
- Update this section with provider-specific rotation steps.

Rolling restarts (≥2 Fly machines) also apply; update the restart note at that time.

---

## Appendix: Fly.io restart behavior reference

| Operation | Single-VM (current free-tier) | ≥2 VMs (future) |
|---|---|---|
| `fly secrets set ...` | Stop + start — **~10–30 s outage** | Rolling restart — no total outage |
| `fly deploy` | Stop + start | Rolling restart |
| `fly machine restart` | Immediate restart of that machine | Per-machine; others stay up |

**Persistent volume behavior (all operations above):**
The Fly volume mounted at `/data` is preserved across all restarts, deploys, and secret
rotations. The SQLite file at `/data/korovan.db` is safe in all cases.

---

*Last updated: 2026-06-15 — [BOO-484](paperclip://issues/BOO-484)*
