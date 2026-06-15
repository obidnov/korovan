# korovan

3D action web game inspired by the legendary 2004 brief.

Three playable factions (forest elves, palace guard, the Villain) on a 4-zone overworld map,
with caravans to rob, dense LOD forests, a limb-and-wound system, and Daggerfall-lite economy.

Runs in the browser. No install. See [PLAN.md](./PLAN.md) for the full product plan.

## Requirements

- Node.js 22+
- pnpm 10+

## Quick start

```sh
pnpm install
pnpm dev
```

Opens at `http://localhost:5173`.

## Local development

Copy the example env file and fill in values:

```sh
cp .env.local.example .env.local
# edit .env.local — set DEEPSEEK_API_KEY etc.
```

Run client and server in separate terminals:

```sh
# Terminal 1 — Vite client dev server (hot reload)
pnpm dev:client

# Terminal 2 — Express backend (auto-restart on changes)
pnpm dev:server
```

- Client: `http://localhost:5173`
- Server: `http://localhost:8787` (configurable via `PORT` env)
- Healthcheck: `curl http://localhost:8787/healthz`

## Scripts

| Command | Description |
|---|---|
| `pnpm dev:client` | Start Vite client dev server with HMR |
| `pnpm dev:server` | Start Express backend dev server (tsx watch) |
| `pnpm build` | Production build — client (Vite) |
| `pnpm --filter server build` | Production build — server (tsc → dist/) |
| `pnpm preview` | Preview client production build locally |
| `pnpm typecheck` | TypeScript strict type check — client |
| `pnpm --filter server typecheck` | TypeScript strict type check — server |
| `pnpm lint` | ESLint — zero warnings allowed (client + server) |
| `pnpm format` | Prettier write |
| `pnpm test` | Vitest test suite — client |
| `pnpm --filter server test` | Vitest test suite — server |

## CI

GitHub Actions runs on push and PR to `develop`:

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck` + `pnpm --filter server typecheck`
3. `pnpm lint`
4. `pnpm test` + `pnpm --filter server test`
5. `pnpm build` + `pnpm --filter server build` + bundle-size budget check (≤ 1.5 MB gzipped for client JS)

## Tech stack

| Layer | Choice |
|---|---|
| Bundler | Vite 6 |
| Language | TypeScript 5 (strict) |
| Tests | Vitest + jsdom |
| Linter | ESLint 9 + typescript-eslint |
| Formatter | Prettier 3 |
| Renderer _(P1)_ | Three.js |
| Physics _(P1)_ | Rapier (WASM) |

## Status

✅ **Plan v2.1 board-approved** (2026-06-14). Locked: stylized low-poly, Three.js + Rapier + Vite + TypeScript,
all factions can rob caravans, single-player with pluggable LLM-agent opponent (DeepSeek-first in P1;
OpenAI-compatible and Anthropic adapters in post-P1). Handed off to Tech Lead for P0+P1 decomposition.
