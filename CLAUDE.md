# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Under a Dark Star

This repository is a fork of OpenFront.io being turned into **Under a Dark Star (DarkStar)**, a sci-fi territorial strategy game. Its defining feature is the asymmetric **Hegemon** role: one player starts each round extremely strong but cannot expand; the other players grow across the galaxy and try to overthrow them. The round ends when the Hegemon is eliminated (the player who lands the killing blow wins) or when the timer expires (the Hegemon wins). The winner is the next round's Hegemon.

**Read `docs/DarkStar-Design.md` before any design or gameplay work.** It records the decided rules, open questions, relevant engine hooks, licensing obligations and roadmap. Update it (and its changelog) when decisions change.

## Commands

```bash
npm run inst             # Install deps (uses npm ci --ignore-scripts — do NOT use npm install)
npm run dev              # Run client + server in dev mode with hot reload
npm run start:client     # Client only
npm run start:server-dev # Server only
npm test                 # Run all tests (Vitest)
npm run test:coverage    # Tests with coverage
npm run lint             # Oxlint + ESLint
npm run lint:fix         # Oxlint + ESLint with auto-fix
npm run format           # Prettier
npm run build-prod       # Production build
npm run map              # Map kit: build a map from a drawing (docs/MapMaking.md)
```

**Run a single test file:**

```bash
npx vitest tests/YourTest.test.ts --run
npx vitest NationAllianceBehavior --run # match by name pattern
```

## Architecture

OpenFront.io (the engine DarkStar is built on) is a real-time multiplayer territorial strategy game. There are four components:

1. **`src/core/`** — Deterministic game simulation. Pure TypeScript with **no external dependencies**. Must remain fully deterministic (seeded PRNG, no floating-point math). Runs in a Web Worker thread. All `src/core` changes **must** include tests.
2. **`src/client/`** — Rendering (custom WebGL2 in `src/client/render/`, see `src/client/render/CLAUDE.md`), UI (Lit web components + Tailwind CSS 4; in-game HUD in `src/client/hud/`), WebSocket communication.
3. **`src/server/`** — Game coordination, intent relay, WebSocket management (Node.js/Express/ws).
4. **API** — Closed-source Cloudflare Worker handling auth, stats, cosmetics, monetization. Not in this repo, and **not available to this fork** — features that depend on it (accounts, store, ranked, game archive/replays) do not work.

Terminology (decided 2026-10-07, feudal): simple bots are **Barons** to players (`TribeExecution`, "Tribes" in the code); the smarter map-defined AI players are **Lords** (`NationExecution`, `src/core/execution/nation/`, "Nations" in the code). The Hegemon sits above both. Terrain (decided 2026-10-12): the engine's land tiles are **nebula** (plural **nebulae**) and its water is **deep space**. Code identifiers keep the old names; only player-facing text and the docs use the new ones.

### Simulation Flow (Intent → Execution)

The game simulation runs **on each client**, not the server. The server only relays intents.

1. Player action → client creates an **Intent** → sent to server
2. Server bundles all intents for the tick into a **Turn** → relays to all clients
3. Client forwards Turn to the Core worker
4. Core creates an **Execution** for each intent
5. Core calls `executeNextTick()` — all executions run and mutate game state
6. Core sends **GameUpdates** back to client → client renders

Intents and all wire messages are Zod-validated schemas defined in `src/core/Schemas.ts`.
Every WebSocket frame is a compact binary encoding of those schemas
(`src/core/ZbinWire.ts`, library docs in `zbin/README.md`). HTTP stays JSON.

### CDN / Static Assets

The game server only serves `index.html` and the WebSocket. All other assets (JS bundle, images, maps, worker) come from a CDN bucket. `CDN_BASE` is an empty string in dev (falls back to same-origin) and a full origin (e.g. `https://cdn.example.com`) in production. It is set as both a Vite build-time variable and a server runtime env var.

