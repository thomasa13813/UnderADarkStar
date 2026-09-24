# CLAUDE.md — `src/client/render/`

WebGL2 renderer for the game map. Everything that draws onto the map canvas
lives here. HUD components (Lit elements, DOM overlays) live in
`src/client/graphics/`, not here.

## Pipeline

```
simulation tick (worker)
        │
        ▼
GameView.update(gu)           ← client-side mirror (../view/GameView.ts)
        │  builds long-lived FrameData object
        ▼
WebGLFrameBuilder.update      ← syncs palette, local-player ID, spawn
        │                       overlay; then uploads FrameData
        ▼
uploadFrameData(view, frame)  ← frame/Upload.ts — dispatches to view.update*()
        │
        ▼
MapRenderer.update*() methods ← gl/MapRenderer.ts — public facade
        │
        ▼
GPURenderer (gl/Renderer.ts)  ← owns all passes
        │
        ▼  per-frame RAF (driven from ClientGameRunner.driveFrame)
        ▼
each Pass.draw(cameraMatrix)  ← writes to the screen / FBO chain
```

The simulation runs at ~10Hz on a worker thread. The renderer draws at 60fps.
FrameData is built once per tick and mutated in place; passes read from it
each frame (and animate from local time, e.g. the spawn-overlay breath).

## Directory map

