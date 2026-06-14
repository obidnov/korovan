# korovan — Product plan

**Revision:** v1 (2026-06-14)
**Author:** CEO
**Status:** Draft — awaiting board sign-off on 4 open decisions (§7) before engineering decomposition begins.
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
| **Caravan raiding** | The signature mechanic. Caravans periodically traverse zones; players can intercept and loot them. (Elves by lore; possibly all factions — see §7 Q4.) |
| **Dense forest with LOD** | Far trees = billboards, near trees = 3D meshes. The elf zone *feels* dense and oppressive — visual identity of the game. |
| **Daggerfall-lite economy** | Shops, currency, gear progression. Buy weapons, armor, healing items, **prosthetics**. |
| **Limb-and-wound system** | Real consequence layer. Lose a hand → bleed out unless healed. Lose an eye → half-screen black until prosthetic. Lose a leg → crawl / wheelchair / prosthetic. Differentiator vs. typical web action games. |
| **Persistence** | Save game. (MVP: localStorage. v1.0: optional cloud save.) |
| **Web-native** | No install. Runs in modern browsers via WebGL/WebGPU. |

## 3. MVP definition (what ships first)

**Goal of MVP:** prove the core loop is fun and the tech stack scales, on the smallest possible content footprint.

**MVP scope (single playable faction, single zone, vertical slice):**

- Faction: **Forest elves only**
- Zone: **Elf forest only** (1 of 4)
- Movement: WASD + space (jump) + 3rd-person camera
- Combat: melee swing (1 weapon), HP, hit/death
- Enemies: 1 type (palace soldier patrol), basic AI (idle → chase → attack → die)
- World: dense forest with LOD (billboard ↔ 3D mesh swap), wooden elf houses (3 static models), simple ground
- Signature mechanic: **1 caravan route** — a cart with loot patrols a fixed path, player can intercept and grab loot
- Persistence: save HP / position / loot to localStorage
- UI: HP bar, loot counter, save/load buttons, main menu
- Audio: footsteps, sword swing, hit, ambient forest loop (4 sounds total)

**Out of MVP** (deferred to later phases): other factions, other zones, limb system, shops/economy, commander AI, faction raids, day/night cycle, multiplayer, settings menu.

**MVP success criteria:**
1. Loads in <10 s on modern desktop browser (cold cache).
2. Holds 60 fps on mid-range hardware (M1 / iGPU laptop) with ~500 visible trees at LOD.
3. Player can complete a caravan robbery loop end-to-end (find → engage guards → loot → return to safe spot → save) in <5 minutes.
4. Demo-able to Kirill in a single tab, no install.

## 4. Phased roadmap

| Phase | Theme | Headline deliverables | Rough effort |
|---|---|---|---|
| **P0** | Pre-production | Engine pick locked, art direction locked, asset pipeline, repo bootstrap, CI, save-format spec | 1–2 wk |
| **P1** | Vertical slice (= MVP, §3) | Elf zone playable end-to-end, 1 caravan, 1 enemy, save/load | 4–6 wk |
| **P2** | Map + 2nd faction | All 4 zones traversable, palace guard faction, commander quest skeleton, basic shops in neutral zone | 4–6 wk |
| **P3** | Villain + raid loop | Villain faction, squad command (follow/attack), large-scale raid event on palace, faction-vs-faction AI battles | 4–6 wk |
| **P4** | Limb/wound system | Hit-zone targeting, bleed-out timer, eye/leg/hand wounds, prosthetic items, half-screen-black shader, movement state machine (walk → crawl → wheelchair) | 3–4 wk |
| **P5** | v1.0 polish | More enemies, more caravans, day/night, audio pass, settings menu, balance, cloud save (optional) | 3–4 wk |

Total: ~5–7 months calendar for a small team (1 eng + part-time art + part-time PM/QA). Compress with more headcount on P2/P3 (parallel zones).

## 5. Tech stack — recommendation

**Recommended pick (default if Kirill accepts in §7 Q3):**

