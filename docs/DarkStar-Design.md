# Under a Dark Star — Design Reference

> **Purpose:** the single place a new session (human or Claude) reads to understand what we are
> building, what has been decided, what is still open, and where in the codebase the work lands.
> Keep it current: when a decision is made or changed, update the relevant section **and** the
> [Changelog](#11-changelog).
>
> Status tags: **[Decided]** = agreed with Tom · **[Proposed]** = a recommendation not yet confirmed ·
> **[Open]** = needs a decision.

## 1. Vision

**Under a Dark Star** ("DarkStar") is a sci-fi, real-time multiplayer territorial strategy game built
on a fork of [OpenFront](https://github.com/openfrontio/OpenFrontIO). OpenFront is a symmetric
land-grab: everyone starts small and the first to dominate the map wins.

DarkStar's differentiator is one asymmetric role, the **Hegemon**:

- The Hegemon begins each round in a position of **extreme strength** but **cannot grow further**.
- Every other player (a **challenger**) starts small, expands across the galaxy, and competes to
  **overthrow** the Hegemon.
- The round ends when the Hegemon is overthrown, **or** when a preset timer expires — in which case
  the reigning Hegemon wins.
- **The winner of a round is the Hegemon of the next round.**

This produces a king-of-the-hill meta-game across rounds: challengers must cooperate enough to bring
down the throne while racing each other to be the one who takes it.

**The fiction:** the Dark Star is a supermassive black hole at the centre of the galaxy, from which the
Galactic Hegemon rules. Its power is such that the Hegemon can unleash its energies to reverse the flow
of time itself, periodically resetting its enemies to a weak and manageable state — which is what the
start of every new round _is_. Challengers have one window (a round) to break the throne before time
is wound back again.

As of 2026-09-20 the fork differs from upstream by a title rename only (commit `e092b45fa`).
Everything below is forward-looking.

## 2. The round loop

```
        ┌──────────────────────────────────────────────────────────┐
        ▼                                                          │
 Lobby: Hegemon seat filled ──► Spawn phase ──► Play ──► Round ends ┘
 (previous winner, else AI)     Hegemon gets     │        │
                                its domain;      │        ├─ Hegemon eliminated → the challenger who
                                challengers      │        │   landed the killing blow wins
                                pick spawns      │        └─ Timer expires → Hegemon wins (keeps throne)
                                                 │
                           challengers expand, ally, betray,
                           and wear down the Hegemon
```

## 3. Decided rules

Agreed with Tom on 2026-09-20 (initial Q&A, then his answers to the first round of open questions).
Where a rule still has an unresolved detail it points at a follow-up in §4.

### 3.1 Round structure

- **R1 — Victory runs through the Hegemon.** A round ends in exactly two ways: the Hegemon is
  overthrown, or the timer expires. OpenFront's "own 80% of the land" rule is **removed**.
- **R2 — Overthrow = total elimination** of the Hegemon (it owns zero tiles).
- **R3 — Killing blow wins.** The challenger who eliminates the Hegemon wins the round and is the
  Hegemon of the next round. Because of the single-invader rule (H6) this is unambiguous.
- **R4 — Timer favours the throne.** If the timer expires with the Hegemon alive, the Hegemon wins and
  keeps the throne. In the fiction this _is_ the Hegemon's power: it unleashes the Dark Star to reverse
  time and reset its enemies to weakness (§1).
- **R5 — Default round length: 20 minutes** (tunable; engine supports 1–120 via `maxTimerValue`).
- **R6 — AI Hegemon fallback.** First round, or previous winner absent → a purpose-built AI holds the
  throne. This is also how singleplayer works.

### 3.2 The Hegemon

- **H1 — The Dark Star domain.** The Hegemon's territory is a **large circular region at the centre of
  every map** representing the supermassive black hole. Size guide: big enough that the Hegemon's name
  is **clearly legible on it when the whole map is zoomed out**. It is deliberately _not_ proportionate
  to the Hegemon's strength — the Hegemon is far stronger than its tile count would suggest.
  It is a **solid disc**: every tile within the radius becomes Hegemon-owned land, whatever the map had
  there (water and void are filled in), so it is a clean circle on any map.
- **H2 — Starting state.** Full troops (at its ceiling), a strong gold income, **no structures**.
- **H3 — Strength scales with the map, not the player count.**
- **H4 — Strength target.** The Hegemon's troop ceiling/regeneration and gold income should be roughly
  **25–40% of the whole map's potential**: clearly the strongest power at the start, but able to be
  overtaken. **Method:** these are explicit `Config` tunables that depend only on the map's land-tile
  count (H3), calibrated empirically — run AI-only games per map size, measure the challengers'
  combined troops/income at mid-round, and set the Hegemon to about **one third** of that. The numbers
  themselves are an M1 task (F1).
- **H5 — Strength is decoupled from territory.** The Hegemon's regeneration and ceilings **do not fall**
  as its domain is conquered, and an invader gains **no benefit** (no troop cap, income, etc.) from
  domain tiles it holds. **Troop bleed:** each domain tile the Hegemon loses costs it
  `troops ÷ the domain's ORIGINAL tile count` — a constant share per tile, however much it has already
  lost (the engine's own rule, `troops ÷ current tiles`, would bleed it faster as it shrank).
- **H6 — One invader at a time.** Only **two players can ever occupy the Dark Star at once: the Hegemon
  and one invader.** Invader status is defined purely by occupancy — the invader is whichever
  challenger holds any tile inside the domain. Everyone else can take part only indirectly, by donating
  troops to the invader — or to the Hegemon.
- **H7 — Invasion is the only way to kill the Hegemon.** The domain **cannot be harmed by nukes** — it _can_ be targeted, the nuke simply does nothing to domain
  tiles (decided 2026-09-20: better than making it untargetable) — and the engine's
  non-combat elimination paths (enclosed-cluster capture, the <100-tile mop-up handing tiles to
  neighbours) must not apply to the Hegemon.
- **H8 — No territorial growth.** The Hegemon never owns tiles outside the domain; it may retake domain
  tiles it has lost. It **may attack** challengers, but land it takes **reverts to neutral** ("razed").
- **H9 — Diplomacy.** The Hegemon **cannot ally** with anyone. It **can donate** to any player, and any
  player can donate to it (H6). This needs a change to the engine, where donation currently requires
  the two players to be allied or team-mates (`canDonateGold` / `canDonateTroops` → `isFriendly`).
- **H10 — Hegemon warships are purely defensive.** It can build warships, but they are hostile only
  towards the player currently invading the domain.
- **H11 — AI Hegemon personality.** Defensive by default; when its troops have sat at the ceiling for a
  while it may launch a punitive attack at the most powerful challenger.
- **H12 — Claiming and releasing the invasion slot.** The slot is claimed **when an invasion transport
  lands** on the domain (not at launch). It is held for as long as the invader holds **any** domain
  tile, and passes on only once they hold none — an invasion cannot simply "end" while the invader
  still occupies part of the Dark Star. Other players' transports already heading for the Dark Star
  **turn around the moment their attack becomes invalid** because someone else has landed (the engine's
  `BoatRetreatExecution` is the precedent; troops return home). After being **evicted**, a player
  cannot invade again for **5 minutes** — the cooldown starts at eviction, so a turned-back transport
  does not burn it. Choose the moment wisely.
- **H13 — The Dark Star fights back against a stalled invasion.** An invasion is **stalled** once the
  invader's territory inside the domain has not changed for **5 seconds** (tunable). From that point,
  **all of the Hegemon's troop income — including troops donated to it — is automatically sent into an
  attack on the invader** until they are evicted. While the invader is still advancing, the Hegemon
  defends normally. Consequently nobody can take a sliver of the domain and sit on the slot: a failed
  invasion is always pushed out, and domain tiles return to the Hegemon by reconquest, not by fiat.
  This is a rule of the role, applied identically to human and AI Hegemons.
- **H14 — The moat.** The Dark Star is separated from the rest of the map by a ring of "water" (deep
  space). The ring is **narrow**, so an invasion force launched from a well-chosen spot crosses quickly.
  Invasions therefore arrive by transport, and the domain has a shoreline (so the Hegemon can build
  ports for its H10 warships). _For now_ — may be revisited.
- **H15 — The Hegemon's job is the balance of power.** A human Hegemon steers the round: it stymies
  whichever challenger is becoming dominant before they can make a bid for the throne (razing attacks,
  H8) and can prop up their rivals (donations, H9). It is the counterbalance to every upstart.

### 3.3 Challengers

- **C1 — Elimination is not the end.** A challenger who loses all territory **stays in the game** and
  may **resettle unclaimed land** when some is available. Razing (H8, C2) keeps neutral land
  reappearing through the round, so there is somewhere to come back to.
- **C2 — Raids [Direction agreed, details open].** Challengers get an option to **raid** another player:
  an attack that razes territory back to neutral instead of claiming it.
- **C3 — Launch from the core.** At round start all challengers visibly **launch from the Dark Star to
  their starting territory** (an arc animation like the engine's nuke trajectories). Resettlement (C1)
  can reuse the same presentation.

### 3.4 Setting and delivery

- **S1 — Fiction.** The Dark Star is a supermassive black hole at the galactic centre, the seat of the
  **Galactic Hegemon**. Command of the Dark Star is command over the flow of time: the Hegemon is
  **immortal**, and whenever its enemies grow too powerful it reverses time and belittles them back to
  weakness. That is why its subjects are forever plotting to overthrow it — to install _themselves_ as
  the supreme immortal ruler. Time reversal is **lore only**: it explains the round reset (R4) and is
  not a player-activated ability.
- **S2 — Galaxy maps.** Star systems / nebulae are "land"; deep space is "water" crossed by fleets;
  true void is impassable. Engine terrain model reused unchanged.
- **S3 — Delivery order.** Singleplayer (vs AI Hegemon) and private lobbies first; public lobbies later.
- **S4 — Public release eventually.** §8 cleanup is tracked but does not block prototyping.
- **S5 — Long-term: Hegemon high scores** — most rounds won as Hegemon, longest reign streaks. Needs
  our own persistence (M6).

## 4. Open design questions

Tom expects more mechanics to emerge over time; this list is the current frontier, not the final one.
**Nothing blocks M1:** F2 is down to presentation/tuning and F5 has proposed numbers to confirm on a
test map. (F3, F4 and F10 were resolved on 2026-09-20 → H12–H14, S1.)

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Calibrating Hegemon strength (H4).** Approach is decided; the numbers are not. [Proposed placeholders, in `HEGEMON_DEFAULTS`] troop ceiling = 100% of what ONE player owning every land tile of the map as authored could field (`2·(L^0.6·1000+50000)`; Milky Way ≈ 5.0M), regeneration = the standard curve against that ceiling, gold = 100/tick per 50k land tiles (Milky Way ≈ 886). To settle while building M1: what counts as "mid-round" (10 of 20 minutes?), which AI mix and difficulty the calibration games use, whether one curve over land-tile count fits all map sizes, and where in the 25–40% band to start.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F2  | **Invasion slot — presentation and tuning (H6, H12, H13).** Rules are settled. Remaining: how the slot, the invader, the stall state and each player's cooldown are shown to everyone (HUD indicator); whether the forced counter-attack switches off again if a stalled invader resumes advancing; and playtest tuning of the 5 s stall threshold and the 5 min cooldown.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| F5  | **Domain and moat dimensions (H1, H14).** Intent is decided (large legible disc; thin moat); numbers are not. Implemented as tunables in `HEGEMON_DEFAULTS` (`domainRadiusPermille: 90`, `moatWidthPermille: 10`, `moatMinTiles: 15` → Milky Way: radius 157, moat 17), centred on the map centre, **confirmed by Tom in play 2026-09-20 (name legible at full zoom-out, moat reads well)**; the `info.json` override is deferred to M2. [Proposed] Express both as fractions of the map's shorter side so they scale with any map: **domain radius ≈ 8–10%** (on a 2000-tile-wide map that is a disc ~350 tiles across, ~100k tiles — the engine sizes name labels to territory, so this reads clearly at full zoom-out) and **moat width ≈ 1%, minimum ~15 tiles**, tuned so a transport crosses in a few seconds. Confirm by building a test map and looking at it. Maps declare the centre in `info.json` (`hegemon: { center, radius }`) with a computed centre disc as fallback. Still open: what terrain the domain is, and how it is drawn (accretion-disc shader vs. ordinary territory fill). |
| F6  | **Razing (H8, C2).** What happens to structures on razed land? Does the Hegemon pay normal troop costs for attacks that gain it nothing? What does a raid cost a challenger, and what stops raiding from being strictly better than conquering against a rival you can't hold ground from? Can a raid target the Hegemon's domain (presumably not — H6)?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F7  | **Resettlement (C1).** What does a returning player come back with (fresh starting troops? less each time?), is there a cooldown or a limit, where may they land, and what happens to their gold? Does the conqueror still get the engine's gold transfer on elimination? Engine impact: today "alive" means "owns tiles", and death deletes units, alliances and gold (`PlayerExecution.removeOnDeath`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| F8  | **Nukes around the Dark Star (H7).** Domain tiles are immune but targetable: a nuke aimed at them lands and does nothing [Decided]. Still open: Can the Hegemon itself build silos and nuke challengers, and if so is that land razed or merely irradiated? Are SAMs/defense posts available to it?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| F9  | **Donations (H6, H9).** Are donations open between _any_ two players now, or only to/from the Hegemon and to the current invader? Any limits to prevent a coalition funnelling everything into one super-invader — or is that the intended strategy?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| F11 | **Hegemon toolkit (H15).** The role is decided — balance-of-power counterweight. Are razing attacks and donations enough tools for it, or does the Hegemon need more (nukes — see F8; embargo-like edicts; visibility into challengers' strength)? How much of its fixed troop pool can it spend on punitive strikes before it leaves itself open to invasion — is that tension the intended core decision?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| F12 | **Edge cases.** Hegemon disconnects mid-round (AI takes over?); the invader disconnects; an AI challenger (Nation/Tribe) lands the killing blow (next round gets an AI Hegemon per R6?); team modes (probably out of scope at first).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| F13 | **Hegemon identity across rounds.** Beyond the high-score table (S5): titles, reign counter in the lobby, anything inherited besides the seat.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F14 | **Names.** Sci-fi names for units, structures, Tribes/Nations and resources (rename surface in §5.4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## 5. Engine foundation — what we reuse

Read `CLAUDE.md` and `docs/Architecture.md` first for the Intent → Turn → Execution model. The points
below are the parts of OpenFront that matter specifically for DarkStar.

### 5.1 Simulation (`src/core/`)

- **All balance lives in one class:** `src/core/configuration/Config.ts`. The per-player formulas —
  `startManpower(playerInfo)`, `startingGold(playerInfo)`, `maxTroops(player)`,
  `troopIncreaseRate(player)`, `goldAdditionRate(player)`, `attackAmount`, `unitInfo().cost` — already
  take the player as an argument and already branch on `PlayerType` (Bot / Human / Nation). Adding a
  Hegemon branch is structurally cheap.
- **Growth is applied in one place:** `src/core/execution/PlayerExecution.ts` `tick()` adds troops and
  gold each tick. Base gold income is flat per tick (not territory-scaled); territory matters through
  `maxTroops` (`2 * (tiles^0.6 * 1000 + 50000)` + 250k per city level) and structures.
- **Death = zero tiles.** `PlayerImpl.isAlive()`. Conquest goes through
  `GameImpl.conquerPlayer(conqueror, conquered)` (gold transfer, stats, `ConquestEvent`) — the natural
  hook for detecting the killing blow (R3), usually called from `AttackExecution.handleDeadDefender`.
- **Win check:** `src/core/execution/WinCheckExecution.ts` runs every 10 ticks: `maxTimerValue` expiry,
  170-min hard limit, or 80% land (`Config.percentageTilesOwnedToWin`). `GameImpl.setWinner` emits the
  `Win` update; `WinnerSchema` in `src/core/Schemas.ts` is `["player", clientID, …] | ["team", …] | ["nation", …]`.
- **Spawning:** `src/core/execution/SpawnExecution.ts` + `getSpawnTiles` in
  `src/core/execution/Util.ts` give every player a radius-4 disc (~45 tiles). The Hegemon needs a
  different path that grants a whole domain.
- **AI:** Bots are called **Tribes** (`TribeExecution.ts`); **Nations** are the smarter AI
  (`NationExecution.ts` + `src/core/execution/nation/*`, shared `utils/AiAttackBehavior.ts`), spawned
  from per-map manifests via `src/core/game/NationCreation.ts`. The AI Hegemon (R6, H11) would be a new
  behaviour built from these parts.

**Existing precedents for an asymmetric role:**

| Precedent                       | Where                                                                                   | Why it matters                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hostCheats` + `isLobbyCreator` | `Config.ts` (~line 695), `PlayerInfo` in `Game.ts`, `GameServer.start()`                | A per-player modifier keyed on a flag that the server stamps into `GameStartInfo.players`. An `isHegemon` flag would travel the same road.                              |
| `maxTimerValue`                 | `GameConfigSchema`, `WinCheckExecution`, HUD countdown in `GameRightSidebar.ts`         | The round timer already exists end-to-end, including last-minute flash + audio warning.                                                                                 |
| Doomsday Clock                  | `execution/DoomsdayClockExecution.ts`, `game/DoomsdayClock.ts`, `DoomsdayClockPanel.ts` | Reference implementation of a per-player state machine with its own config sub-object, `PlayerUpdate` flags, HUD panel and status icon. Model `HegemonExecution` on it. |
| Overtime                        | `Config.percentageTilesOwnedToWin`, `OvertimePanel.ts`                                  | A win threshold that changes with elapsed time.                                                                                                                         |
| Humans vs Nations               | `Game.ts` team presets, `GameImpl.populateTeams`                                        | One side being a different _kind_ of player.                                                                                                                            |
| Spawn immunity                  | `PlayerImpl.isImmune`, `canAttackPlayer`                                                | Per-player "cannot be attacked (yet)".                                                                                                                                  |

### 5.2 Round-to-round continuity (`src/server/`, `src/client/`)

**Nothing carries over between games today.** `GameManager` drops finished `GameServer`s; the only
persistence was OpenFront's closed-source API, which we do not have.

- **The winner is a client vote.** The sim runs on clients, so each client sends
  `{type: "winner"}`; the server resolves an IP-weighted majority (`src/server/Consensus.ts`
  `WinnerVote`, `GameServer.handleWinner`) and then `archiveGame()`. `winner[1]` is a per-game
  `clientID`; map it to the stable `persistentID` through the roster.
- **Private lobbies — the first multiplayer target.** The successor-lobby flow already exists:
  `POST /api/create_game?previous=<gameID>` in `src/server/Worker.ts` has the finished game in memory,
  verifies the creator, and broadcasts `new_lobby` to everyone still connected. Passing the previous
  winner forward as the next game's Hegemon needs **no new persistence**. Today the successor inherits
  nothing (not even config) — we would add config inheritance plus the Hegemon key.
- **Singleplayer.** `src/client/LocalServer.ts` sees the winner message; `src/client/SinglePlayerModal.ts`
  builds `gameStartInfo` client-side. Persisting "you are the reigning Hegemon" needs a new
  `localStorage` key (no results store exists). With one human, the loop is: beat the AI Hegemon →
  next round you defend the throne against AI challengers.
- **Identity.** `clientID` is per-join (useless across rounds). `persistentID` (localStorage UUID, or
  the JWT `sub`) is the only stable key available without the API — treat it as a secret, never
  broadcast it. `publicId` requires the API.
- **Public lobbies (later).** Needs our own results store (replace/shim `src/server/Archive.ts`), a
  promotion hook off `archiveGame()` (inject through `GameServerDeps`), propagation across worker
  processes (`IPCBridgeSchema.ts`, `MasterLobbyService.ts`), and a product answer to "which public
  game's winner is _the_ Hegemon?".

### 5.3 Maps

- A map is a folder: `map-generator/assets/maps/<name>/image.png` + `info.json`; run `npm run gen-maps`
  (Go tool — read `map-generator/README.md` and `docs/Maps.md`). Outputs land in `resources/maps/<name>/`
  and `src/core/game/Maps.gen.ts` (generated — do not hand-edit; the `map` section of `en.json` is
  generated too).
- Only the **blue channel** matters: blue = 106 or transparent → water (deep space); blue 140–200 →
  land with rising elevation (plains → highland → mountain); `#000000` → impassable void.
- Already shipped: a `cosmic` map category with `milkyway`, `sol`, `mars`, and others — useful
  references. `info.json` supports free-text nation names with no flag, `"themes": ["space"]` for
  Tribe names, and `custom_tribes`.
- **Gaps for DarkStar:** (1) no way to mark a **Hegemon domain** on a map — [Proposed] an extra mask
  layer or region in `info.json`; (2) terrain colours are global, not per-map, and map thumbnails are
  hard-coded blue-sea/green-land in `map-generator/map_generator.go` (`getThumbnailColor`).

### 5.4 Presentation

- **Renderer:** hand-written **WebGL2** (not Pixi.js) — `src/client/render/`, documented in
  `src/client/render/CLAUDE.md`. HUD is Lit components in `src/client/hud/layers/`.
- **Colours are data:** terrain palette in `src/client/render/gl/render-settings.json` (`terrain.*`,
  overridable via `TerrainColorOverrides` → `TerrainPass.setTerrainColors`); player palettes in
  `src/client/render/gl/default-theme.json`. A DarkStar theme is mostly a new JSON file.
- **Sprites:** committed atlas PNGs in `resources/atlases/` (`unit-atlas`, `icon-atlas`, `status-atlas`
  \+ meta JSON, `fx-atlas`). The generator script they reference is missing from the repo — repaint in
  place, preserving the grid. A Hegemon marker = new `status-atlas` icon (crown is the precedent) wired
  through `src/client/hud/PlayerIcons.ts`.
- **Text:** `resources/lang/en.json` only (other locales are Crowdin-managed). Roughly 150–250 strings
  carry real-world/military flavour (`unit_type`, `build_menu`, `events_display`, `help_modal`, …).
  **Rename display strings, never enum values** (`UnitType`, `GameMapType`, `PlayerType` values are
  wire/replay format).
- **Names:** Tribe names from `resources/tribeNameThemes.json` (a `space` theme exists); anonymised
  player names in `src/core/AnonNames.ts` (guarded by a word-distance test).
- **Audio:** Howler; effects in `resources/sounds/`, registry in `src/client/sound/Sounds.ts`. Music is
  in `proprietary/` and must be replaced (§8).

## 6. Likely touch points for the Hegemon role

| Area          | File                                                                                                         | Change                                                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config schema | `src/core/Schemas.ts`                                                                                        | `hegemon: {…}` sub-object on `GameConfigSchema` (mirror `doomsdayClock`); `isHegemon` on `PlayerSchema` / `PlayerRecordSchema` (replays depend on it); possibly a Hegemon `Winner` kind.                                                                   |
| Role          | `src/core/game/Game.ts`, `PlayerImpl.ts`                                                                     | `isHegemon()` on `PlayerInfo`/`Player` [Proposed: a flag, not a new `PlayerType`, so a Human _or_ AI can hold it]; domain tile set; raze instead of conquer outside the domain (H8); decouple strength from tiles (H5); no alliances, open donations (H9). |
| Balance       | `src/core/configuration/Config.ts`                                                                           | Hegemon branches for start troops/gold, ceilings, regen.                                                                                                                                                                                                   |
| Spawn         | `src/core/execution/SpawnExecution.ts`, `utils/PlayerSpawner.ts`, `GameRunner.ts`                            | Grant the domain at game start; register `HegemonExecution`; keep challengers out of the domain during spawn.                                                                                                                                              |
| Rules engine  | new `src/core/execution/HegemonExecution.ts`                                                                 | Enforce caps, track damage/killing blow, drive role state and events.                                                                                                                                                                                      |
| Win           | `src/core/execution/WinCheckExecution.ts`, `GameImpl.ts` (`conquerPlayer`, `setWinner`)                      | R1–R4: remove the 80% rule; Hegemon immune to cluster capture and mop-up hand-offs (H7).                                                                                                                                                                   |
| Client sync   | `src/core/game/GameUpdates.ts`, `GameUpdateUtils.ts`                                                         | Carry the Hegemon flag/state in `PlayerUpdate`.                                                                                                                                                                                                            |
| AI            | new behaviour under `src/core/execution/nation/` or alongside `NationExecution.ts`                           | AI Hegemon (R6, H11); teach Nations/Tribes to treat the Hegemon as the objective.                                                                                                                                                                          |
| Server        | `src/server/GameServer.ts` (`start()`), `Worker.ts`, `GameManager.ts`                                        | Stamp `isHegemon` into `GameStartInfo.players`; successor-lobby hand-off of the winner.                                                                                                                                                                    |
| Singleplayer  | `src/client/LocalServer.ts`, `SinglePlayerModal.ts`                                                          | Persist/reload the throne locally.                                                                                                                                                                                                                         |
| HUD           | `hud/layers/WinModal.ts`, `GameRightSidebar.ts`, `PlayerStats.ts`, `hud/PlayerIcons.ts`, `HostLobbyModal.ts` | Victory screen ("The Hegemon has fallen" / "The Hegemon endures"), themed countdown, Hegemon marker + leaderboard emphasis, lobby options.                                                                                                                 |
| Tests         | `tests/` (use `tests/util/Setup.ts`)                                                                         | **Mandatory** for every `src/core` change.                                                                                                                                                                                                                 |

Additional touch points implied by the 2026-09-20 rules:

- **Single-invader lock (H6):** `PlayerImpl.canAttackPlayer` / `AttackExecution.init` (land) and
  `TransportShipExecution` (boat landings) must consult the invasion slot held by `HegemonExecution`,
  which also tracks the per-player 5-minute invasion cooldown (H12).
- **Stall response (H13):** `HegemonExecution` detects a stalled invasion and, each tick, diverts the
  Hegemon's troop regeneration into an `AttackExecution` against the invader's domain tiles. This is
  automatic for human and AI Hegemons alike (it is a rule, not AI behaviour).
- **Hegemon un-nukable (H7):** target validation in `NukeExecution` / `MIRVExecution` and nuke tile
  damage; also exempt the Hegemon from `PlayerExecution.removeClusters` and from the neighbour
  hand-off in `AttackExecution.handleDeadDefender`.
- **Razing (H8, C2):** `AttackExecution` conquers tile-by-tile via `conquer()`; a raze mode would
  `relinquish()` the tile to terra nullius instead. A raid is a new intent (`Schemas.ts` +
  `ExecutionManager.ts`) and a radial-menu entry.
- **Open donations (H9):** relax the `isFriendly` check in `PlayerImpl.canDonateGold` /
  `canDonateTroops`; forbid Hegemon alliances in `AllianceRequestExecution`.
- **Defensive warships (H10):** targeting in `WarshipExecution`.
- **Resettlement (C1):** "alive" currently means "owns tiles" (`PlayerImpl.isAlive`), and
  `PlayerExecution.removeOnDeath` wipes units/alliances/gold and deactivates the player. Needs a new
  "exiled" state plus a re-spawn path through `SpawnExecution` outside the spawn phase.
- **Launch opening (C3):** presentation only — `NukeTrajectoryPass` in `src/client/render/gl/passes/` is
  the visual precedent.

### 6.1 As built — Slice 1 (2026-09-20)

Hegemon mode is `GameConfig.hegemon.enabled` (off by default, **FFA only**; the singleplayer modal turns
it on). With it off the sim is bit-identical to before: no extra player, no PRNG draws.

- **Terrain:** `src/core/game/DarkStar.ts` (pure geometry + generator). `GameImpl`'s constructor carves
  the disc and moat **before** `WaterManager` is built, so water components and the nav graph come from
  final terrain — runtime conversion through `WaterManager` could not fill water, clear void, or split
  components. Shoreline/ocean/magnitude bits are re-derived with WaterManager's own rules; the minimap
  follows the map generator's water > impassable > land rule. The **ocean bit is set by true
  connectivity only**: a landlocked moat is a lake, and transports cross it regardless (they route by
  water component). Generation is idempotent because terrain maps are cached per process.
- **Client sync:** clients load the pristine map and only apply tile deltas, so the changed tiles are
  held and emitted as ordinary packed tile updates on the **first tick**.
- **Domain membership is geometric** — `Game.isInDarkStar(tile)`, `d² ≤ r²` from `Game.darkStar()`; no
  tile bit, nothing on the wire.
- **The seat:** a human flagged `isHegemon` (`PlayerSchema` → `PlayerInfo` → `Player.isHegemon()` →
  `PlayerUpdate` → `PlayerView`), else an AI seat made inside `GameImpl`: `PlayerType.Nation`, id
  `HEGEMON0`, name "The Hegemon", **not** in the nation list, so no `NationExecution` drives it. It owns
  the whole domain and full troops from tick 0. Map nations placed on the Dark Star (Milky Way's
  "Sagittarius A\*") lose their cell and spawn at random. `HegemonExecution` (the future rules engine)
  registers the seat's `PlayerExecution`. Server-side stamping of `isHegemon` is M3.
- **Strength:** `Config.hegemonMaxTroops()` / `hegemonGoldPerTick()` from the map's land tiles **as
  authored** (`setHegemonMapLandTiles`, set by `GameImpl` and by `GameView`); branches in `maxTroops`,
  `troopIncreaseRate`, `goldAdditionRate`. Troop bleed: `AttackExecution.attackLogicInput` costs a
  Hegemon defender as holding `domainTileCount` tiles.
- **Fortress [Decided 2026-09-20; values tunable — 500/1000 felt slow to Tom once playtested, now 300/300
  alongside the counter-attack]:** taking a domain tile _from the Hegemon_ costs the attacker
  `domainAttackerLossPercent` (300) and goes `domainConquestSlowPercent` (300) slower — the engine's
  defense-post idea applied to the whole domain (`AttackLogicInput.hegemonDomain`). The Hegemon retaking
  its own tiles meets no such resistance. Why: in this engine troops only make each tile costly, so the
  domain's _tiles_ ran out long before the Hegemon's _troops_ — measured on the World map, a full-strength
  Hegemon (6.26M) lost all 25k tiles in ~40 s and died with 3.5M troops unspent.
- **Calibration harness:** `npx tsx tests/perf/fullgame/HegemonSim.ts --map world [--loss --slow
--ceiling --minutes --bots]` plays an AI-only round headlessly (~30 s) and logs the Hegemon against its
  challengers, every 5 s while the Dark Star is under attack. Troop figures in the sim are 10× what the
  HUD shows (`renderTroops` divides by 10).
- **Win:** `WinCheckExecution.checkWinnerHegemon` — slayer wins (`GameImpl.conquerPlayer` records
  `hegemonSlayer()`), else the Hegemon wins at `maxTimerValue ?? 20` minutes; no 80% path. The Doomsday
  Clock is not registered in hegemon mode.
- **Guards:** no <100-tile mop-up and no enclosed-cluster capture of the Hegemon, nuke detonations skip
  domain tiles, no alliance requests to or from the Hegemon, a Hegemon cannot re-spawn.
- **Engine gotcha:** an execution added from another execution's `init()` is silently dropped — add from
  `tick()`.

### 6.2 As built — invasion slot and counter-attack (2026-09-20)

- **The slot is occupancy (H6, H12).** `GameImpl` counts domain tiles held by anyone but the Hegemon
  (`conquer`/`relinquish` → `domainTileChanged`); whoever is in that map is `darkStarInvader()`.
  `canInvadeDarkStar(player)`: nobody holds the slot (or the player does) and the player's cooldown has
  run out. Losing the last domain tile is eviction and starts the 5-minute cooldown
  (`invasionCooldownTicks`). The gate sits in `canBuildTransportShip` (so the UI and the AI never offer
  the boat) and in `TransportShipExecution`: launch is refused with a message, and a fleet already under
  way **turns back the moment someone else lands**, comes home with no retreat losses, and burns no
  cooldown. Land attacks need no gate: the moat means only the invader borders the Hegemon.
- **The Dark Star's response (H13), in `HegemonExecution`.** [Decided 2026-09-20] An **AI** Hegemon answers
  a landing **at once**: a wave of `responseWavePercent` (20%) of its troops, repeated every
  `responseWaveSeconds` (10 s) while the invader holds domain tiles; a human Hegemon runs its own
  defence. For **any** Hegemon, once the invasion has **stalled** (no domain tile gained for
  `invasionStallSeconds`, 5 s — `lastInvaderGainTick()`), a wave is forced and from then on the Hegemon's
  troops are pinned: everything it gains (regeneration, donations, returning troops) is sent after the
  invader once a second. [Decided — F2] If the invader **advances again the forced routing switches
  off** until the next stall; troops already committed stay in the fight. Opposing attacks cancel troop
  for troop in this engine, so the counter-attack spends the Hegemon's army directly against the
  invader's — this is what makes its troop pool matter.
- **Measured (World, AI-only, 300/300):** one invader only; the front moves both ways for ~4 minutes; the
  Hegemon spends 6.2M → ~2.2M troops and falls at ~18:10. On Milky Way the AI never invades and the
  Hegemon wins on the timer.
- **Still missing:** HUD for the slot/stall/cooldown (F2, M2); the invader gains nothing from domain tiles
  (H5); an all-in last stand (the Hegemon still dies with ~2M troops unspent, since waves are a share of
  what is left); AI nations rarely invade before minute ~13.

## 7. Constraints (non-negotiable engineering rules)

- `src/core/` must stay **deterministic** (seeded PRNG, no wall-clock, careful with floats) and
  dependency-free; every core change ships with tests that exercise the real simulation.
- All user-visible text goes through `translateText()` with an `en.json` entry. Do not edit other locales.
- Schema changes alter the zbin binary wire format — client and server ship together (already enforced
  by the git-commit version gate). Anything that is a simulation input must also be in the game record
  or replays desync.
- **No OpenFront API.** Accounts, `publicId`, cosmetics/store, clans, friends, ranked, leaderboards,
  replays and game archiving all depend on it. In dev mode the code fails open, but finished-game
  records are currently logged and **dropped**.
- Use `npm run inst`, never `npm install`.

## 8. Licensing & branding obligations

Source: `LICENSE`, `LICENSE-ASSETS`, `LICENSING.md`, `proprietary/LICENSE`. Not legal advice — re-read
these before any public release.

- **Code: AGPL-3.0.** Hosting a modified server publicly obliges us to offer our source to players.
- **AGPL §7 terms:** keep **"© OpenFront and Contributors"** reasonably visible (footer / loading
  screen); do **not** use "OpenFront" as the primary title or imply endorsement. (The rename to
  "Under a Dark Star" is therefore required, not just branding.)
- **`resources/`: CC BY-SA 4.0** — attribute OpenFront; derivative assets are share-alike.
- **`proprietary/`: All Rights Reserved** — OpenFront logos, `OpenFront.ttf`, favicon, menu/gameplay
  music, game-start alert. **Must be replaced or removed before public release.** The `Dockerfile` and
  build currently copy them in.
- **Strip before release:** ads/analytics (`HomepagePromos.ts`, `Admiral.ts`, `AdGatekeeper.ts`,
  `InGamePromo.ts`, gtag/Playwire in `index.html`), store/payments/cosmetics/clans UI that depends on
  the API, OpenFront Discord/wiki/YouTube/Steam links (`Footer.ts`, `WinModal.ts`, `Utils.ts`),
  `index.html` canonical/OpenGraph tags, PWA manifest, `package.json` name.

## 9. Roadmap [Proposed]

| Milestone | Goal                                                                                                                                                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M1**    | Hegemon core in the sim, with tests: role flag, central domain (H1–H3), map-scaled strength decoupled from tiles (H4–H5), single-invader rule (H6–H7), razing attacks (H8), no alliances + open donations (H9), win logic (R1–R5). Playable in singleplayer against a basic AI Hegemon (H11) on an existing map. Built as the five slices below. |
| **M1.5**  | Challenger systems: resettlement after elimination (C1), raids (C2), defensive-only Hegemon warships (H10).                                                                                                                                                                                                                                      |
| **M2**    | First galaxy map authored around the Dark Star; HUD: Hegemon marker, invasion-slot indicator, round countdown, victory screens; launch-from-the-core opening (C3).                                                                                                                                                                               |
| **M3**    | Succession: private-lobby hand-off through the successor-lobby flow; singleplayer throne persistence.                                                                                                                                                                                                                                            |
| **M4**    | Sci-fi re-theme: strings, palette/theme JSON, atlases, names, audio.                                                                                                                                                                                                                                                                             |
| **M5**    | Release hygiene: §8 cleanup, remove/stub API-dependent features, local game archive.                                                                                                                                                                                                                                                             |
| **M6**    | Public lobbies with a persistent Hegemon (own persistence + identity).                                                                                                                                                                                                                                                                           |

**M1 slices** (each independently testable):

| Slice | Goal                                                                                                                                                                                                                                                 | Status               |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1     | **The throne exists:** `hegemon` config + `isHegemon` flag, disc/moat terrain, seated passive AI Hegemon, fixed map-scaled strength, troop bleed, win rules R1–R5, cheap guards (no mop-up/cluster capture/nuke damage on the domain, no alliances). | **Built 2026-09-20** |
| 2     | **Invasion economics:** the invader gains nothing from domain tiles (H5); units standing on the domain survive nukes too (rest of H7).                                                                                                               |                      |
| 3 ✔   | **Single-invader slot:** claimed on landing, held while any domain tile is held, inbound transports turn back, 5-minute cooldown from eviction (H6, H12).                                                                                            |                      |
| 4     | **The Dark Star fights back, razing, diplomacy:** stall detector and forced counter-attack (H13), raze mode (H8), open donations (H9).                                                                                                               |                      |
| 5     | **AI Hegemon + calibration:** punitive strikes (H11), Nations/Tribes treat the Hegemon as the objective, headless F1 calibration, private-lobby toggle.                                                                                              |                      |

Confirm F5 on a test map early in M1 (F1 is calibrated during it); F6–F7 before M1.5; the rest can be
settled by playtesting.

## 10. Glossary

| Term                          | Meaning                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| **Hegemon**                   | The asymmetric ruler role: starts dominant, cannot expand. One per round. Human or AI.     |
| **Challenger**                | Any non-Hegemon player.                                                                    |
| **Dark Star / Domain**        | The central black-hole region: the Hegemon's territory, the only tiles it may ever own.    |
| **Invader**                   | The single challenger currently allowed to attack the domain.                              |
| **Raze / Raid**               | An attack that returns land to neutral instead of claiming it.                             |
| **Resettle**                  | An eliminated challenger re-entering the round on unclaimed land.                          |
| **Overthrow**                 | Eliminating the Hegemon (zero tiles).                                                      |
| **Killing blow**              | The conquest that eliminates the Hegemon; its owner wins the round.                        |
| **Round / Reign**             | One game / the consecutive rounds a player holds the throne.                               |
| **Tribe**                     | Engine term for a simple bot (`PlayerType.Bot`).                                           |
| **Nation**                    | Engine term for the smarter, map-defined AI (`PlayerType.Nation`).                         |
| **Intent / Turn / Execution** | Player action → server-bundled tick of intents → deterministic sim object that applies it. |

## 11. Changelog

- **2026-09-20** — Document created from the initial design Q&A; roadmap proposed.
- **2026-09-20** — Tom answered the first round of open questions (then numbered O1–O12). §3 rewritten
  as rules R/H/C/S: central Dark Star domain, map-scaled strength decoupled from territory,
  single-invader rule, no nukes on the domain, razing, no Hegemon alliances + open donations,
  defensive warships, 20-minute rounds, 80% rule removed, resettlement, raids, launch-from-core opening,
  time-reversal fiction, long-term high scores. §4 replaced with follow-ups F1–F14; roadmap gained M1.5.
- **2026-09-20** — Second round of answers. Added H12 (5-minute invasion cooldown, slot released when the
  invader has no active attack), H13 (stalled invasions draw the Hegemon's entire troop production until
  evicted), H14 (narrow deep-space moat around the Dark Star), H15 (Hegemon as balance-of-power
  counterweight); H4 gained its calibration method (~⅓ of challengers' mid-round strength, map-scaled
  tunables); S1 expanded — time reversal is lore only. F3/F4/F10 closed; F1/F2/F5/F11 narrowed.
- **2026-09-20** — Third round of answers. Invasion slot is now occupancy-based: claimed when a transport
  lands, held while the invader owns any domain tile, so only the Hegemon and one invader can ever occupy
  the Dark Star (H6, H12). Hegemon troop income, donations included, is auto-routed into reclaiming the
  domain during an invasion; stall threshold ~5 s without a tile gained (H13). Domain sized so the
  Hegemon's name is legible at full zoom-out; thin moat (H1, H14) — proposed numbers recorded in F5.
- **2026-09-20** — Invasion rules finalised: the forced counter-attack (all Hegemon troop income, donations
  included) begins only once the invasion has stalled — no territory change for 5 s (H13); transports
  bound for the Dark Star turn around the instant another player claims the slot; the 5-minute invasion
  cooldown starts at eviction (H12). F2 reduced to HUD presentation and tuning.
- **2026-09-20** — M1 split into five slices (§9) and **Slice 1 built** (§6.1). Decided: the domain is a
  solid disc carved into any map, with a carved moat (H1); troop bleed is troops ÷ the original domain
  tile count (H5). Proposed and implemented as tunables: domain/moat sizes (F5) and placeholder strength
  formulas (F1).
- **2026-09-20** — Tom playtested Slice 1: disc, moat and round end confirmed. Decided: the Dark Star stays
  **targetable** by nukes, which simply do nothing to it (H7, F8); target validation/UI refusal dropped.
- **2026-09-20** — First calibration runs (`HegemonSim.ts`). Findings: the domain fell in ~40 s once invaded,
  with most of the Hegemon's army unspent; by minute ~11 a single AI challenger out-musters the fixed
  ceiling; AI nations ignore the Hegemon until then. Added the [Proposed] fortress multipliers (500% attacker
  loss, 1000% slower) — at those values an AI invasion on World is a several-minute fight. Ceiling still open (F1).
- **2026-09-20** — Tom playtested the fortress multipliers (500% / 1000%): invasion pacing "feels much better". Kept.
- **2026-09-20** — Slice 1 playtest complete: F5 sizes confirmed, spawn blocking, timer win screen and
  first-tick performance all good. Fixed: large-domain maps (Europe, Milky Way; ~70k+ domain tiles) failed to
  launch in the browser — a `push(...domainTiles)` spread overflowed the Web Worker's stack (Node's is larger,
  so tests and the headless sim never saw it).
- **2026-09-20** — Invasion slot (H6, H12) and the Dark Star's counter-attack (H13) built, ahead of the
  documented slice 2 (§6.2). Decided: an AI Hegemon counter-attacks on landing, H13's forced routing applies
  to any Hegemon on stall, and it switches off if the invader advances again (F2). Fortress multipliers
  lowered to 300/300 (500/1000 felt slow in play).