| Path                      | Purpose                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types/`                  | Shared TS interfaces: `FrameData`, `UnitState`, `PlayerState`, `RendererConfig`, pass-input shapes (`GhostPreviewData`, `NukeTrajectoryData`, `SpawnCenter`, …)       |
| `frame/`                  | Frame-data accumulators + per-tick derivations (CPU-side, no GL)                                                                                                      |
| `frame/derive/`           | Pure derivations that turn raw simulation state into renderer-ready shapes (attack rings, alliance clusters, relation matrix, player status, nuke telegraphs)         |
| `frame/Upload.ts`         | `uploadFrameData(view, frame)` — single dispatch point that calls every `view.update*()` based on what's in the frame                                                 |
| `frame/TrailManager.ts`   | Mutates the per-tile trail texture; emits dirty row range                                                                                                             |
| `frame/RailroadCache.ts`  | Maintains the railroad tile state buffer                                                                                                                              |
| `gl/`                     | WebGL2 renderer internals                                                                                                                                             |
| `gl/MapRenderer.ts`       | Public facade — what `WebGLFrameBuilder` and the client talk to                                                                                                       |
| `gl/Renderer.ts`          | Owns all passes, runs them in order each frame, manages FBOs                                                                                                          |
| `gl/Camera.ts`            | World↔screen math; mutated externally each frame via `setCameraState`                                                                                                 |
| `gl/RenderSettings.ts`    | Typed view of `render-settings.json` (tuning knobs)                                                                                                                   |
| `gl/render-settings.json` | All per-pass tuning constants (alpha, radii, colors, etc.)                                                                                                            |
| `gl/*-theme.json`         | Theme data (player/team palettes, color-derivation knobs) — the active one is combined into `settings.theme` at runtime                                               |
| `gl/passes/`              | One file per pass — see "Pass conventions" below                                                                                                                      |
| `gl/utils/`               | Cross-pass helpers: `GlUtils` (program/shader compile), `TileCodec` (`OWNER_MASK` etc.), `NukeTrajectory` (Bezier math), `Affiliation`, `HeatManager`, `GpuResources` |
| `gl/shaders/`             | `.glsl` source files (`?raw` imported by passes)                                                                                                                      |
| `gl/debug/`               | Tweakpane-style debug GUI (`createDebugGui`) — live render-settings editor                                                                                            |

## Pass conventions

Each pass is a class that owns:

- A compiled `WebGLProgram` (+ uniform locations cached at construct time)
- Any VAOs / instance buffers it draws from
- Its slice of `RenderSettings` (passed in at construct time)

A typical pass exposes:

- `update(...)` or `set*()` — called externally to push per-tick or per-event
  state (e.g. `setHighlightOwner`, `updateGhostPreview`, `applyLiveDelta`)
- `draw(cameraMatrix, zoom?, …)` — called every frame from `GPURenderer.render`
- `dispose()` — clean up GL resources

Passes never read DOM events or game state directly — they're pure consumers
of data pushed in via setters. The renderer composes them; the **client**
decides what to push.

## How the client pushes data

The WebGL view is meant to be input-pushed, not state-pulled. All wiring lives
in two places:

- **`WebGLFrameBuilder.update(gameView)`** runs each simulation tick. It
  syncs:
  - Palette entries for any newly-seen players
  - `view.setLocalPlayerID(smallID)` when myPlayer is resolved
  - `view.updateSpawnOverlay(inSpawnPhase, centers)`
  - then `uploadFrameData(view, frameData)` for everything else

- **Controllers in `../controllers/`** push view state in response to
  EventBus events (mouse / keyboard). Examples:
  - `BuildPreviewController` → `view.updateGhostPreview`,
    `view.updateNukeTrajectory`
  - `WarshipSelectionController` → `view.setSelectedUnits`
  - `HoverHighlightController` → `view.setHighlightOwner`

If a renderer feature isn't appearing in game, the usual cause is "the pass
is wired but no one's pushing data to it" — check `WebGLFrameBuilder` first,
then the controllers, then `ClientGameRunner` (alt-view toggle,
day/night-mode wiring).

## Camera + input

- The renderer has its own `Camera` but does **not** own input. Camera state
  is pushed in each frame from `TransformHandler` (in `src/client/`) via
  `view.setCameraState(x, y, z)`.
- Input events all flow through `InputHandler` (binds to a transparent
  `inputOverlay` div above the GL canvas) → EventBus → controllers / HUD.
  The WebGL canvas itself has `pointer-events: none`.

## FrameData contract

`FrameData` (in `types/`) is a **single long-lived object** on `GameView`.
Most fields are mutable references to long-lived buffers (`tileState`,
`trailState`, `railroadState`); some (`changedTiles`, derived arrays) are
reused per tick. The `readonly` modifier in the type is API hygiene — it
doesn't prevent mutation through the reference.

Live mode upload semantics (in `frame/Upload.ts`):

- `changedTiles = null` → "no delta info, full upload" (first tick)
- `changedTiles.length > 0` → "only these tiles changed, sub-upload dirty rows"
- `changedTiles.length === 0` → "nothing changed, skip"

Live tile changes are drip-applied per render frame inside `TerritoryPass`
(see `applyLiveDelta` + `drainDripBucket` in `gl/passes/TerritoryPass.ts`).
Each tick's `changedTiles` is hashed by `ref` into N round-robin buckets
(`tileDrip.bucketCount`, default 12); the renderer drains one bucket per
60Hz frame in `uploadTextures()`. The stable per-ref hash guarantees that
repeated updates to the same tile stay in arrival order, so the latest
owner always wins. During spawn phase, `flushAllDripBuckets()` is called
instead so initial state pops without staggering.

## Asset pipeline

Sprite atlases live in `resources/atlases/` and are loaded via `assetUrl()`
in each pass (set `img.crossOrigin = "anonymous"` before `img.src` so the
WebGL texture upload doesn't get blocked cross-origin). Atlas metadata
JSONs are imported as TS modules (`resources/atlases/foo-meta.json`) and
bundled.

The atlases are generated, never hand-edited: `npm run gen-atlases` (=
`npx tsx scripts/generateSpriteAtlases.ts`) rebuilds `unit-atlas.png`,
`icon-atlas.png`, `fx-atlas.png` and `fx-atlas-meta.json` from
`resources/sprites/` (+ `resources/images/*.svg` for icons); `--check`
verifies without writing. The column/row orders live in that script and
must match `UNIT_ORDER` (UnitPass), `STRUCTURE_ORDER` (StructurePass +
StructureLevelPass) and the `FX_*` indices (FxSpritePass). Unit sprites are
grayscale bands the shader recolours (180 territory / 130 mid / 100 centre /
70 border); `resources/sprites/gl/` holds the GL renderer's own small glyphs
where they differ from the legacy HUD sprites of the same name. Icon columns
are Chromium renders of the SVG (48px in a 64px cell); columns already in the
committed atlas are copied unchanged so a rebuild never churns anti-aliasing.

### Adding a unit type (checklist)

Sim side first — both lists are zbin wire order, so **append only**:

1. `UnitType` enum in `src/core/game/Game.ts` (append), a `UnitParamsMap`
   entry, and `unitInfo()` in `src/core/configuration/Config.ts`. `tsc` then
   points at every exhaustive `switch` (`PlayerImpl.canSpawnUnitType`, …).
2. `StatsSchemas.ts` only if the unit is counted in stats (append there too).

Client side:

3. `src/client/render/types/UnitType.ts`: a `UT_*` constant, append it to
   `ALL_UNIT_TYPES` (this is the header order the worker sends), and add it
   to the derived sets it belongs to (`STRUCTURE_TYPES`, `NUKE_TYPES`,
   `SMOOTHED_NUKE_TYPES` for lerped missiles, `NUKE_MAGNITUDES` for a
   telegraph circle).
4. Sprite: a grayscale PNG in `resources/sprites/` (or `sprites/gl/`), an
   entry appended to `UNIT_COLUMNS` in `scripts/generateSpriteAtlases.ts`,
   and the same name appended to `UNIT_ORDER` in `UnitPass.ts`. Structures
   instead: an SVG in `resources/images/`, `ICON_COLUMNS`, `STRUCTURE_ORDER`
   in both structure passes, and a `shapes` entry in `render-settings.json`.
   Then `npm run gen-atlases`.
5. `UnitPass.ts`: `MISSILE_TYPES` (draws above structures, smoothed) and
   `FLICKER_TYPES` (hot cycling colours) if it is a projectile.
6. Trails: `TRAIL_TYPES` in `src/client/view/GameView.ts`.
7. Death FX: `nukeExplosionRadius` in `fx-pass/FxSettings.ts` or a branch in
   `FxSpritePass.spawnFxForUnit` / `fx-pass/index.ts`.
8. Sounds: `SoundEffectController` (`onCreated` for a launch cue,
   `handleUnit` for an impact cue); new cues need `Sounds.ts` + an mp3.
9. HUD strings through `translateText()` + `resources/lang/en.json`.
10. Tests: client tests mock `PlayerView`/`UnitView` by hand — search
    `tests/client/` for the type lists they pin.

## Render settings

`render-settings.json` is the single source of truth for all per-pass tuning
constants. Passes read their slice (`settings.spawnOverlay`, `settings.bar`,
etc.) at construct time and use it in `draw`. The debug GUI in `gl/debug/`
gives a live-editable view of the same object during development.

Theme data (player/team palettes, color-derivation knobs) lives in sibling
theme JSONs (`gl/default-theme.json`, `gl/colorblind-theme.json`);
`createRenderSettings()` combines the active one with `render-settings.json`
into the `settings.theme` slice (the colorblind graphics override swaps the
slice in `applyGraphicsOverrides`). The theme module in `src/client/theme/`
builds its allocators and color derivations from the same theme JSONs — see
`ThemeProvider.ts`.

## Adding a new pass

1. Define any new types in `types/` if the pass needs new input shapes.
2. Add the pass class in `gl/passes/`. Follow the existing structure:
   uniform-location caching in the constructor, an `update`/`set*` API, a
   `draw(cameraMatrix, …)` method, and `dispose`.
3. Add its settings struct to `RenderSettings` in `gl/RenderSettings.ts` and
   defaults to `render-settings.json`.
4. Instantiate it in `GPURenderer`'s constructor and call its `draw` from the
   appropriate phase of `Renderer.render`.
5. Expose any needed setters on `MapRenderer` (gl/MapRenderer.ts).
6. Wire the data push from `WebGLFrameBuilder` or a controller — without
   this step the pass is dead code.
