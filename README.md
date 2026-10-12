# Under a Dark Star

A multiplayer sci-fi strategy game by January Games. One player starts each
round as the **Hegemon**: extremely strong, but unable to expand. Everyone else
grows across the galaxy and tries to overthrow them. The round ends when the
Hegemon falls (the player who lands the killing blow wins) or when the timer
runs out (the Hegemon wins). The winner is the next round's Hegemon.

Under a Dark Star is a fork of [OpenFront.io](https://github.com/openfrontio/OpenFrontIO),
© OpenFront and Contributors, which is itself a fork/rewrite of
[WarFront.io](https://github.com/WarFrontIO). The design and the road to
release are in [docs/DarkStar-Design.md](docs/DarkStar-Design.md) and
[docs/DarkStar-Roadmap.md](docs/DarkStar-Roadmap.md).

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Assets: CC BY-SA 4.0](https://img.shields.io/badge/Assets-CC%20BY--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-sa/4.0/)

## License

The source code is licensed under the **GNU Affero General Public License
v3.0**, with OpenFront's additional attribution terms (see [LICENSE](LICENSE)):
modified versions must keep "© OpenFront and Contributors" reasonably visible
and must not be presented as OpenFront. This fork keeps that notice in the
home-page footer and on the game-start screen, and offers its source through
the footer's "Source" link.

- Assets in `resources/` are CC BY-SA 4.0: see [LICENSE-ASSETS](LICENSE-ASSETS).
- The "Under a Dark Star" name and marks in `branding/` belong to January
  Games and are not open: see [branding/LICENSE](branding/LICENSE).
- Licence history and the fork's obligations: [LICENSING.md](LICENSING.md).
- Third-party data, icons and fonts: [CREDITS.md](CREDITS.md).
- Found a security problem? [SECURITY.md](SECURITY.md) says how to report it.

## Prerequisites

- [npm](https://www.npmjs.com/) (v10.9.2 or higher)
- A modern browser (Chrome, Firefox, Edge, etc.)

## Installation

```bash
git clone https://github.com/thomasa13813/UnderADarkStar.git
cd UnderADarkStar
npm run inst
```

Do NOT use `npm install` nor `npm i` but instead use `npm run inst`. It runs the
safer `npm ci --ignore-scripts` to install dependencies exactly according to the
versions in `package-lock.json` and doesn't run scripts, which prevents being
hit by a supply chain attack.

## Running the game

### Development mode

Run both the client and server in development mode with live reloading:

```bash
npm run dev
```

This will:

- Start the Vite dev server for the client
- Launch the game server with development settings
- Open the game in your default browser (to disable this behavior, set
  `SKIP_BROWSER_OPEN=true` in your environment)

### Client only

```bash
npm run start:client
```

### Server only

```bash
npm run start:server-dev
```

## Development tools

- **Format code:** `npm run format`
- **Lint (Oxlint and ESLint):** `npm run lint`, or `npm run lint:fix`
- **Tests (Vitest):** `npm test`, or a single file with
  `npx vitest tests/YourTest.test.ts --run`
- **Production build:** `npm run build-prod`

## Project structure

- `/src/client` - Frontend game client (WebGL2 renderer, Lit UI)
- `/src/core` - Deterministic game simulation
- `/src/server` - Game server (lobbies, intent relay)
- `/resources` - Open static assets (images, maps, sounds, translations)
- `/branding` - January Games' own marks; overrides `resources/` at build time
- `/zbin` - Compact binary wire format for zod schemas (self-contained, zod-only)
- `/docs` - Design document, roadmap and architecture notes

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Code contributions are licensed under
AGPL v3 and assets under CC BY-SA 4.0.
