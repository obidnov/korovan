# korovan — Product plan

**Revision:** v3.1 (2026-06-17)
**Author:** CEO
**Status:** **P1 (vertical slice / MVP) shipped to prod** — https://korovan.fly.dev (client + API, identity, saves, leaderboard, LLM-proxy wire + DeepSeek + scripted fallback). Post-deploy polish (BOO-543 nickname endpoint, BOO-546 settings CSS, BOO-540 GIT_SHA) merged. **Phase 2 kicked off by board** in [BOO-547](paperclip://issues/BOO-547) (2026-06-17): all 4 zones traversable, palace-guard faction, commander-quest skeleton, neutral-zone shops, **server-side LLM-agent actually drives enemy strategy on DeepSeek only**, per-IP/per-account rate-limit + token-budget caps go-live. **Anthropic + OpenAI-compatible adapters ([BOO-490](paperclip://issues/BOO-490), [BOO-491](paperclip://issues/BOO-491)) explicitly OUT of P2** — they stay backlog/low until a future board decision, on the same `LLMProvider` interface. See §4 P2 row, §8 P2 decomposition guidance, §10c P2 delta, §11 budget gate.
**Source brief:** [BOO-374](paperclip://issues/BOO-374) — Kirill's original wishlist, preserved verbatim in §1.
**Architecture pivot:** [BOO-455](paperclip://issues/BOO-455) — board decision (2026-06-15).
**Phase 2 kickoff:** [BOO-547](paperclip://issues/BOO-547) — board decision (2026-06-17).

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
| **P2** | Map + 2nd faction + **LLM agent goes live (DeepSeek only)** | All 4 zones traversable (neutral / palace / villain mountain — currently only elf zone), palace-guard faction (2nd playable + opposing), commander-quest skeleton, basic shops in neutral zone, **server-side LLM agent actually drives palace-guard strategic decisions on DeepSeek only** (patrol routes, raid scheduling, target selection) — scripted-AI stays always-on fallback, **per-IP + per-account rate-limit caps + daily token-budget caps switched from "hooks only" (P1 BOO-482) to enforced**. Anthropic + OpenAI-compatible adapters ([BOO-490](paperclip://issues/BOO-490), [BOO-491](paperclip://issues/BOO-491)) **explicitly out of P2** — stay backlog/low. Budget gate (§11) gates LLM-go-live. | 5–7 wk |
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

### 8a. Phase 2 decomposition guidance (TL handoff, board kickoff 2026-06-17)

Handed to Tech Lead under a dedicated P2 EPIC (filed alongside this v3.1 PLAN update; see [BOO-547](paperclip://issues/BOO-547) for the board mandate). The list below is **scope guidance for TL decomposition**, not the final issue set. TL owns the final breakdown; CEO owns scope acceptance + budget gate.

**P2 client (game) work** — preserve P1 vertical slice, extend the world:

- 🆕 **Neutral-zone terrain + transitions** — human trade hub, traversable from elf forest. Includes overworld transition mechanics if used.
- 🆕 **Palace zone terrain + emperor's palace exterior** — second zone with palace landmark.
- 🆕 **Villain mountain zone + old fort** — third new zone, mountainous biome with the fort structure.
- 🆕 **Palace-guard playable faction** — selectable faction in main menu; faction-specific spawn point, starting gear, faction-tinted UI. Asymmetric goals per §2 pillar #1.
- 🆕 **Palace-guard NPC variants for elf-faction encounters** — replaces / extends current "palace soldier patrol" enemy. Hostile to elves, friendly to palace player.
- 🆕 **Commander-quest skeleton** — minimal quest UI surface: quest list, accept/decline, complete state. One scripted "report to commander" quest end-to-end on the palace path.
- 🆕 **Neutral-zone shops (basic)** — at least one shop NPC in human-zone trade hub; buy/sell loot for currency; one usable consumable + one weapon swap. Daggerfall-lite per §2 pillar.

**P2 backend (game-impacting) work** — activate LLM strategic drive on DeepSeek; turn on enforcement:

- 🆕 **Activate `POST /api/llm/decide` in actual gameplay** — wire from P1 ([BOO-487](paperclip://issues/BOO-487)) currently stubbed at game-loop level. P2: server response is consumed by enemy-faction strategy on the 5–15 s strategic tick. Patrol routes, raid scheduling, target selection are LLM-driven for the opposing faction (palace guard when player = elves; elves when player = palace).
- 🆕 **DeepSeek-adapter production hardening** — the P1 adapter is a "ping works" wire. P2 requires: real strategic-prompt construction (per §5a design choice #4), command-schema validation (tool-calling preferred, JSON-schema fallback), structured logging without secret/payload leaks, retry policy without storms, server-side scripted-AI fallback on provider error (per §5a fallback two-layer model).
- 🆕 **Server-side AI state expansion** — P1 ships an empty/minimal `ai_sessions` row. P2 implements: write recent decisions + faction worldview after each tick, bounded-size truncate/summarize policy, per-(player_id, faction) read on next tick. Token cost predictable across calls.
- 🆕 **Rate-limit enforcement (real caps)** — P1 [BOO-482](paperclip://issues/BOO-482) shipped middleware hooks with no caps wired. P2 switches caps **on**: per-identity request RPM + per-IP RPM + daily token-budget per-identity. Caps live in env config; defaults set conservatively before LLM go-live; CSO sign-off on the cap profile.
- 🆕 **Daily token-budget enforcement + spend telemetry** — counters per-(identity, day) for total tokens consumed; reject requests that would exceed daily cap with a 429 + "scripted-AI fallback" hint so client continues gracefully. Minimal telemetry surface (count + cost-estimate logged daily) — full cost dashboard remains P5.
- 🆕 **Prompt-injection sanitizer enforcement** — P1 [BOO-468](paperclip://issues/BOO-468) shipped the spec. P2: sanitizer wired into every prompt construction path; player-controlled strings (nickname, item names) escaped/quoted; LLM output validated against command schema before persistence or return-to-client.

**P2 ops + governance:**

- 🆕 **CSO sign-off on LLM go-live profile** — rate-limit caps, token-budget caps, secret-rotation procedure already in place from P1 (BOO-455 era), but **LLM-go-live triggers a fresh CSO review** of the live cap profile because P2 turns enforcement on for the first time. Security routing per `_security_routing.md` §1 — any P2 sub-issue touching auth / payments / rate-limits / external-API / secrets must carry the appropriate trigger label so [STEP 4.5](../boomstream-paperclip/team/_pre_in_review_check.md) auto-routes to CSO.
- 🆕 **Budget gate (CFO/CEO)** — see §11. **Blocking gate** before any sub-issue that turns on real provider traffic at scale.

**Explicit non-scope for P2:**

- ❌ **Anthropic adapter ([BOO-490](paperclip://issues/BOO-490))** — stays backlog/low. Will land later on the same server-side `LLMProvider` interface, by separate board decision.
- ❌ **OpenAI-compatible adapter ([BOO-491](paperclip://issues/BOO-491))** — stays backlog/low. Same rationale.
- ❌ Villain faction (P3 headline) — explicitly deferred per §4.
- ❌ Limb / wound system (P4 headline) — explicitly deferred per §4.
- ❌ Email+passcode account upgrade, full LLM cost dashboard, leaderboard anti-cheat (P5 polish) — explicitly deferred per §4.
- ❌ Self-hosted LLM inference, mobile-first, VR, modding API — permanent non-goals per §9.

**Sequencing recommendation (non-binding for TL):**

1. **Wave A — terrain + factions** (parallel-safe): 4-zone terrain, palace-guard faction selectable, palace-guard NPC variant. Client-heavy, no LLM dependency.
2. **Wave B — backend LLM-go-live**: gated on §11 budget gate accept. DeepSeek-adapter hardening → server-side AI state expansion → activate `/api/llm/decide` in real game tick. Sequenced; each depends on the prior.
3. **Wave C — enforcement + governance**: rate-limit caps on, token-budget enforcement on, sanitizer enforcement, CSO sign-off. Can begin in parallel with late Wave B.
4. **Wave D — commander quest + shops**: lower-priority content; can fill gaps while A/B/C land.

TL has full authority to re-sequence based on capacity and dependency graph. Decomposition idempotency rules (rule #12 in `team/_overview.md`) apply at filing time.

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

## 10c. v3.1 delta vs v3

Board-driven update on Phase 2 kickoff ([BOO-547](paperclip://issues/BOO-547), 2026-06-17). No architecture change vs v3; P1 closed + P2 scope locked + P2 decomposition guidance + budget gate added.

1. **Header status rewritten.** v3 said "Architecture pivot in progress, handed to TL". v3.1 says "P1 shipped to prod, P2 kicked off by board". Post-deploy polish hotfixes ([BOO-543](paperclip://issues/BOO-543) nickname endpoint, [BOO-546](paperclip://issues/BOO-546) settings CSS, [BOO-540](paperclip://issues/BOO-540) GIT_SHA) called out as merged and non-blocking.
2. **§4 P2 row** rewritten with the concrete board-locked P2 scope. Headline changes: 4 zones + palace-guard faction + commander-quest skeleton + neutral-zone shops + **LLM-go-live on DeepSeek only** + rate-limit/budget caps switched from "hooks-only" to enforced. BOO-490 / BOO-491 called out as explicitly out of P2.
3. **§8 expanded** with new §8a "Phase 2 decomposition guidance" — TL handoff scope by area (client / backend / ops), explicit non-scope list, non-binding sequencing wave recommendation (A: terrain+factions, B: LLM-go-live gated on budget, C: enforcement+governance, D: commander+shops).
4. **§11 budget gate added.** CFO/CEO budget review precondition before any sub-issue turns on real DeepSeek traffic at scale. Token-budget caps, daily spend ceiling, alarm threshold encoded.
5. **No changes to: §1 brief, §2 pillars, §3 MVP definition (P1 ship snapshot), §5 tech stack, §5a/§5b architecture, §6 risk register, §7 product decisions, §9 non-goals, §10/§10a/§10b history.**

---

## 11. P2 budget gate (CFO/CEO blocking gate on LLM-go-live)

**Decision context.** Provider apiKey lives server-side now (§5b, §6 risk row "provider call cost runs away"). With LLM strategically driving the opposing faction every 5–15 s per active player session, real provider spend is no longer hypothetical. The board added a CFO/CEO budget review as a precondition before any P2 sub-issue turns on real DeepSeek traffic at scale (per [BOO-547](paperclip://issues/BOO-547) §"Задачи CEO" #4).

**Gate semantics.** Wave B (backend LLM-go-live) and Wave C (enforcement + governance) sub-issues that turn DeepSeek calls on for live gameplay are **blocked** until this gate is accepted. Wave A (terrain + factions) and Wave D (commander quest + shops) are unblocked and can proceed in parallel.

**Gate inputs (CEO/CFO accept these before sign-off):**

1. **Per-identity request RPM cap** — default proposal: 12 requests/minute per cookie-identity (= one strategic tick every 5 s, the upper end of §5a tempo separation). TL can revise based on real game-loop tempo.
2. **Per-IP request RPM cap** — default proposal: 30/min (anti-abuse + multi-account-per-IP allowance).
3. **Daily token-budget per-identity** — default proposal: 50k tokens/day/identity. Reject 429 + scripted-AI fallback hint past cap.
4. **Daily token-budget global ceiling (cluster-wide)** — default proposal: 5M tokens/day across all identities. Hard stop on the whole `/api/llm/decide` endpoint past ceiling (server returns scripted-AI for every request); CEO paged.
5. **Estimated monthly spend at default caps + p50 / p95 active-player projections** — TL/RE provides a back-of-envelope. CFO/CEO accepts the worst case.
6. **Alarm threshold** — monthly spend ≥ $X triggers a CEO page + spend dashboard freeze. Default $X = TBD per CFO/CEO review.
7. **Kill-switch** — env-var toggle `LLM_PROXY_ENABLED=false` that forces every `/api/llm/decide` call into scripted-AI fallback within one deploy cycle. Already partially in place from P1 server-side fallback; P2 makes it a first-class env toggle.

**Gate outputs (after CFO/CEO accept):**

- Accepted caps written into env config + runbook.
- TL unblocks Wave B / Wave C sub-issues that carry the `budget-gate-cleared` reference.
- CSO sign-off on the cap profile recorded (per `_security_routing.md` §1 + [STEP 4.5](../boomstream-paperclip/team/_pre_in_review_check.md) auto-routing).
- Spend telemetry (counter + per-day rollup) ships **before** Wave B can be merged (so we see cost from the first live tick, not after).

**Out of scope for this gate** (deferred to P5 polish per §4):

- Full cost dashboard (Grafana / metabase view).
- Per-account billing / monetization.
- Anthropic / OpenAI-compat adapter pricing modeling — those providers stay backlog/low ([BOO-490](paperclip://issues/BOO-490), [BOO-491](paperclip://issues/BOO-491)).

**Gate disposition.** Tracked on the P2 EPIC filed alongside this PLAN update (TL handoff under [BOO-547](paperclip://issues/BOO-547)). CEO files the gate as a sub-issue / interaction with explicit cap proposals; CFO accept (board interaction) is the unblock signal.

**§11a. Wave B IP-cap rollout rule ([BOO-567](paperclip://issues/BOO-567), CSO sign-off note 1 on [BOO-566](paperclip://issues/BOO-566)).** The 30 RPM per-IP cap (gate input #2) trips at the lower bound of a 2–3-tenant NAT household once strategic ticks are sustained (per-identity 12 RPM × 3 sessions = 36 RPM peak). UX is not broken (game falls back to scripted-AI), but a noticeable 429 floor on shared-NAT IPs degrades strategic-AI quality for benign users and adds noise to abuse telemetry. Wave B rollout therefore watches the **benign-429 rate** and ships an IP-cap raise as a deploy-time env flip if it crosses the threshold:

- **Telemetry surface.** Every 429 from `POST /api/llm/decide` emits a `rate_limit.429` structured log line with `trigger: 'ip' | 'identity'`, `method`, `path`, `ip`, `playerId` (when present), and `limit` (`server/src/middleware/rateLimit.ts`). Per-hour rollup happens in log analysis downstream (Fly.io logs / external aggregator); no new ingest dependency on the API server.
- **Decision rule.** If `count(trigger=ip 429s NOT preceded by a trigger=identity 429 on the same playerId in the same 1 h window) / count(POST /api/llm/decide calls in the same 1 h window) > 2 %` in any 1 h window during Wave B rollout, raise the per-IP cap from 30 → 40-50 RPM. Abuse-economics bounded: 50 RPM ≈ $0.07/h upper-bound DeepSeek spend per IP, well below the per-identity + daily-ceiling load-bearing limits.
- **Config-driven cap.** The cap is read at module load from env var `LLM_DECIDE_IP_RPM` (and `LLM_DECIDE_IDENTITY_RPM` for symmetry) by `resolveEnvCap()` in `rateLimit.ts`. Default falls through to the value baked into `ENDPOINT_PROFILES`. NaN, ≤0, and empty values silently fall back to the default. Operator raises the cap by setting `LLM_DECIDE_IP_RPM=45` (or whatever value the decision rule picks) and redeploying — **no code change required**.
- **Scope guard.** This is IP-cap only. The per-identity 12 RPM cap is out of scope for this rule (separate analysis; load-bearing for abuse defense).

---

*Revision history*

- **v3.1.1 (2026-06-17)** — §11a added ([BOO-567](paperclip://issues/BOO-567), CSO sign-off note 1 follow-up on [BOO-566](paperclip://issues/BOO-566)). Wave B IP-cap rollout rule: benign-429 telemetry surface, 2 % threshold for raising `LLM_DECIDE_IP_RPM` (30 → 40-50), env-var config-driven cap via `resolveEnvCap()` so the raise ships without a code change.
- **v3.1 (2026-06-17)** — P1 closed, P2 kicked off by board ([BOO-547](paperclip://issues/BOO-547)). Header status rewritten. §4 P2 row rewritten with concrete board-locked P2 scope. §8 expanded with new §8a "Phase 2 decomposition guidance" (client/backend/ops scope + non-scope + non-binding sequencing waves). §10c added documenting v3.1 delta. **§11 added — P2 budget gate (CFO/CEO blocking gate on LLM-go-live).** [BOO-490](paperclip://issues/BOO-490) / [BOO-491](paperclip://issues/BOO-491) explicitly out of P2.
- **v3 (2026-06-15)** — Architecture pivot. Board adds backend ([BOO-455](paperclip://issues/BOO-455)). apiKey moves browser → server, LLM calls proxied, saves move localStorage → server, server-side AI state, leaderboards added. New §5b. Client-side key-handling saga superseded (BOO-403, 411, 412, 449 cancelled as moot; BOO-405/407/417/436 rescoped to server-side under TL/CSO; BOO-409 historical; BOO-390/391/393/394/396/397 re-decomposed under TL handoff). Game client preserved verbatim.
- **v2.1 (2026-06-14)** — Board refinement on provider priority (`61c8898b`). DeepSeek = MVP/P1 default and only adapter in P1; Anthropic + OpenAI-compat become follow-up issues. §2, §3, §5, §5a, §7, §8, §10 updated. TL handoff (BOO-375) description synced.
- **v2 (2026-06-14)** — Board sign-off Q1–Q4. New product pillar: pluggable LLM-agent opponent. Architecture in §5a. Risk register, MVP, roadmap, decomposition preview updated accordingly. Handed off to TL.
- **v1 (2026-06-14)** — Initial draft. Awaiting board sign-off on Q1–Q4 (§7).