## Key Files

| File                                  | Purpose                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `docs/DarkStar-Design.md`             | DarkStar goals, rules, roadmap                                                             |
| `docs/DarkStar-Roadmap.md`            | The road to release (phases P0–P8)                                                         |
| `docs/DarkStar-Lobbies.md`            | Public lobbies / thrones design (P6)                                                       |
| `docs/DarkStar-Accounts.md`           | Accounts / leaderboard design (P5)                                                         |
| `docs/DarkStar-Launch.md`             | Ordered steps to the public release                                                        |
| `docs/DarkStar-Services.md`           | The third-party services and how they connect                                              |
| `docs-private/DarkStar-Operations.md` | PRIVATE, git-ignored: the server's address and access, account ownership, secrets, runbook |
| `docs/DarkStar-Sound.md`              | The sound ledger: every cue, its audience, origin                                          |
| `docs/MapMaking.md`                   | Drawing a map and building it                                                              |
| `src/core/configuration/Config.ts`    | All game balance constants/formulas                                                        |
| `src/core/Schemas.ts`                 | All intent/message types (Zod schemas)                                                     |
| `src/core/GameRunner.ts`              | Simulation orchestrator                                                                    |
| `src/core/game/GameImpl.ts`           | Game state implementation                                                                  |
| `src/server/GameServer.ts`            | Main WebSocket server, game loop                                                           |
| `src/server/Master.ts`                | Lobby and game registry                                                                    |
| `tests/util/Setup.ts`                 | Test helper — creates test games                                                           |
| `docs/Architecture.md`                | Architecture overview                                                                      |
| `zbin/README.md`                      | Binary wire format for zod schemas                                                         |
| `docs/Auth.md`                        | JWT/auth flow                                                                              |
| `docs/API.md`                         | Public API endpoints                                                                       |
| `vite.config.ts`                      | Build config, CDN handling                                                                 |

## UI Text / i18n

All user-visible text must go through `translateText()` and have a corresponding entry added to `resources/lang/en.json`. Translations are managed via Crowdin. DO NOT modify any other translation files.

## Testing Patterns

Tests use a `setup()` helper from `tests/util/Setup.ts` that creates a full game instance with map data from `tests/testdata/maps/`. Write tests that exercise the core simulation directly — not mocks.

## Tech Stack

- **Bundler:** Vite + TypeScript 5.7
- **Rendering:** Custom WebGL2 renderer (GLSL passes, no framework)
- **UI Components:** Lit (LitElement) + Tailwind CSS 4
- **Audio:** Howler.js
- **Schemas/Validation:** Zod
- **Testing:** Vitest
- **Server:** Node.js, Express, ws (WebSocket)

## Public repository rules

This repository is public (AGPL §13 requires it). Decided 2026-10-12 after a cleanup and a
history rewrite; do not make it necessary again.

- **Never commit** the server's address, hostnames of machines (public DNS names are fine), SSH
  key names or paths, which personal account owns a service, personal email addresses, or local
  paths carrying a username. These live in `docs-private/` (git-ignored) and nowhere else. Point
  at `docs-private/DarkStar-Operations.md` instead of repeating them.
- **The contact address in anything tracked is `hello@january-games.com`**, never a personal one.
  The repo's git config sets it as the author email; keep it that way.
- **Secrets** (tokens, keys, client secrets) exist only in the root `.env` (git-ignored) and on the
  server. Never paste one into a file, a commit message, a test fixture or a chat reply.
- **A pre-commit guard** (`scripts/checkPrivatePatterns.mjs`, run by `.husky/pre-commit`) refuses
  any staged line matching `docs-private/forbidden-patterns.txt`. When a new private value appears,
  add it to that file first.
- **Design docs are public.** Tom's first name and his decisions are fine in them; his accounts,
  machines and addresses are not.
- When in doubt, write the fact in `docs-private/` and leave a pointer in the public doc.
