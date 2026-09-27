# Contributing to Under a Dark Star

Under a Dark Star is a fork of [OpenFront.io](https://github.com/openfrontio/OpenFrontIO)
by January Games. The game is not yet released; until it is, contributions are
by invitation, and the design document and roadmap are the source of truth for
what is being built:

- `docs/DarkStar-Design.md` — the rules, the as-built notes, the open questions.
- `docs/DarkStar-Roadmap.md` — the road to release, phase by phase.

## Getting started

```bash
git clone https://github.com/thomasa13813/UnderADarkStar.git
cd UnderADarkStar
npm run inst
npm run dev
```

Use `npm run inst`, never `npm install`: it runs `npm ci --ignore-scripts`, so
the lockfile is honoured and no install scripts run.

## Before you open a pull request

- `npm test` passes (Vitest; core changes must come with tests).
- `npx tsc --noEmit`, `npx oxlint` and `npx eslint <changed files>` are clean.
- `npm run format` has been run.
- User-visible text goes through `translateText()` with an entry in
  `resources/lang/en.json`. Do not edit the other language files.
- `src/core` stays deterministic: seeded randomness only, no floating-point
  simulation math, no browser or Node APIs.

## Licensing

Code contributions are licensed under the AGPL-3.0 (see `LICENSE` and
`LICENSING.md`). Assets added to `resources/` are CC BY-SA 4.0 (see
`LICENSE-ASSETS`). The "Under a Dark Star" marks in `branding/` are January
Games' own and are not open for contribution.

Thank you for helping build the game.