| Layer | Choice | Why |
|---|---|---|
| Renderer | **Three.js** (r170+) | Mature, huge ecosystem, full control. `InstancedMesh` is the right tool for dense forest. WebGPU path opens up as it stabilizes. |
| Physics | **Rapier (WASM)** | Deterministic, fast, MIT, plays well with Three. |
| Language | **TypeScript** | Strict types. Prevents the "what is this object" tax on a 6-month build. |
| Bundler | **Vite** | Sub-second HMR; production build is rollup; no config rabbit-hole. |
| State | Plain TS classes + ECS-lite via [miniplex](https://github.com/hmans/miniplex) | Avoid over-architecting; we're not Unreal. |
| Audio | Web Audio API direct + Howler.js for sprites | Cheap, works everywhere. |
| Save | localStorage (P1) → IndexedDB via `idb` (P2+) → optional cloud (P5) | Incremental. |
| Assets | Stylized low-poly, glTF format | Web-friendly file sizes. CC0 from [kenney.nl](https://kenney.nl/) as placeholder. |
| Hosting | Static hosting (Vercel / GitHub Pages) | Game is fully client-side; trivial deploy. Multiplayer (if chosen) needs backend — see §7 Q1. |
| CI | GitHub Actions: typecheck + bundle-size budget check | Don't ship a 50 MB tab. |

**Alternative engine considered:** Babylon.js — batteries-included (physics, GUI, animation editor), but Three has the larger CC0 asset/community footprint and lower runtime overhead for our LOD-heavy use case. **PlayCanvas** considered as commercial-friendly hosted editor but locks us to their platform.

## 6. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Scope is gigantic for a small team | 🔴 High | Brutally narrow MVP (§3). Limb system, multiplayer, shops are explicitly deferred. |
| Dense forest perf in browser | 🟡 Med | `InstancedMesh` for trees + frustum culling + LOD billboard ↔ mesh swap. Budget: ≤500 visible meshes at LOD, ≤5k billboards. |
| Asset cost (3D models, anims, audio) | 🟡 Med | Start with CC0 (kenney.nl, Quaternius). Hire artist only after P1 proves the loop. |
| Limb system feels gimmicky or unfun | 🟡 Med | Prototype in P4 with a single hit-zone (right hand) before building the full system. Cut if playtests reject it. |
| Save format breaks across versions | 🟢 Low | Versioned schema from day 1; migration helper from P2 onward. |
| Browser fragmentation (WebGPU not universal) | 🟢 Low | WebGL fallback. Three handles this transparently. |
| Multiplayer creep (if chosen in Q1) | 🔴 High if yes | Single-player MVP is cheaper by ~6 weeks. Defer netcode decision until v1.0 or punt entirely. |

## 7. Open product decisions — board sign-off required

These four questions must be answered before TL can decompose this into engineering issues. They cascade into the entire architecture.

| # | Question | CEO recommendation | Why it matters |
|---|---|---|---|
| **Q1** | **Multiplayer or single-player?** | **Single-player AI** for v1.0. Multiplayer is a separate project. | Multiplayer adds ~6 wk netcode + a backend + lobby + cheat prevention. Brief doesn't specify. |
| **Q2** | **Art direction** | **Stylized low-poly** (Daggerfall-spiritual, modern stylized colors) | Realistic = 10× asset cost + slow loads. Stylized ships faster and ages better. |
| **Q3** | **Engine pick** | **Three.js + Rapier + Vite + TS** (per §5) | Locks the entire codebase shape. |
| **Q4** | **Caravans: elves only, or all factions can rob?** | **All factions** can ambush caravans (signature mechanic should be universal, not faction-locked) | Brief says "эльфу раз лесные то…" implying elves, but "грабить корованы" is the meme heart of the game — universalize. |

I'm posting these as a structured `ask_user_questions` interaction on the parent issue. Once Kirill answers, TL decomposes P0 + P1 into child engineering issues (estimated ~12–18 issues for the vertical slice).

## 8. Decomposition preview (for context, not yet filed)

Once Q1–Q4 are answered, TL files these as child issues under BOO-374:

- **P0 issues** (pre-production, ~5 issues): repo bootstrap + CI + bundler config; engine integration smoke test; art-style mood-board sign-off; save-format schema v1; asset pipeline + first 5 CC0 placeholders.
- **P1 issues** (vertical slice, ~10 issues): scene + camera + controls; forest LOD system; elf house models; 1 enemy AI; melee combat + HP; caravan path + interaction; loot inventory (in-memory); save/load to localStorage; main menu + HUD; audio integration.

P2–P5 issues filed at the start of each phase (don't pre-file v1.0 work — premature).

## 9. Non-goals (explicitly out)

- **Mobile-first.** Desktop browser is the launch target. Mobile support is post-v1.0.
- **VR.** Out forever (different game entirely).
- **Monetization.** Not in scope of this plan. Free-to-play demo; monetization is a CEO-level decision after v1.0 traction signal.
- **Procedural world generation.** All 4 zones are hand-authored.
- **Modding API.** Post-v1.0.
- **Story / voice acting.** Lightweight text-only quest UI; no VO until budget exists.

---

*Revision history*

- **v1 (2026-06-14)** — Initial draft. Awaiting board sign-off on Q1–Q4 (§7).
