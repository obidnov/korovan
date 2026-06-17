# korovan — Product plan

**Revision:** v3 (2026-06-15)
**Author:** CEO
**Status:** Architecture pivot — backend (Node + Express + TS) added. v2.1 client-only assumptions superseded by board decision in [BOO-455](paperclip://issues/BOO-455). LLM-provider apiKey moves browser → server, LLM calls now proxied, saves move localStorage → server, plus new leaderboards and server-side AI-state surfaces. Handed off to Tech Lead for backend-slice decomposition. See §7 for locked answers, §5b for the new backend architecture, and §10 for the v3 delta.
**Source brief:** [BOO-374](paperclip://issues/BOO-374) — Kirill's original wishlist, preserved verbatim in §1.
**Architecture pivot:** [BOO-455](paperclip://issues/BOO-455) — board decision (2026-06-15).

---

## 1. The brief (verbatim from Kirill)

> Здраствуйте. Я, Кирилл. Хотел бы чтобы вы сделали игру, 3Д-экшон суть такова... Пользователь может играть лесными эльфами, охраной дворца и злодеем. И если пользователь играет эльфами то эльфы в лесу, домики деревяные набигают солдаты дворца и злодеи. **Можно грабить корованы...** И эльфу раз лесные то сделать так что там густой лес... А движок можно поставить так что вдали деревья картинкой, когда подходиш ни преобразовываются в 3-хмерные деревья. Можно покупать и т.п. возможности как в Daggerfall. И враги 3-хмерные тоже, и труп тоже 3д. Можно прыгать и т.п.
>
> Если играть за охрану дворца то надо слушаться командира, и защищать дворец от злого (имя я не придумал) и шпионов, партизанов эльфов, и ходит на набеги на когото из этих (эльфов, злого...).
>
> Ну а если за злого... то значит шпионы или партизаны эльфов иногда нападают, пользователь сам себе командир может делать что сам захочет прикажет своим войскам с ним самим напасть на дворец и пойдет в атаку.
>
> Всего в игре 4 зоны. Т.е. карта и на ней есть 4 зоны, 1 - зона людей (нейтрал), 2- зона императора (где дворец), 3-зона эльфов, 4 - зона злого... (в горах, там есть старый форт...)
>
> Так же чтобы в игре могли не только убить но и отрубить руку и если пользователя не вылечат то он умрет, так же выколоть глаз но пользователь может не умереть а просто пол экрана не видеть, или достать или купить протез, если ногу тоже либо умреш либо будеш ползать либо на коляске котаться, или самое хорошее... поставить протез.
>
> Сохранятся можно...
>
> P.S. Я джва года хочу такую игру.

## 2. Distilled product vision

| Pillar | What it means |
|---|---|
| **Three asymmetric factions** | Forest elves (guerilla raiders), Palace guard (disciplined defenders), the Villain (chaotic warlord). Each plays differently — different goals, units, abilities, base zone. |
| **4-zone overworld** | Neutral humans (trade hub), Emperor's palace, Elf forest, Villain's mountain fort. Travel between zones via overworld map. |
| **Caravan raiding (universal)** | The signature mechanic. Caravans periodically traverse zones; **all three factions** can intercept and loot them (board sign-off Q4 — see §7). |
| **Dense forest with LOD** | Far trees = billboards, near trees = 3D meshes. The elf zone *feels* dense and oppressive — visual identity of the game. |
| **Daggerfall-lite economy** | Shops, currency, gear progression. Buy weapons, armor, healing items, **prosthetics**. |
| **Limb-and-wound system** | Real consequence layer. Lose a hand → bleed out unless healed. Lose an eye → half-screen black until prosthetic. Lose a leg → crawl / wheelchair / prosthetic. Differentiator vs. typical web action games. |
| **Pluggable LLM-agent opponent (server-proxied)** | The opposing faction is commanded by an LLM agent. **The korovan backend proxies all provider calls.** Provider apiKey lives **server-side** (env / hosting secrets); the browser never sees it. Default provider in P1 is **DeepSeek**; Anthropic-compatible and OpenAI-compatible adapters land in later phases via the same `LLMProvider` interface, **all server-side**. Scripted AI runs as the always-on fallback when the LLM call errors out *or* when the backend itself is unreachable, so the game is always playable. |
| **Server-side persistence** | Save game lives on the korovan backend (`/api/saves`). Player identity = anonymous account with server-issued device-id cookie + optional nickname (board-decided minimal identity model — see §5b). localStorage retained **only** for UI preferences (volume, key bindings) and an offline save buffer that syncs when the backend is reachable. |
| **Leaderboards** | Per-zone / per-faction rankings served by the korovan backend (`/api/leaderboard`). Server validates run results before posting. (Board-added in v3.) |
| **Web-native client** | No install. Game client runs in modern browsers via WebGL/WebGPU. Requires the korovan backend reachable for AI + saves + leaderboards; falls back to scripted-AI and local save buffer when offline. |

## 3. MVP definition (what ships first)

**Goal of MVP:** prove the core loop is fun and the tech stack scales, on the smallest possible content footprint. The MVP now also proves the **client ↔ backend ↔ provider** wire works end-to-end.

**MVP scope (single playable faction, single zone, vertical slice):**

- Faction: **Forest elves only**
- Zone: **Elf forest only** (1 of 4)
- Movement: WASD + space (jump) + 3rd-person camera
- Combat: melee swing (1 weapon), HP, hit/death
- Enemies: 1 type (palace soldier patrol). **Scripted AI** drives moment-to-moment behavior (idle → chase → attack → die). Always runs offline.
- World: dense forest with LOD (billboard ↔ 3D mesh swap), wooden elf houses (3 static models), simple ground
- Signature mechanic: **1 caravan route** — a cart with loot patrols a fixed path, player can intercept and grab loot
- **AI-agent backend proxy** — server endpoint `POST /api/llm/decide`. Client sends a strategic-state snapshot; server runs the DeepSeek adapter (the only P1 provider, per board priority `61c8898b`) and returns a structured command. *No game-impacting calls yet in MVP* — this is the wire so P2 can activate strategic decisions. Browser sees no provider config and stores no apiKey.
- **Server-side `LLMProvider` interface + DeepSeek adapter** — provider-agnostic interface lives in backend; only DeepSeek concrete impl in P1. Adapters for Anthropic and OpenAI-compat ship later post-P1.
- **Server-side AI state** — the server keeps per-game-session memory (recent commands, faction state) so the agent's worldview persists across calls without sending unbounded history each tick.
- **Server saves** — `POST /api/saves` and `GET /api/saves/me`. Save payload: HP, position, loot, current zone state. Per-player identity required (see §5b). Client maintains an offline buffer in localStorage that syncs when the backend is reachable.
- **Leaderboard MVP slice** — `POST /api/leaderboard` posts a single metric (caravans robbed) for the elf faction in the elf zone; `GET /api/leaderboard?zone=elf&faction=elf` returns top-N. UI = small panel in main menu.
- **Player identity (anonymous)** — server-issued opaque ID via httpOnly cookie on first visit + optional nickname. No email, no password. Full auth (OAuth / email+pw) deferred.
- **Settings panel** — nickname (for leaderboard) + audio volume + key bindings. **No apiKey / provider config in browser.**
- UI: HP bar, loot counter, save/load buttons, main menu, settings panel (nickname + audio + bindings), leaderboard panel
- Audio: footsteps, sword swing, hit, ambient forest loop (4 sounds total)

**Out of MVP** (deferred to later phases): other factions, other zones, limb system, shops/economy, commander AI, faction raids, day/night cycle, multiplayer, cross-device save sync, full auth, **LLM-driven strategic decisions** (the wire ships in MVP, *driving* moves to P2).

**MVP success criteria:**
1. Loads in <10 s on modern desktop browser (cold cache).
2. Holds 60 fps on mid-range hardware (M1 / iGPU laptop) with ~500 visible trees at LOD.
3. Player can complete a caravan robbery loop end-to-end (find → engage guards → loot → return to safe spot → save) in <5 minutes. Save persists across a logout/login cycle on the **same device** (cookie-based identity).
4. Demo-able to Kirill in a single tab, no install.
5. **Client → backend → DeepSeek → backend → client** round-trip on a single `/api/llm/decide` "ping" succeeds and returns a schema-validated command. Browser console contains zero references to the provider apiKey at any point.
6. Backend remains responsive (`/healthz` 200 OK) under MVP single-player load. Offline scenario: when the backend is unreachable, the game continues with scripted-AI and queues save writes locally; on reconnect, save buffer drains.
7. A second machine playing as a different cookie identity can see the first machine's score on the leaderboard within 1 minute of posting.

## 4. Phased roadmap

| Phase | Theme | Headline deliverables | Rough effort |
|---|---|---|---|
| **P0** | Pre-production | Engine pick locked, art direction locked, asset pipeline, repo bootstrap, CI, save-format spec, **AI-agent provider abstraction spec**, **backend bootstrap (Node + Express + TS skeleton, `/healthz`, secrets handling spec, deploy target picked)** | 1–2 wk |
| **P1** | Vertical slice (= MVP, §3) | Elf zone playable end-to-end, 1 caravan, 1 enemy, **server saves**, **server-side LLM proxy + DeepSeek adapter + scripted fallback**, **leaderboard MVP slice**, **anonymous identity (cookie + nickname)**, settings UI (no apiKey) | 5–7 wk |
| **P2** | Map + 2nd faction + **LLM agent goes live** | All 4 zones traversable, palace guard faction, commander quest skeleton, basic shops in neutral zone, **server-side LLM agent drives opposing faction's strategic decisions** (patrol routes, raid scheduling, target selection), **per-IP/per-account rate limits + token budget** | 5–7 wk |
| **P3** | Villain + raid loop | Villain faction, squad command (follow/attack), large-scale raid event on palace, faction-vs-faction AI battles, **server-side LLM expanded to all 3 factions when not player-controlled** | 4–6 wk |
| **P4** | Limb/wound system | Hit-zone targeting, bleed-out timer, eye/leg/hand wounds, prosthetic items, half-screen-black shader, movement state machine (walk → crawl → wheelchair) | 3–4 wk |
| **P5** | v1.0 polish | More enemies, more caravans, day/night, audio pass, settings menu polish, balance, **optional account upgrade (email+passcode → cross-device saves)**, **server-side LLM cost dashboard + per-account token caps**, leaderboard anti-cheat pass | 3–4 wk |

Total: ~7–9 months calendar for a small team (1 client eng + 1 backend eng + part-time art + part-time PM/QA), +1 week vs v2.1 for the backend slice (offset partly by removing client-side key-management work). Compress with more headcount on P2/P3 (parallel zones).

## 5. Tech stack — locked (board sign-off Q3 + Q5)

| Layer | Choice | Why |
|---|---|---|
| **Game client renderer** | **Three.js** (r170+) | Mature, huge ecosystem, full control. `InstancedMesh` is the right tool for dense forest. WebGPU path opens up as it stabilizes. |
| **Game client physics** | **Rapier (WASM)** | Deterministic, fast, MIT, plays well with Three. |
| **Client language** | **TypeScript** | Strict types. Prevents the "what is this object" tax on a 6-month build. |
| **Client bundler** | **Vite** | Sub-second HMR; production build is rollup; no config rabbit-hole. |
| **Client state** | Plain TS classes + ECS-lite via [miniplex](https://github.com/hmans/miniplex) | Avoid over-architecting; we're not Unreal. |
| **Client audio** | Web Audio API direct + Howler.js for sprites | Cheap, works everywhere. |
| **Client save** | localStorage buffer (offline queue + UI prefs only) | Authoritative storage is server-side. |
| **Client assets** | Stylized low-poly, glTF format | Web-friendly; CC0 from [kenney.nl](https://kenney.nl/) and [Quaternius](https://quaternius.com/) as placeholders. **Art direction locked: stylized low-poly** (board sign-off Q2). |
| **🆕 Backend runtime** | **Node 20 + Express + TypeScript** (board sign-off Q5) | Aligns with the existing client TS stack; small surface; standard. `LLMProvider` interface is shared (or mirrored) between client conceptual model and server impl — same shape, server-only execution. |
| **🆕 Backend storage** | **SQLite-on-volume for MVP** → Postgres at scale (P5+ if needed) | Single-file, runs cheap on Fly.io / Render / Railway volumes. Migrate to Postgres only when scale forces it. TBD in detail by TL during decomposition. |
| **🆕 Backend deploy target** | **TBD by Release Engineer during P0** (candidates: Fly.io, Render, Railway) | Small Node service + a persistent volume. CEO/board: prefer a target with a free or cheap tier for the demo phase. |
| **🆕 AI Agent layer** | **Server-side** provider-agnostic `LLMProvider` interface (fetch-based, no SDK lock-in). P1 ships DeepSeek adapter only (board priority `61c8898b`); Anthropic-compatible and OpenAI-compatible adapters are follow-up issues for post-P1. Scripted AI = always-on fallback (now lives both client-side for offline + server-side for provider-error path). | apiKey + provider config are server secrets; client carries no provider knowledge. See §5a, §5b. |
| Client hosting | Static hosting (Vercel / GitHub Pages) — _demo phase exception: client served by Express from the same Fly app (BOO-541, board decision 2026-06-17). One URL, no CORS, same-origin `/api`. Reverts to dedicated static host post-demo if needed._ | Game client is fully client-side; trivial deploy. |
| CI | GitHub Actions: typecheck + bundle-size budget (client) + tests + build (server) | Single workflow covers both packages. |

### 5a. AI-agent layer — server-proxied architecture (v3)

```
┌────────────────────────────────────────────────┐
│  Browser — Game client (Three.js + Rapier)     │
│  ↓ strategic tick (every 5–15 s)               │
│  Strategic state snapshot                      │
│        │                                       │
│        ▼ POST /api/llm/decide                  │
└────────│───────────────────────────────────────┘
         │           HTTPS
         ▼
┌────────────────────────────────────────────────┐
│  korovan backend (Node + Express + TS)         │
│  • Auth: cookie-based anon identity            │
│  • Rate limit + token budget per identity      │
│  • Server-side AI state (faction memory)       │
│  • Sanitize / escape state snapshot            │
│  • Pick LLMProvider (default: DeepSeek)        │
│        │                                       │
│        ▼                                       │
│  ┌──────────────────────────────────────────┐ │
│  │ Provider adapter (server-side):          │ │
│  │  • deepseek (P1)                         │ │
│  │  • anthropic (post-P1)                   │ │
│  │  • openai-compat (post-P1)               │ │
│  └──────────────────────────────────────────┘ │
│        │                                       │
│        ▼ provider HTTPS + server-held apiKey   │
└────────│───────────────────────────────────────┘
         │
         ▼
   ┌────────────────────────┐
   │ DeepSeek / Anthropic / │
   │ OpenAI-compat endpoint │
   └────────────────────────┘
         │
         ▼ structured command
   back through the server, validated, persisted
   to server-side AI state, returned to client
```

**Key design choices:**

1. **Tempo separation.** LLM ticks run on a 5–15 s cadence over strategic state, not per-frame. The client game loop never blocks on a network call. Commands arrive asynchronously into a queue. Same model as v2.1.
2. **Server-side adapters.** The `LLMProvider` interface and all concrete adapters live in the backend. Client only knows `POST /api/llm/decide`. P1 ships the DeepSeek adapter (the MVP/P1 default per board priority `61c8898b`); Anthropic-compatible and OpenAI-compatible adapters are follow-up issues against the same server-side interface.
3. **Secrets server-only.** Provider apiKey lives in process env / hosting secrets store. Never logged. Never returned to the client. Never committed. CSO sign-off required for the rotation procedure.
4. **Structured output.** Prefer the provider's tool-calling / function-calling API for command emission (`emit_command({type: 'patrol', targetZone: 'elf-forest', units: [...]})`). Fallback to a JSON schema prompt + parse-and-validate when the provider doesn't support tools. Validation runs server-side; invalid output triggers scripted-AI fallback instead of being passed to the client.
5. **Two-layer fallback.**
   - **Provider error / timeout (server-side):** server returns a scripted-AI decision instead of failing the client. Client is unaware whether this tick was LLM-driven or scripted-fallback (by design — the only difference is decision quality).
   - **Backend unreachable (client-side):** game continues with the existing client-side scripted AI. Save writes queue locally and sync on reconnect.
6. **Cost guardrails.** Per-identity (cookie) and per-IP token-budget caps enforced server-side. Per-call timeouts (default 20 s). No retry storms. Cost dashboard arrives in P5.
7. **Prompt-injection defense.** Any user-controlled string in the strategic state snapshot (player nickname, custom item name) is escaped / quoted in the server's prompt construction. LLM output is treated as untrusted and validated against the command schema before persistence or return-to-client.

### 5b. Backend architecture (new in v3)

**Endpoints (P1 surface):**

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `GET` | `/healthz` | Liveness probe | none |
| `POST` | `/api/identity/bootstrap` | First-visit: server issues opaque player-id, sets httpOnly cookie, optional nickname | cookie-create |
| `POST` | `/api/llm/decide` | Strategic-state snapshot in, structured command out (LLM-or-fallback) | cookie |
| `POST` | `/api/saves` | Upsert save payload (HP, position, loot, zone state) | cookie |
| `GET` | `/api/saves/me` | Fetch latest save for the cookie identity | cookie |
| `GET` | `/api/leaderboard` | Top-N per zone/faction | none (read) |
| `POST` | `/api/leaderboard` | Submit run result (server validates) | cookie |

**Identity model (MVP — board-confirmable):**

- First visit: client calls `POST /api/identity/bootstrap`; server generates an opaque player-id (UUID), sets it in an httpOnly + Secure + SameSite=Lax cookie, returns optional nickname.
- All subsequent requests carry the cookie. No email, no password, no OAuth.
- Nickname is purely cosmetic (leaderboard display); editable from settings.
- Upgrade path (P5 polish): user opts in to email+passcode link → server attaches it to the same player-id → cross-device login possible.
- **CSO sign-off required** on the cookie security profile (httpOnly, Secure flag in prod, SameSite, lifetime, rotation).

**Storage (MVP):**

- SQLite single-file on the deploy target's persistent volume.
- Tables (initial): `players` (id, nickname, created_at, last_seen, cookie_hash), `saves` (player_id, payload_json, version, updated_at), `leaderboard_entries` (player_id, zone, faction, score, posted_at), `ai_sessions` (player_id, faction, memory_json, updated_at).
- Migration path to Postgres deferred until traffic warrants.

**Server-side AI state:**

- Per (player_id, faction) row stores the LLM agent's recent decisions + faction-level worldview snapshot.
- Server reads → augments prompt → calls provider → writes updated state.
- Bounded size (truncate / summarize on schedule) to keep per-call token cost predictable.

**Secrets:**

- Provider apiKey via env var (`DEEPSEEK_API_KEY` initially) sourced from the hosting platform's secrets manager.
- Local dev: `.env.local` (gitignored).
- No secret in repo. CSO reviews the deploy-target secrets-handling story before P1 ships.

**Deployment:**

- Single Node process behind the hosting platform's HTTPS terminator.
- Persistent volume for the SQLite file.
- Logs: structured JSON, no apiKey, no save payloads in logs.
- Cost: target free / minimal tier during MVP demo phase.

## 6. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Scope is gigantic for a small team | 🔴 High | Brutally narrow MVP (§3). Limb system, shops, LLM strategic decisions, full auth, cross-device sync are explicitly deferred from MVP. |
| Dense forest perf in browser | 🟡 Med | `InstancedMesh` for trees + frustum culling + LOD billboard ↔ mesh swap. Budget: ≤500 visible meshes at LOD, ≤5k billboards. |
| Asset cost (3D models, anims, audio) | 🟡 Med | Start with CC0 (kenney.nl, Quaternius). Hire artist only after P1 proves the loop. |
| Limb system feels gimmicky or unfun | 🟡 Med | Prototype in P4 with a single hit-zone (right hand) before building the full system. Cut if playtests reject it. |
| Save format breaks across versions | 🟢 Low | Versioned schema from day 1; migration helper from P2 onward. Server-side schema migrations gated by `version` field on each save. |
| Browser fragmentation (WebGPU not universal) | 🟢 Low | WebGL fallback. Three handles this transparently. |
| LLM provider latency disrupts game tempo | 🟡 Med | Strategic ticks operate on 5–15 s cadence, never per-frame. Commands arrive async into a queue; game loop never blocks. |
| LLM provider timeout / outage / API change | 🟡 Med | Per-call timeout (20 s default) **server-side**. On error: server returns a scripted-AI decision; client never sees the provider failure. Adapter version pinning in tests. |
| 🆕 **Provider call cost runs away (we now pay)** | 🟠 Med-High | apiKey is server-side now → we eat the bill, not the player. Per-identity + per-IP token caps + daily quota enforced before each call. Cost dashboard in P5. Alarm on monthly spend > threshold. CFO/CEO budget review before P2 (when LLM goes live). |
| 🆕 **Server apiKey leak** | 🟠 Med-High | Env-only secret, never in code, never in logs, never returned to client. CSO sign-off on the rotation procedure. Secrets manager (Fly.io / Render / Railway) is the source. Audit grep in CI for hardcoded `sk-` / DeepSeek-shaped strings. |
| 🆕 **Backend availability (single Node process)** | 🟡 Med | `/healthz` monitored. **Client-side scripted-AI fallback** activates when backend unreachable → game remains playable. Save buffer queued in localStorage and drained on reconnect. P5: optional second-region warm standby. |
| Prompt-injection from in-game text (NPC names, item descriptions, player nickname) into LLM context | 🟡 Med | Server-side sanitizer escapes user-controlled strings before prompt construction. LLM output validated against command schema; malformed → scripted fallback. |
| 🆕 **Identity hijack / save tampering** | 🟡 Med | Server is source of truth for save payload — schema-validated on write. Cookie is httpOnly + Secure + SameSite to resist trivial XSS theft. Leaderboard scores re-derived from server-trusted run metadata, not blindly trusted from client. Anti-cheat pass in P5. |
| 🆕 **Single-device cookie loss** | 🟢 Low | MVP accepts this risk: anonymous identity dies if cookie is cleared. P5 introduces optional email+passcode upgrade to recover identity across devices/sessions. |

(Removed in v3: client-side apiKey-in-localStorage leak risk and the entire client-key handling row — no longer relevant since the browser carries no provider config.)

## 7. Open product decisions — ✅ RESOLVED

| # | Question | Decision | Source |
|---|---|---|---|
| **Q1** | Multiplayer or single-player? | **Single-player + pluggable LLM-agent opponent.** No human-vs-human netcode. The backend is a service tier, not a multiplayer-netcode layer. Opposing faction(s) driven by LLM via external API behind a server-side provider-agnostic interface. DeepSeek = MVP/P1 default and only adapter in P1; Anthropic-compatible and OpenAI-compatible adapters are follow-up issues post-P1. Scripted-AI fallback when LLM errors or backend unreachable. | Board `09bf8df3`; refined `61c8898b`; re-confirmed under v3 backend pivot. |
| **Q2** | Art direction | **Stylized low-poly.** | Board `09bf8df3`. |
| **Q3** | Engine pick (client) | **Three.js + Rapier + Vite + TypeScript.** | Board `09bf8df3`. |
| **Q4** | Caravans: elves only or all factions? | **All three factions** can intercept and rob caravans. | Board `09bf8df3`. |
| **🆕 Q5** | Backend? Persistence? apiKey location? Server-side AI? Leaderboards? | **Yes — Node + Express + TS backend. apiKey server-side (env / secrets). LLM calls proxied via `/api/llm/decide`. Saves move localStorage → `/api/saves`. Server-side AI state. Leaderboards via `/api/leaderboard`.** Identity model = anonymous account (server-issued cookie + nickname); full auth deferred to P5 polish. | Board [BOO-455](paperclip://issues/BOO-455). |

The original `ask_user_questions` interaction (`45a43737`) and its v2.1 refinement (`61c8898b`) are both superseded — Q1's "no backend / no proxying" framing no longer applies. v3 adopts the backend; the LLM-agent and faction-AI design points are preserved.

## 8. Decomposition preview — TL handoff (v3)

The full decomposition is handed to Tech Lead under [BOO-455](paperclip://issues/BOO-455) (a child handoff issue is filed alongside this PLAN.md update). The list below is *guidance for scope*, not the final issue set.

**P0 issues** (pre-production):

- Repo bootstrap (already landed: Vite + TS + ESLint + Prettier + GH Actions CI — preserve).
- Three.js + Rapier integration smoke test (already landed — preserve).
- Art-style mood-board sign-off (already landed — preserve).
- Save-format schema v1 (already landed — extend with server-side wire format).
- Asset pipeline (already landed — preserve).
- 🆕 **Backend bootstrap** — Node 20 + Express + TS skeleton; `/healthz`; lint + tests + CI; secrets-handling spec (env layout, hosting secrets manager); deploy target picked by RE; local-dev `.env.local` template; structured logging shape with apiKey redaction.
- 🆕 **AI-agent provider abstraction spec — server-side edition** — supersede the client-side version. `LLMProvider` interface, command schema, server-side error-fallback semantics (provider error → scripted decision returned by server), prompt-injection sanitizer spec.
- 🆕 **Save / leaderboard / AI-state DB schema spec** — SQLite tables, version field, migration approach.
- 🆕 **Identity model spec** — cookie profile, bootstrap flow, future upgrade path to email+passcode.

**P1 issues** (vertical slice / MVP):

Client (game) — preserve what's already merged or in flight:

- Scene + 3rd-person camera + WASD controls + jump (landed).
- Forest LOD (landed).
- Elf house models + simple terrain (landed).
- Palace soldier scripted AI (landed).
- Melee combat + HP + death (landed).
- Caravan path + intercept + loot (landed).
- Loot inventory (landed).
- Main menu + HUD (landed).
- Audio integration (landed).

Client refactor (driven by v3):

- 🆕 **Remove apiKey input from settings UI** — supersedes BOO-391 settings UI scope. Settings now: nickname + audio + key bindings.
- 🆕 **Replace localStorage save with `POST /api/saves`** — keep localStorage as offline buffer, sync on reconnect. Supersedes BOO-393 in its localStorage-only form.
- 🆕 **Replace any browser-direct LLM call with `POST /api/llm/decide`** — supersedes the client-side AI-agent client + BOO-394 client-resident DeepSeek adapter.
- 🆕 **Leaderboard panel in main menu** — read + post.
- 🆕 **Cookie-based identity bootstrap** — first-visit call, nickname capture.

Backend (new):

- 🆕 `/healthz`.
- 🆕 `POST /api/identity/bootstrap` + cookie issuance.
- 🆕 `POST /api/llm/decide` — strategic state in, structured command out; with server-side scripted-AI fallback when provider errors.
- 🆕 **Server-side `LLMProvider` interface + DeepSeek adapter (P1 only adapter).**
- 🆕 **Server-side AI state** — read/augment/write per (player_id, faction).
- 🆕 **Prompt-injection sanitizer** — escapes user-controlled strings before prompt construction.
- 🆕 `POST /api/saves` + `GET /api/saves/me`.
- 🆕 `GET /api/leaderboard` + `POST /api/leaderboard` (server validates score).
- 🆕 **Rate-limit middleware** — per-identity + per-IP, daily token budget hooks (caps land in P2).
- 🆕 **Secrets handling** — env loading, secret-redaction in logs, CSO sign-off.

Post-P1 (follow-ups, slot into P2):

- 🆕 **Anthropic adapter (server-side).** — Supersedes BOO-396 in its client-resident form.
- 🆕 **OpenAI-compatible adapter (server-side).** — Supersedes BOO-397 in its client-resident form.

**P2–P5 issues** filed at the start of each phase. P2 headlines server-side LLM-go-live (full strategic surface) and per-account/per-IP rate limits + token budget enforcement. P5 adds optional account upgrade for cross-device saves, LLM cost dashboard, and leaderboard anti-cheat.

## 9. Non-goals (explicitly out)

- **Mobile-first.** Desktop browser is the launch target. Mobile support is post-v1.0.
- **VR.** Out forever (different game entirely).
- **Monetization.** Not in scope of this plan. Free-to-play demo; monetization is a CEO-level decision after v1.0 traction signal.
- **Procedural world generation.** All 4 zones are hand-authored.
- **Modding API.** Post-v1.0.
- **Story / voice acting.** Lightweight text-only quest UI; no VO until budget exists.
- **Human-vs-human multiplayer / netcode.** Single-player only. The backend is a service tier (LLM proxy + saves + leaderboards + AI state), **not** a multiplayer-netcode layer.
- **Self-hosted LLM inference.** We proxy to managed providers (DeepSeek first); we don't host inference ourselves.
- 🆕 **Full auth (OAuth / email+password) in MVP.** Anonymous cookie identity is sufficient for P1; optional email+passcode upgrade lands in P5 polish.
- 🆕 **Cross-device save sync in MVP.** Single-device cookie identity; cross-device requires the P5 email+passcode upgrade path.
- 🆕 **Player-supplied LLM credentials.** Reversed in v3 — provider apiKey is operator-side. Players cannot bring their own keys (yet — may revisit in v1.0+ as a power-user option).

(Removed in v3: "no backend" and "no proxying user LLM calls" are no longer non-goals — they are now the architecture, per board decision [BOO-455](paperclip://issues/BOO-455).)

---

## 10. v3 delta vs v2.1

Architecture pivot driven by board decision [BOO-455](paperclip://issues/BOO-455). Game client preserved verbatim; backend added.

1. **Backend added.** Node 20 + Express + TS, sibling to the existing client TS package. New tech-stack rows in §5. New §5b section detailing endpoints, identity, storage, secrets, deploy.
2. **apiKey moves browser → server.** Provider credentials live in env / hosting secrets manager. Browser carries no provider config. All client-side key-handling work (split-key localStorage pattern, settings-UI key disclosure, etc.) is superseded.
3. **LLM calls proxied.** Client calls `POST /api/llm/decide` with a strategic-state snapshot; server runs the adapter and returns a validated command. Server-side fallback to scripted-AI when provider errors.
4. **Persistence pivots to server.** `POST /api/saves` + `GET /api/saves/me`. localStorage retained only for UI prefs + offline save buffer that syncs on reconnect.
5. **Server-side AI state added.** Per (player_id, faction) memory, read/augment/write on each tick. Bounded size.
6. **Leaderboards added (board).** `GET`/`POST /api/leaderboard`. Per-zone / per-faction.
7. **Identity model.** Anonymous: server-issued opaque player-id via httpOnly+Secure+SameSite cookie + optional nickname. Full auth deferred to P5 polish. Cross-device sync requires opt-in email+passcode upgrade.
8. **§2 pillars.** Pluggable LLM-agent row rewritten for server-proxy model. Persistence row rewritten for server. New leaderboard row.
9. **§3 MVP scope.** Settings UI scope drops apiKey; adds nickname + leaderboard panel + cookie identity bootstrap. AI-agent scaffold + DeepSeek adapter relocate to server. Save endpoint replaces localStorage save. Two new success criteria (#5 server round-trip; #7 cross-machine leaderboard visibility).
10. **§4 roadmap.** P0 adds backend bootstrap + identity spec + DB schema spec. P1 adds the backend endpoints + client refactor for the new wire. P2 adds rate-limit + budget enforcement. P5 adds optional account upgrade + cost dashboard + leaderboard anti-cheat.
11. **§5 tech stack.** Three new rows: backend runtime (Node + Express + TS), backend storage (SQLite-on-volume MVP), backend deploy target (TBD by RE; Fly.io / Render / Railway shortlist). Save row rewritten. Hosting row split (client static; server hosted).
12. **§5a architecture diagram redrawn** for the server-proxy model. Six design choices rewritten; two-layer fallback (provider error server-side, backend unreachable client-side) made explicit. Prompt-injection defense made a first-class design choice.
13. **§5b backend architecture** added (endpoints, identity, storage, AI state, secrets, deploy).
14. **§6 risks.** Removed: client-side apiKey leak. Added: server apiKey leak, provider call cost runaway (we pay), backend availability, identity hijack / save tampering, single-device cookie loss. Existing rows tightened.
15. **§7.** Q5 added with board decision; Q1 re-confirmed with v3 framing.
16. **§8 decomposition preview** rewritten to call out the backend slice (P0 bootstrap, P1 endpoint surface, post-P1 Anthropic + OpenAI-compat as server-side). Existing client work explicitly preserved.
17. **§9 non-goals.** Removed: "no backend", "no proxying user LLM calls". Added: full auth in MVP, cross-device save sync in MVP, player-supplied LLM credentials.
18. **Game client preserved.** Three.js + Rapier engine, physics, player controller, camera, forest LOD, houses/terrain, combat/HP, caravan/loot, audio, HUD, menus, art direction, assets — **no changes**.

## 10a. v2.1 delta vs v2

Refinement-only patch from board comment `61c8898b`:

1. **Provider priority locked.** DeepSeek = MVP/P1 default and *only* adapter in P1. Anthropic-compatible and OpenAI-compatible become follow-up issues, slotted post-P1 via the same `LLMProvider` interface.
2. **§2 pillar row** rewritten to call out DeepSeek-first rollout.
3. **§3 MVP scope:** settings UI exposes DeepSeek-only fields in P1; provider-picker dropdown stubbed but disabled until adapter #2 lands. AI-agent client scaffold ships with one concrete adapter (DeepSeek).
4. **§5 tech stack** AI Agent layer row updated.
5. **§5a design choice #2** rewritten to spell out DeepSeek-first rollout sequencing.
6. **§7 Q1** answer enriched with provider priority.
7. **§8 decomposition preview:** AI-agent client work split into three rows — interface scaffold, DeepSeek adapter (P1 first task), provider settings UI — plus two filed-but-deferred follow-up rows for Anthropic and OpenAI-compat adapters.
8. **TL handoff (BOO-375)** description updated to match.
9. No changes to: risk register (§6 still covers all three providers structurally), non-goals (§9), MVP success criteria (§3) — DeepSeek's "ping" satisfies criterion 5 unchanged.

## 10b. v2 delta vs v1

What changed since the original draft:

1. **Q1–Q4 locked** (§7). Q2/Q3/Q4 accepted as recommended; Q1 evolved from "scripted single-player" → "single-player + pluggable LLM-agent opponent with scripted fallback".
2. **New product pillar:** §2 row "Pluggable LLM-agent opponent".
3. **New §5a:** AI-agent layer architecture with diagram + 6 design choices.
4. **Tech stack table:** new row "AI Agent layer" in §5.
5. **MVP scope updated** (§3): scripted AI baseline + AI-agent client *scaffold* and settings UI ship in MVP. *Strategic decisions* driven by LLM land in P2 where the strategic surface exists.
6. **Roadmap updated** (§4): P2 explicitly headlines "LLM agent goes live"; P5 adds cost dashboard. Calendar +1 wk overall.
7. **Risk register +5 rows** (§6): LLM latency, timeouts/outages, cost/rate limits, key leakage, prompt-injection from in-game text.
8. **Non-goals +2** (§9): no human-vs-human netcode, no proxying user LLM calls.
9. **Decomposition preview** (§8) updated to flag the two AI-agent issues in P0 (spec) and P1 (scaffold + settings UI).

---

*Revision history*

- **v3 (2026-06-15)** — Architecture pivot. Board adds backend ([BOO-455](paperclip://issues/BOO-455)). apiKey moves browser → server, LLM calls proxied, saves move localStorage → server, server-side AI state, leaderboards added. New §5b. Client-side key-handling saga superseded (BOO-403, 411, 412, 449 cancelled as moot; BOO-405/407/417/436 rescoped to server-side under TL/CSO; BOO-409 historical; BOO-390/391/393/394/396/397 re-decomposed under TL handoff). Game client preserved verbatim.
- **v2.1 (2026-06-14)** — Board refinement on provider priority (`61c8898b`). DeepSeek = MVP/P1 default and only adapter in P1; Anthropic + OpenAI-compat become follow-up issues. §2, §3, §5, §5a, §7, §8, §10 updated. TL handoff (BOO-375) description synced.
- **v2 (2026-06-14)** — Board sign-off Q1–Q4. New product pillar: pluggable LLM-agent opponent. Architecture in §5a. Risk register, MVP, roadmap, decomposition preview updated accordingly. Handed off to TL.
- **v1 (2026-06-14)** — Initial draft. Awaiting board sign-off on Q1–Q4 (§7).
