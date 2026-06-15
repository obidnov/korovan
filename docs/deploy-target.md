# Deploy Target Decision — korovan backend

**Decision date:** 2026-06-15  
**Decision owner:** Release Engineer (BOO-462)  
**Parent issue:** BOO-455 (korovan backend epic)

---

## Decision: **Fly.io**

Fly.io is the chosen hosting platform for the korovan backend for the demo phase.

---

## Evaluation against criteria

### 1. Free or cheap tier (≤10k LLM-decide calls/day, ≤100 concurrent saves, ≤1GB SQLite)

**Fly.io ✅** — Free tier includes 3 shared-cpu-1x machines + 3GB persistent volumes + 160GB outbound transfer/month. All demo-phase traffic fits within this envelope.

### 2. Persistent volume support for SQLite

**Fly.io ✅** — Fly volumes are SSD-backed block storage, persisted across deploys and restarts. Mount at `/data` → SQLite file at `/data/korovan.db`. 1GB volume is free.

### 3. HTTPS terminator built-in

**Fly.io ✅** — Automatic TLS via Fly's Anycast edge; custom domain HTTPS with auto-cert-renewal included.

### 4. Single-region (multi-region is non-goal for MVP)

**Fly.io ✅** — Default deploy is single-region (`--region iad` or closest). Multi-region is trivially added later via `fly regions add` — no architectural rework required.

### 5. Secrets manager (env-var injection at deploy time)

**Fly.io ✅** — `fly secrets set KEY=VALUE` injects secrets as env vars at runtime. Secrets are encrypted at rest in Fly's vault; they do not appear in the image layers, build logs, or stdout. Compatible with the BOO P0-3 secrets layout (`DATABASE_PATH`, `AI_API_KEY`, `SESSION_SECRET`, etc.).

### 6. Observability (stdout/stderr, ≥7 days)

**Fly.io ✅** — `fly logs --instance <id>` streams live; Fly retains log history. Default retention is sufficient for incident triage. Can forward to external logging (e.g. Logtail, Papertrail) if needed post-demo.

---

## Cost projection — demo phase worst case

| Resource | Free allocation | Demo usage | Cost |
|---|---|---|---|
| 1× shared-cpu-1x VM (256MB RAM) | 3 machines/month free | 1 always-on machine | **$0** |
| 1GB persistent volume | 3GB total free | 1GB for SQLite | **$0** |
| Outbound transfer | 160GB/month free | ≤10k calls/day × ~10KB avg response = ~3GB/month | **$0** |
| **Total** | | | **$0/month** |

**If traffic 10×:** VM stays free (shared-cpu-1x handles ~100 concurrent connections without issue at this payload size). Volume at 1GB boundary → $0.15/GB/month for overage → **~$0–0.30/month** additional. Entirely manageable.

**If we need more RAM** (e.g. LLM response buffering at scale): upgrade to shared-cpu-1x 512MB = ~$2.49/month. Still effectively free.

---

## Rejected alternatives

### Render — REJECTED

**Reason: disk persistence is not in the free tier.**

Render's free "Web Service" tier does not include persistent disks. Disks are a paid add-on ($0.25/GB/month, minimum $7/month plan required to attach one). Using SQLite on Render would require paying from day 1, contradicting the "free for demo" constraint. There is no workaround: Render's in-memory filesystem is wiped on every deploy/restart, so SQLite data would be lost.

Secondary concern: Render free tier web services sleep after 15 minutes of inactivity, introducing cold-start latency (~30s) for the first request after idle. Acceptable for some demos, but worse UX than Fly.io.

### Railway — REJECTED

**Reason: no permanent free tier; credit exhaustion risk mid-demo.**

Railway's free offering is $5/month in credits ("Hobby" trial), not a perpetual free tier. A 24/7 demo backend on a 1× CPU + 512MB instance costs approximately $5–8/month at Railway's pricing, meaning the free credit exhausts within the first month. At that point the service stops until a billing method is added. This is an unacceptable reliability risk for a live demo with external stakeholders.

Railway volumes work correctly and HTTPS is built-in — the platform is technically sound — but the pricing model doesn't fit our constraint.

---

## What comes next

| Step | Owner | Issue |
|---|---|---|
| Deployment-readiness checklist (Dockerfile, healthcheck, port, build cmd, volume mount) | RE + BD | See child issue under BOO-455 |
| Secrets-handling spec (env layout, redaction rules) | CSO sign-off | BOO-463 |
| First deploy (after P0-1 bootstrap ships + P0-3 signed off) | RE | Follow-up under BOO-455 |
