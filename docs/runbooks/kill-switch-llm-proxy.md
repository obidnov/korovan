# Kill-Switch Runbook — LLM Proxy Toggle

**Document owner:** Release Engineer
**Created:** 2026-06-17
**Origin:** [BOO-568](paperclip://issues/BOO-568) (CSO sign-off note 2 on BOO-566)
**Deploy topology:** Fly.io single-instance — see `docs/deploy-target.md`

---

## What this runbook covers

The `LLM_PROXY_ENABLED` env-var kill-switch forces every `POST /api/llm/decide` call into
scripted-AI fallback within one deploy cycle, without a code change. This runbook documents
**when to trigger it, how to verify it propagated, and how to re-enable**.

## When to trigger

Trigger the kill-switch when any of the following occur:

| Scenario | Indicator |
|---|---|
| **Provider compromise** | Unauthorized requests using your DeepSeek API key; anomalous spend in the DeepSeek dashboard |
| **Cost runaway** | Daily token spend approaching or exceeding the §11 global ceiling (5 M tokens/day); unexpected latency spikes driving retry storms |
| **Prompt-injection incident** | `/api/llm/decide` returning commands outside the allowed `AgentCommandSchema`; logs show `llm-decide:schema-invalid` at high rate |
| **Provider outage** | Sustained `llm-decide:provider-error` (code `provider-5xx` or `network`) logged as `alert: CSO-ALERT`; scripted fallback already active but you want guaranteed fallback until provider recovers |

## Trigger procedure

### Step 1 — Set the kill-switch secret

```bash
fly secrets set LLM_PROXY_ENABLED=false --app korovan
```

Fly.io will queue a rolling restart. On the current single-instance topology this takes
**30–90 s** (one machine stop+start). There is a brief outage window during restart.

### Step 2 — Verify propagation

Poll `/healthz` until `llm_proxy_enabled` flips to `false`:

```bash
# Single check
curl -s https://korovan.fly.dev/healthz | jq '.llm_proxy_enabled'
# Expected: false

# Poll loop (exits when confirmed)
until [ "$(curl -s https://korovan.fly.dev/healthz | jq '.llm_proxy_enabled')" = "false" ]; do
  echo "waiting…"; sleep 5
done
echo "Kill-switch confirmed active"
```

If `llm_proxy_enabled` remains `true` after 120 s:
1. Check that the secret was applied: `fly secrets list --app korovan` should show `LLM_PROXY_ENABLED`.
2. Check machine status: `fly status --app korovan`.
3. Force a restart if needed: `fly machine restart --app korovan`.

### Step 3 — Confirm scripted fallback in responses

```bash
# Requires a valid session cookie; used only in pre-prod verification
curl -s -b "session=<valid_cookie>" \
  -H "Content-Type: application/json" \
  -d '{"faction":"palace_guard","snapshot":{...}}' \
  https://korovan.fly.dev/api/llm/decide | jq '.source'
# Expected: "fallback"
```

> **Note:** `/api/llm/decide` requires authentication. The `/healthz` check above is
> sufficient for operational verification without needing a session cookie.

## RTO expectations

| Topology | Expected restart time | Notes |
|---|---|---|
| Single-instance (current) | 30–90 s | One machine; brief outage during restart. |
| Multi-instance (future) | 60–180 s | Rolling restart per machine; no full outage. Each machine must be verified independently or via shared healthz aggregation. |

For the current single-instance deployment, full kill-switch activation is confirmed in
**under 2 minutes** from `fly secrets set`.

## Re-enable procedure

Once the incident is resolved and the provider is safe to use:

### Step 1 — Root cause confirmed resolved

Before re-enabling, confirm:
- [ ] The triggering incident is closed (API key rotated / provider acknowledges outage
  resolved / injection vector patched).
- [ ] Incident post-mortem drafted (see Post-incident review checklist below).

### Step 2 — Re-enable the proxy

```bash
fly secrets set LLM_PROXY_ENABLED=true --app korovan
```

### Step 3 — Verify re-enable

```bash
curl -s https://korovan.fly.dev/healthz | jq '.llm_proxy_enabled'
# Expected: true
```

### Step 4 — Monitor for 15 minutes post-re-enable

Watch logs for `llm-decide:provider-error` recurrence:

```bash
fly logs --app korovan | grep 'llm-decide'
```

If errors resume, re-trigger the kill-switch (Step 1 of trigger procedure) and escalate.

## Post-incident review checklist

File a follow-up issue after every kill-switch activation:

- [ ] Timeline documented (trigger time → propagation confirmed → re-enable time).
- [ ] Triggering event root-caused.
- [ ] If cost runaway: daily ceiling reviewed; §11 token-budget cap adequate?
- [ ] If provider compromise: API key rotated (see `docs/runbooks/secret-rotation.md`).
- [ ] If prompt injection: schema validation coverage gap identified + issue filed.
- [ ] Kill-switch propagation RTO within SLO (< 2 min)? If not, document anomaly.
- [ ] This runbook updated if any step was unclear or incorrect.

## Related documents

- `docs/runbooks/secret-rotation.md` — rotate `DEEPSEEK_API_KEY` after provider compromise
- `docs/deploy-target.md` — Fly.io topology and restart behavior
- `PLAN.md` §11 — budget gate: global daily ceiling (5 M tokens/day) and cap rows
- [BOO-566](paperclip://issues/BOO-566) — DeepSeek cap profile (CSO approved)
