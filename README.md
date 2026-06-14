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

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server with hot module replacement |
| `pnpm build` | Production build to `dist/` |
| `pnpm preview` | Preview production build locally |
| `pnpm typecheck` | TypeScript strict type check (no emit) |
| `pnpm lint` | ESLint — zero warnings allowed |
| `pnpm format` | Prettier write |
| `pnpm test` | Vitest test suite (single run) |

## CI

GitHub Actions runs on push and PR to `develop`:

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm test`
5. `pnpm build` + bundle-size budget check (≤ 1.5 MB gzipped for all JS assets)

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
