# korovan — Product plan

**Revision:** v2.1 (2026-06-14)
**Author:** CEO
**Status:** Board-approved on Q1–Q4 (2026-06-14, comment `09bf8df3`); refined by board comment `61c8898b` on Q1 provider priority (DeepSeek first). Handed off to Tech Lead for P0+P1 engineering decomposition. See §7 for locked answers and §10 for the v2 + v2.1 deltas.
**Source brief:** [BOO-374](paperclip://issues/BOO-374) — Kirill's original wishlist, preserved verbatim in §1.

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
| **🆕 Pluggable LLM-agent opponent** | The opposing faction is commanded by an LLM agent via external API. Provider-agnostic architecture with **DeepSeek as the default and only provider that ships in P1** (board priority `61c8898b`); Anthropic-compatible and OpenAI-compatible adapters land in later phases via the same `LLMProvider` interface. Player configures provider + base URL + model + API key in-game settings (stored locally, never hard-coded). Fallback scripted AI runs when no agent is configured or the provider is unreachable, so the game is always playable offline. |
| **Persistence** | Save game. (MVP: localStorage. v1.0: optional cloud save.) |
| **Web-native** | No install. Runs in modern browsers via WebGL/WebGPU. |

## 3. MVP definition (what ships first)

**Goal of MVP:** prove the core loop is fun and the tech stack scales, on the smallest possible content footprint. Ship the AI-agent integration *infrastructure* so it can be activated for strategic decisions as soon as the strategic surface exists in P2.

**MVP scope (single playable faction, single zone, vertical slice):**

- Faction: **Forest elves only**
- Zone: **Elf forest only** (1 of 4)
- Movement: WASD + space (jump) + 3rd-person camera
- Combat: melee swing (1 weapon), HP, hit/death
- Enemies: 1 type (palace soldier patrol). **Scripted AI** drives moment-to-moment behavior (idle → chase → attack → die). This always runs offline.
- World: dense forest with LOD (billboard ↔ 3D mesh swap), wooden elf houses (3 static models), simple ground
- Signature mechanic: **1 caravan route** — a cart with loot patrols a fixed path, player can intercept and grab loot
- 🆕 **AI-agent provider settings UI** — for MVP/P1 the only provider option is **DeepSeek**; UI exposes base URL + model + API key fields + "test connection" button. Provider-picker dropdown lands when the second adapter ships (post-P1). Persisted to localStorage. *No game-impacting calls yet in MVP* — this is the scaffold so P2 can activate strategic decisions.
- 🆕 **AI-agent client scaffold** — provider-agnostic `LLMProvider` interface with a **single concrete implementation in P1: DeepSeek adapter**. Wired up but only used to validate the connection in MVP. Real strategic decisions land in P2 alongside faction command surface. Anthropic and OpenAI-compatible adapters ship as follow-up issues, slotted alongside P2.
- Persistence: save HP / position / loot / provider settings to localStorage
- UI: HP bar, loot counter, save/load buttons, main menu, **provider settings panel**
- Audio: footsteps, sword swing, hit, ambient forest loop (4 sounds total)

**Out of MVP** (deferred to later phases): other factions, other zones, limb system, shops/economy, commander AI, faction raids, day/night cycle, multiplayer, settings menu, **LLM-driven strategic decisions** (infrastructure ships in MVP, *driving* moves to P2).

**MVP success criteria:**
1. Loads in <10 s on modern desktop browser (cold cache).
2. Holds 60 fps on mid-range hardware (M1 / iGPU laptop) with ~500 visible trees at LOD.
3. Player can complete a caravan robbery loop end-to-end (find → engage guards → loot → return to safe spot → save) in <5 minutes.
4. Demo-able to Kirill in a single tab, no install.
5. 🆕 Provider settings UI accepts user-supplied OpenAI-compatible credentials and successfully runs a single round-trip "ping" through the AI-agent client.

## 4. Phased roadmap

| Phase | Theme | Headline deliverables | Rough effort |
|---|---|---|---|
| **P0** | Pre-production | Engine pick locked, art direction locked, asset pipeline, repo bootstrap, CI, save-format spec, **AI-agent provider abstraction spec** | 1–2 wk |
| **P1** | Vertical slice (= MVP, §3) | Elf zone playable end-to-end, 1 caravan, 1 enemy, save/load, **AI-agent client scaffold + settings UI + provider ping** | 4–6 wk |
| **P2** | Map + 2nd faction + 🆕 **LLM agent goes live** | All 4 zones traversable, palace guard faction, commander quest skeleton, basic shops in neutral zone, **LLM agent drives opposing faction's strategic decisions** (patrol routes, raid scheduling, target selection) | 5–7 wk |
| **P3** | Villain + raid loop | Villain faction, squad command (follow/attack), large-scale raid event on palace, faction-vs-faction AI battles, **LLM expanded to all 3 factions when not player-controlled** | 4–6 wk |
| **P4** | Limb/wound system | Hit-zone targeting, bleed-out timer, eye/leg/hand wounds, prosthetic items, half-screen-black shader, movement state machine (walk → crawl → wheelchair) | 3–4 wk |
| **P5** | v1.0 polish | More enemies, more caravans, day/night, audio pass, settings menu, balance, cloud save (optional), **LLM cost dashboard** | 3–4 wk |

Total: ~6–8 months calendar for a small team (1 eng + part-time art + part-time PM/QA), +1 week vs v1 for the AI-agent layer. Compress with more headcount on P2/P3 (parallel zones).

## 5. Tech stack — locked (board sign-off Q3, see §7)

| Layer | Choice | Why |
|---|---|---|
| Renderer | **Three.js** (r170+) | Mature, huge ecosystem, full control. `InstancedMesh` is the right tool for dense forest. WebGPU path opens up as it stabilizes. |
| Physics | **Rapier (WASM)** | Deterministic, fast, MIT, plays well with Three. |
| Language | **TypeScript** | Strict types. Prevents the "what is this object" tax on a 6-month build. |
| Bundler | **Vite** | Sub-second HMR; production build is rollup; no config rabbit-hole. |
| State | Plain TS classes + ECS-lite via [miniplex](https://github.com/hmans/miniplex) | Avoid over-architecting; we're not Unreal. |
| Audio | Web Audio API direct + Howler.js for sprites | Cheap, works everywhere. |
| Save | localStorage (P1) → IndexedDB via `idb` (P2+) → optional cloud (P5) | Incremental. |
| Assets | Stylized low-poly, glTF format | Web-friendly; CC0 from [kenney.nl](https://kenney.nl/) and [Quaternius](https://quaternius.com/) as placeholders. **Art direction locked: stylized low-poly** (board sign-off Q2). |
| 🆕 **AI Agent layer** | Provider-agnostic `LLMProvider` interface (fetch-based, no SDK lock-in). **P1 ships DeepSeek adapter only** (board priority `61c8898b`); Anthropic-compatible and OpenAI-compatible adapters are filed as follow-up issues for post-P1. Structured tool-calling preferred; JSON-schema fallback. **Scripted AI** is the always-on fallback. | Provider-agnostic per board direction. Settings (base URL, model, key) live in localStorage. See §5a. |
| Hosting | Static hosting (Vercel / GitHub Pages) | Game is fully client-side; trivial deploy. **No backend** (Q1 sign-off — no human-vs-human netcode). |
| CI | GitHub Actions: typecheck + bundle-size budget check | Don't ship a 50 MB tab. |

### 5a. AI-agent layer — architecture (new in v2)

```
┌────────────────────────────────────────────────┐
│  Game world (Three.js + Rapier + ECS)          │
│  ↓ tick (e.g. every 5–15s, not per frame)      │
│  Strategic state snapshot ────► Serializer    │
│                                       ↓        │
│                              ┌────────────────┐│
│  Faction command queue ◄──── │ AgentRouter    ││
│                              │  • Provider    ││
│                              │    chosen by   ││
│                              │    settings    ││
│                              │  • Falls back  ││
│                              │    to scripted ││
│                              │    on error/   ││
│                              │    no config   ││
│                              └────────────────┘│
└────────────────────────────────────────────────┘
                  │
                  ▼ HTTPS
        ┌──────────────────────┐
        │ Provider adapter:    │
        │  • openai-compat     │
        │  • deepseek          │
        │  • anthropic         │
        └──────────────────────┘
```

**Key design choices:**
1. **Tempo separation.** LLM ticks are slow (5–15 s) and operate on strategic state, not per-frame. Game loop never blocks on a network call. Commands arrive asynchronously into a queue.
2. **Provider-agnostic interface, DeepSeek-first rollout.** Concrete shape: `interface LLMProvider { complete(messages, tools?): Promise<Response>; }`. Adapters translate to/from each provider's HTTP wire format. **P1 ships the DeepSeek adapter only** (board priority `61c8898b` — it is the MVP default). Anthropic-compatible and OpenAI-compatible adapters are filed as follow-up issues against the same interface and slot into the codebase without re-architecting. Many providers (incl. local Ollama, DeepSeek's REST) speak OpenAI-compat natively, so that adapter doubles as a generic "bring your own endpoint" path later.
3. **Settings persistence.** Provider id, base URL, model, API key live in localStorage. **Never bundled into source.** UI offers "test connection" and clear errors.
4. **Structured output.** Prefer the provider's tool-calling / function-calling API for command emission (`emit_command({type: 'patrol', targetZone: 'elf-forest', units: [...]})`). Fallback to a JSON schema prompt + parse-and-validate when the provider doesn't support tools.
5. **Fallback.** When no provider is configured, the provider returns an error, or a response fails validation/timeout, the scripted AI immediately resumes that faction's command stream. This is not a degraded mode — it's a first-class playable mode. MVP ships scripted-only because that's the offline-safe baseline.
6. **Cost guardrails.** Per-session token budget surfaced in the settings UI (P5 polish). Per-call timeouts (default 20s). No retry storms.

## 6. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Scope is gigantic for a small team | 🔴 High | Brutally narrow MVP (§3). Limb system, shops, LLM strategic decisions are explicitly deferred from MVP. |
| Dense forest perf in browser | 🟡 Med | `InstancedMesh` for trees + frustum culling + LOD billboard ↔ mesh swap. Budget: ≤500 visible meshes at LOD, ≤5k billboards. |
| Asset cost (3D models, anims, audio) | 🟡 Med | Start with CC0 (kenney.nl, Quaternius). Hire artist only after P1 proves the loop. |
| Limb system feels gimmicky or unfun | 🟡 Med | Prototype in P4 with a single hit-zone (right hand) before building the full system. Cut if playtests reject it. |
| Save format breaks across versions | 🟢 Low | Versioned schema from day 1; migration helper from P2 onward. |
| Browser fragmentation (WebGPU not universal) | 🟢 Low | WebGL fallback. Three handles this transparently. |
| 🆕 LLM provider latency disrupts game tempo | 🟡 Med | Strategic ticks operate on 5–15 s cadence, never per-frame. Commands arrive async into a queue; game loop never blocks. Document expected tempo to players in settings UI. |
| 🆕 LLM provider timeout / outage / API change | 🟡 Med | Per-call timeout (20 s default). On error: surface to player + immediately fall back to scripted AI for that faction. No retry storms. Adapter version pinning in tests. |
| 🆕 LLM call cost / rate limits | 🟡 Med | Surface token-budget dashboard in settings (P5). User-supplied key = user-paid; we never proxy. Rate-limit handling at adapter level with exponential backoff capped at 3 attempts. |
| 🆕 Player-supplied API key leaks | 🟡 Med | Keys live in localStorage only; never sent anywhere except directly to the provider over HTTPS. No telemetry on key contents. Settings UI warns "stored locally; clear browser storage to remove". |
| 🆕 Prompt-injection from in-game text (NPC names, item descriptions) into LLM context | 🟡 Med | Game-state serializer strips/escapes user-generated content. Use system-prompt isolation; treat LLM output as untrusted (validate against schema, reject malformed). |

## 7. Open product decisions — ✅ RESOLVED (board sign-off 2026-06-14)

All four questions answered by the board in comment `09bf8df3`. Quoted answers below; CEO recommendations preserved for traceability.

| # | Question | CEO recommendation (v1) | **Board decision (v2)** |
|---|---|---|---|
| **Q1** | Multiplayer or single-player? | Single-player AI | ✅ **Single-player + pluggable LLM-agent opponent**. No human-vs-human netcode. Opposing faction(s) driven by LLM via external API behind a provider-agnostic interface. **Provider priority refined by board comment `61c8898b` (v2.1): DeepSeek = MVP/P1 default and only adapter in P1**; Anthropic-compatible and OpenAI-compatible adapters are follow-up issues post-P1. Settings live in UI; localStorage only. Scripted-AI fallback when not configured or unreachable. See §5a. |
| **Q2** | Art direction | Stylized low-poly | ✅ **Stylized low-poly** (accepted as recommended) |
| **Q3** | Engine pick | Three.js + Rapier + Vite + TS | ✅ **Three.js + Rapier + Vite + TypeScript** (accepted as recommended) |
| **Q4** | Caravans: elves only or all factions? | All factions | ✅ **All three factions** can intercept and rob caravans (accepted as recommended) |

The `ask_user_questions` interaction (`45a43737`) is auto-superseded by the board's comment.

## 8. Decomposition preview — TL handoff

Filed as child issue to Tech Lead alongside this v2 (separate paperclip issue). TL produces the actual engineering child issues. The list below is *guidance for scope*, not the final issue set.

**P0 issues** (pre-production, ~6 issues):
- Repo bootstrap: Vite + TS + ESLint + Prettier + GH Actions CI (typecheck + bundle-size budget)
- Three.js + Rapier integration smoke test (spinning cube + physics ground)
- Art-style mood-board sign-off (stylized low-poly references, color palette)
- Save-format schema v1 (versioned, migration-ready)
- Asset pipeline (glTF loader, first 5 CC0 placeholder models — tree mesh, tree billboard, elf house, player capsule, palace soldier)
- 🆕 **AI-agent provider abstraction spec** (`LLMProvider` interface, command schema, error-fallback semantics, settings storage format) — must explicitly anticipate DeepSeek + Anthropic + OpenAI-compat wire formats even though only DeepSeek ships in P1, so later adapters drop in cleanly

**P1 issues** (vertical slice / MVP, ~12 issues):
- Scene + 3rd-person camera + WASD controls + jump
- Forest LOD system (InstancedMesh near, billboard far, distance-based swap)
- Elf house models + simple terrain
- Palace soldier enemy model + scripted AI state machine (idle/chase/attack/die)
- Melee combat + HP + death + respawn
- Caravan path + cart model + intercept interaction + loot transfer
- Loot inventory (in-memory; serialized to save)
- Save/load to localStorage (HP, position, loot, provider settings)
- Main menu + HUD (HP bar, loot counter, save button)
- Audio integration (4 placeholder sounds via Howler)
- 🆕 **AI-agent client scaffold** — provider-agnostic `LLMProvider` interface + structured tool-call path + JSON-schema fallback path. **No concrete adapters in this issue** — only the interface and the wiring
- 🆕 **DeepSeek adapter (P1 first-and-only AI-agent provider)** — concrete `LLMProvider` implementation for DeepSeek's REST API, including auth, tool-calling, error mapping, "ping" call for the settings UI
- 🆕 **Provider settings UI** (DeepSeek-only fields in P1: base URL + model + API key + "test connection". Provider dropdown structure stubbed but disabled until the next adapter lands)
- 🆕 **Follow-up issue: Anthropic adapter** — filed but not in P1 scope; activated alongside or after P2
- 🆕 **Follow-up issue: OpenAI-compatible adapter** — filed but not in P1 scope; doubles as the generic "bring-your-own-endpoint" path

**P2–P5 issues** filed at the start of each phase. P2 adds the headline LLM-go-live work: serializer for strategic state, command parser/validator, AgentRouter wiring scripted ↔ LLM, faction strategic surface (patrol/raid/target schedules).

## 9. Non-goals (explicitly out)

- **Mobile-first.** Desktop browser is the launch target. Mobile support is post-v1.0.
- **VR.** Out forever (different game entirely).
- **Monetization.** Not in scope of this plan. Free-to-play demo; monetization is a CEO-level decision after v1.0 traction signal.
- **Procedural world generation.** All 4 zones are hand-authored.
- **Modding API.** Post-v1.0.
- **Story / voice acting.** Lightweight text-only quest UI; no VO until budget exists.
- 🆕 **Human-vs-human multiplayer / netcode** (locked by Q1 sign-off).
- 🆕 **Hosting LLM inference ourselves / proxying user calls** — game calls the user's chosen provider *directly* from the browser. No backend, no proxy, no key escrow.

---

## 10. v2.1 delta vs v2

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

## 10a. v2 delta vs v1

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

- **v2.1 (2026-06-14)** — Board refinement on provider priority (`61c8898b`). DeepSeek = MVP/P1 default and only adapter in P1; Anthropic + OpenAI-compat become follow-up issues. §2, §3, §5, §5a, §7, §8, §10 updated. TL handoff (BOO-375) description synced.
- **v2 (2026-06-14)** — Board sign-off Q1–Q4. New product pillar: pluggable LLM-agent opponent. Architecture in §5a. Risk register, MVP, roadmap, decomposition preview updated accordingly. Handed off to TL.
- **v1 (2026-06-14)** — Initial draft. Awaiting board sign-off on Q1–Q4 (§7).
