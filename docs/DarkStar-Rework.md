# Under a Dark Star — Tithes, warheads, shields and the gate network

> **The rework**: four changes Tom decided on 2026-10-25 that reshape the throne's economy, the
> missile game, defence and the stargate. They are written here as one plan because they lean on
> each other. The tithe makes gold dangerous to hold. The Antimatter Reaction is the one warhead a
> shield cannot stop (reversed the same day: shields stop both). A shield grows to cover a whole Gamma Ray Burst. The gate becomes the road
> for gold and troops as well as for war. Companion to `DarkStar-Design.md` (H2, H4, H6, H9, H18,
> H19, C4, C5, S6); **F25** in the design doc's table points here. Rule ids are **TI** (tithes),
> **WH** (warheads), **SH** (shields), **GN** (the gate network) and **RW** (the roadmap).
> Changelog at the end.
>
> Status tags as in the design doc: **[Decided]** · **[Proposed]** · **[Open]**. **RW0-RW4 are
> built** (2026-10-25, branch `feat/rework`, released together); RW5 is the balance pass. When a step is built, its rules move into the design doc with a `[Built …]` note
> and this document records the step as done.

## 1. Why

- **The throne needs more to do, and gold should be spent, not banked.** Today the Hegemon's gold
  arrives without any action from it (the 3% shadow tax, H4) and challengers can hoard freely.
  The tithe gives the throne an aimed tool that pays out and punishes hoarding, and gives every
  challenger a reason to keep their gold working.
- **Two warheads that do different things.** Today the Nuclear and Antimatter Warheads do the
  same thing at two sizes. After the rework one is the **area weapon** (Gamma Ray Burst) and the
  other is the **surgical, permanent one** (Antimatter Reaction): it erases the ground itself
  and, as first decided, the one warhead a shield cannot stop (reversed 2026-10-25: shields
  stop both).
- **Defence in one line of buildings.** The Shield Array becomes the top of the Defense Post
  rather than a separate building, and its shield grows to the full size of a Gamma Ray Burst.
- **The stargate as a network.** A gate already decides how far your warheads and troops can
  reach. It now also decides whom you can supply, ally or not, so upgrading a gate widens your
  circle of clients as well as your reach.
- **Special lobbies are off for now** (Tom, 2026-10-25). With them goes the only place the Void
  missiles option was rolled, which the Antimatter Reaction makes redundant.

## 2. Tithes

### 2.1 Rules [Decided 2026-10-25]

- **TI1 — The tithe strike.** The Hegemon may launch a **tithe** at any tile outside its domain.
  It flies from the **Dark Star's centre** as a visible projectile on the strike's arc, at the
  strike's speed, with a **ring of radius 50 tiles** drawn on the aim tile from launch to
  landing, so everyone can see where it will land.
- **TI2 — Who pays.** When the tithe **lands**, every challenger (humans, Lords and Barons alike)
  who owns **at least one tile within 50 tiles** of the landing tile pays **all of its gold above
  500k** to the Hegemon. A player at or below 500k pays nothing. The amount is worked out
  **at landing, not at launch**: a player who sees the ring and spends their gold before it
  lands pays nothing. That is intended counterplay, not a loophole. **[Revised 2026-10-25,
  built]** A payer gives **half** of its gold above 500k: with 1M it pays 250k. (An allowance of
  250k per Population Center level was tried the same day and dropped as too generous.)
- **TI3 — The reserve is meant to be low.** At 500k a player cannot save up for a Shield Array
  (2M) or a warhead (5M) without being exposed to a tithe. That is deliberate: the throne can
  keep a troublesome player from ever affording the expensive buildings, and tithing hoarders
  is the point. [Revised 2026-10-25] Softened by the half share and the Population Center
  allowance (TI2): builders keep more, hoarders still lose.
- **TI4 — Shields do not stop a tithe.** A Shield Array's perimeter does not keep a tithe out.
- **TI5 — Cooldown.** **One tithe in flight at a time.** The next may be launched **10 s after
  the last one lands**.
- **TI6 — In addition to the shadow tax.** The 3% shadow tax (H4) stays as it is, at least until
  `HegemonSim` and play show what tithes bring in.
- **TI7 — Where it is ordered.** The tithe sits in the Hegemon's **stargate submenu** of the
  radial menu (the attack slot, where its warheads already are), on the clicked tile. The
  tooltip shows the cooldown. **[Decided 2026-10-25]** It also shows the players the ring would currently
  touch and what they would pay if it landed now.
- **TI8 — A human Hegemon may tithe from the first second of play**, in every game mode.
- **TI9 — The AI Hegemon** tithes **once a minute**, starting in the round's **second minute**
  (after one minute of play), whenever a target is worth it (some challenger above 500k). It
  aims at the **richest such player**. **[Decided 2026-10-25]** It aims at that player's name position
  (the centre of its largest territory). A smarter aim, the tile whose ring catches the most
  excess gold, is a later improvement.
- **TI10 — Lords hold their gold lightly when a tithe is coming.** A Lord whose territory a live
  tithe ring touches spends down to 500k before it lands: building and upgrading in its usual
  order, with its usual savings for a warhead suspended. Lords should be very good at this.
  Barons do not react.
- **TI11 — Dodging by charity is fine.** A player under the ring may give their gold away
  instead of spending it (to anyone in their gates' reach, GN1). Giving gold away is spending
  it, which is the behaviour the tithe exists to cause.

### 2.2 Details [Decided 2026-10-25]

- **Messages.** The tithed player gets an event line ("The Hegemon's tithe took 1.2M gold"); the
  Hegemon gets one total ("Tithe collected 3.4M from 3 players", or "…from no one").
- **Sound.** Tom's cue (`TitheSound.mp3`, 2026-10-25). Audience, following S8: the throne
  hears its own launch, and every player the ring touches hears it at launch.
- **Corsairs** own no territory, so a tithe never touches them.
- **Measurement.** `HegemonSim` prints the gold the throne takes from tithes next to the shadow
  tax, so the shadow tax's future (TI6) can be decided on numbers.

### 2.3 Engine touch points

- A new `tithe` intent (`Schemas.ts`, zbin wire) and a `TitheExecution` that owns the flight.
  The flight reuses the `Projectile` unit the strike and the gate shot already use (§6.9),
  with a new flight kind so the client can draw the 50-tile ring through the nuke telegraph
  pass.
- Landing: one pass over the tiles within the radius (integer squared distance; about 7,850
  tiles) to collect the owners, then the transfer in `bigint`. Deterministic, no floats.
- Cooldown and the one-in-flight rule live on the Hegemon (`HegemonExecution` or `PlayerImpl`),
  and the game exposes live tithes so Lords can see them (TI10, `NationStructureBehavior`).
- AI Hegemon: a timer in `HegemonExecution` next to the strike logic.
- Client: an entry in `attackMenuElement`'s submenu for the Hegemon (`RadialMenuElements.ts`),
  the ring (`NukeTelegraphPass`), event lines and `en.json` keys.
- Constants in a `TITHE_DEFAULTS` block in `Config.ts`: `radius` 50, `reserve` 500k,
  `cooldownSeconds` 10, `aiFirstSeconds` 60, `aiIntervalSeconds` 60.

## 3. Warheads: Gamma Ray Burst and Antimatter Reaction

### 3.1 Rules [Decided 2026-10-25]

|                       | **Gamma Ray Burst**                                                               | **Antimatter Reaction**                                                                       |
| --------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Replaces              | the Antimatter Warhead (hydrogen bomb)                                            | the Nuclear Warhead (atom bomb)                                                               |
| Cost                  | 5M                                                                                | 5M                                                                                            |
| Launched from         | the nearest ready stargate in range (C4); the throne's from the Dark Star         | the same                                                                                      |
| Blast                 | today's Antimatter Warhead blast: radius 100 (inner 80)                           | **inner 12, outer 30** (rev.)                                                                 |
| What it does          | clears the nebula (it becomes neutral, with fallout), kills troops and structures | **erases the nebula**: every tile in the circle becomes **deep space**, with everything on it |
| Shield Array          | **kept out**: nothing inside the shield is harmed (SH3)                           | **kept out** (rev. 2026-10-25)                                                                |
| Punitive strike (H19) | flags the gate; levy **25%**                                                      | flags the gate; levy **25%**                                                                  |

- **WH1 — The Nuclear Warhead is gone.** There is no longer a 1M missile; both warheads cost 5M.
- **WH2 — ~~The Antimatter Reaction is the shield breaker.~~ [Reversed 2026-10-25, Tom, built]**
  Shields keep the Antimatter Reaction out like the Gamma Ray Burst (it made the Reaction too
  strong and shields too weak), and its blast is the old Nuclear Warhead's (inner 12, outer 30)
  instead of 10 tiles. The ways to end a shield are troops: conquest takes the post intact (SH4),
  and a Hegemon strike that takes the post's tile destroys it when its bubble pops (H8).
- **WH3 — The Dark Star is still unharmed (H7).** Neither warhead touches a domain tile; an
  Antimatter Reaction on the domain does nothing. On deep space it does nothing either.
- **WH4 — Both incur the punitive strike** at today's Antimatter levy, **25%**, for either
  warhead. The flag rules are unchanged (H19), and the punitive strike passes through shields
  like every strike (SH3).
- **WH5 — The Void missiles option retires.** Whether a warhead erases ground is now the
  warhead's nature, not a lobby setting. Under a Dark Star the option is hidden and ignored;
  the wire field stays.
- **WH6 — The throne erases freely.** The Hegemon may fire Antimatter Reactions anywhere,
  including the nebula around its own moat. There is no restriction.

**On the names.** The player-facing name "Antimatter" moves from the big warhead to the small
one. The code keeps its enum values: `HydrogenBomb` becomes the Gamma Ray Burst, `AtomBomb` the
Antimatter Reaction. Any text, wiki page or tutorial line that says "Antimatter Warhead" today
means the Gamma Ray Burst after this change, so each one must be rewritten, not just renamed.

### 3.2 Engine touch points

- `Config.ts`: the `AtomBomb` cost becomes 5M under a Dark Star, and `nukeMagnitudes(AtomBomb)`
  becomes `{ inner: 10, outer: 10 }` (a clean circle). `punitiveLevyPercentNuclear` becomes 25
  (or the two levers merge into one).
- `GameImpl.queueWaterConversion` decides by `config().waterNukes()` today. It must decide per
  warhead: always deep space for `AtomBomb`, never for `HydrogenBomb`. `NukeExecution` passes the
  choice. The `WaterManager` path that the Void missiles option uses already does the
  conversion and the client's terrain update.
- `NukeExecution`: skip the shield checks (`inMissileShield`) for `AtomBomb`, both for tiles and
  for units.
- Lords (`NationNukeBehavior`): today they choose between a cheap small warhead and a dear big
  one. Now both cost the same. **[Decided 2026-10-25]** A Lord fires a Gamma Ray Burst as it
  fires an Antimatter Warhead today. Its Antimatter Reaction is for **shields**: aimed at a
  shielded post that covers a target it wants, never spent on erasing strategic ground. **[Revised 2026-10-25, Tom]** Shields stop the Reaction now, so a Lord tries a Gamma Ray Burst and falls back to an Antimatter Reaction where only the smaller blast fits its target's ground. `NationStructureBehavior` reads the atom bomb's radius
  for its own spacing and must be checked.
- Punitive badge colours: red for Nuclear, white for Antimatter today. Keep one colour per
  warhead so the throne can still tell which was fired.
- Client and text: `en.json` names and descriptions, the build-menu tooltips, the telegraph
  radius, icons (decided 2026-10-25: the Gamma Ray Burst takes today's Nuclear Warhead icon;
  the Antimatter Reaction gets a new stylised antihydrogen atom, a positron (+) orbiting an
  antiproton (−), drawn from Tom's reference `MapImages/Antimatter.png`), the warhead help text, the tutorial and
  the wiki.
- Tests: `tests/StargateMissiles.test.ts` and the punitive and shield tests are rewritten for
  the new numbers. New cases: an Antimatter Reaction inside a shield erases, the post dies with
  its tile, domain tiles and deep space are untouched, a Gamma Ray Burst never converts terrain.

## 4. Shield Arrays on Defense Posts

### 4.1 Rules [Decided 2026-10-25, revised the same day; SH1, SH2 and SH4's post rules reversed 2026-10-27]

> **[Revised 2026-10-27, Tom]** Shield Arrays as strict upgrades to Defense Posts were not
> working well. They are **free-standing structures again**: placed like any building, no post's
> defence, not counted as posts for the post's price, **2.5M** flat (was 2M). What the shield
> stops and lets through (SH3) and capture intact (SH4) are unchanged. Lords
> place their one array where it covers the most of their buildings (Q16). The shield shrank a
> tenth to 90 tiles the same day; then (Tom, later the same day) arrays became **upgradable to
> level 5**: 25 tiles per level (25 to 125), each level costing 1M, 2.5M, then 5M by the levels
> the player owns. Lords leave theirs at level 1. SH1, SH2 and the
> post half of SH3/SH4 below are kept as history.

- **SH1 — A Shield Array is built on a Defense Post, and only there.** Placing a Shield Array on
  one of your Defense Posts **upgrades** it: the post becomes a **shielded post**. The Shield
  Array's icon **replaces** the post's. A Shield Array cannot be placed on bare ground. It keeps
  its own button on the hotbar, and with it selected your Defense Posts are the valid sites.
- **SH2 — Prices are unchanged.** The post costs what it costs today (50k rising to 250k with
  the number you own), and the array is **2M flat** on top. The throne's gifts pay the
  first-building price as today (H18); a gifted array needs a post on the host's ground, which
  the throne may gift first.
- **SH3 — What a shielded post does.**
  - **The post's defence** within **30 tiles**, unchanged: attackers lose 5× the troops and
    advance 3× slower.
  - **The shield** within **100 tiles**, the Gamma Ray Burst's own radius (up from 40): a Gamma
    Ray Burst harms nothing inside it (C5's rule, unchanged). A Gamma Ray Burst aimed at the
    post itself therefore does nothing at all.
  - **Troops pass through, as today.** Gate shots and strikes (the throne's raze strike and the
    punitive strike alike) land inside a shield and fight as they do now. A shield stops
    missiles, not troops.
  - A **tithe** goes through (TI4). [Revised 2026-10-25] The Antimatter Reaction does not
    (WH2 reversed).
- **SH4 — Captured, not destroyed.** A **plain** Defense Post is still destroyed when an enemy
  takes its tile. A **shielded** post is **captured intact**, with its shield and its defence,
  and protects its new owner from then on (C5's rule, kept). So the upgrade buys two things:
  the shield, and a building that survives being taken.

### 4.2 Engine touch points

- Placement: `PlayerImpl.canBuild` / `ConstructionExecution` accept a Shield Array only on the
  player's own finished Defense Post, and replace the post unit with a `ShieldArray` unit on
  the same tile. **The shielded post must still count as a post** for the post's escalating
  price, and as a post in the combat checks.
- Combat: `AttackExecution` and `RazeExecution` ask `hasUnitNearby(tile, defensePostRange,
DefensePost, owner)`, so they must also accept `ShieldArray`. Keep the cost per tile flat:
  this runs for every conquered tile.
- Capture: nothing to change. `PlayerExecution` deletes only a captured `DefensePost`; a
  `ShieldArray` is already captured with the tile.
- Radius: `SHIELD_ARRAY_DEFAULTS.radius` 40 → 100. Ideally it reads the Gamma Ray Burst's outer
  radius from `nukeMagnitudes(HydrogenBomb)` so the two cannot drift apart.
- Landings: nothing to change; strikes and gate shots already pass through.
- Client: the build menu and hotbar (valid sites are your posts), the hover footprint (30 and
  100), the radial tooltips, the Buildings doc and the wiki.
- Lords build posts under heavy land attack and no arrays (F21). Whether they upgrade a post to
  a shielded post is left for later.

## 5. The gate network

### 5.1 Rules [Decided 2026-10-25]

- **GN1 — A gate reaches players, not just tiles.** A player may send **troops or gold** to any
  player who owns at least one tile within range of one of their finished stargates (180 tiles
  at level 1, +75 per level). **No alliance is needed**: gate range is the only test.
- **GN2 — Instant, and nothing launches.** The transfer arrives at once. It spends no gate
  charge, starts no reload, and flies no projectile.
- **GN3 — Upgrading a gate widens the network.** Each level's +75 range brings more players in
  reach, for supply as for war.
- **GN4 — The throne reaches everyone.** Sitting in the Dark Star, the Hegemon's reach is
  unlimited: it may send **troops or gold to any player**. Gold from the throne is new; H9 had
  shelved it.
- **GN5 — Supplying the throne needs a gate.** A challenger may send **troops or gold** to the
  Hegemon only when one of their gates reaches a Dark Star tile. Today anyone may reinforce the
  throne with troops from anywhere (H9), and gold to the throne is barred.
- **GN6 — Donation cooldowns apply** to every transfer, as today.
- **GN7 — Alliances are not limited by range.** Proposing, extending and breaking an alliance
  work from anywhere, as today.
- **GN8 — The handshake becomes a two-level menu.** The radial menu's ally slot (the handshake)
  opens a submenu with **Donate troops**, **Donate gold** and **Propose alliance** (or Extend,
  in an alliance's extension window). Donate troops is sized by the troop slider; Donate gold
  opens the existing gold dialog. Each item greys out with a tooltip when it is not allowed:
  out of reach, on cooldown, or proposal unavailable.

- **GN9 — Donating has one home.** The centre button no longer donates: it is always the
  ground attack. The attack slot no longer turns into Donate gold on a friend: it is always the
  stargate menu. Every transfer goes through the handshake.
- **GN10 — The throne's handshake.** The Hegemon's ally slot, the Gift today (H18), becomes the
  same two-level menu: **Gift** (the structure list, one level deeper), **Donate troops** and
  **Donate gold**.
- **GN11 — The lobby's donation toggles still apply** between challengers: with gold or troop
  donations switched off, gate transfers of that kind to humans are off too. The throne's
  transfers ignore them, as its troop donations already do (H9).
- **GN12 — The invader can be supplied.** The player holding the Dark Star may receive troops and
  gold like anyone else in reach. This reverses H6's "donations to the invader stay closed": a
  coalition can now feed an invasion through its gates.

### 5.2 Consequences to know

- **On the Dark Star**, a challenger's ally slot is Reinforce the throne today (§6.25). It joins
  the handshake as its Donate troops item, gated by GN5, with Donate gold beside it. Troops sent
  to the throne while someone holds the Dark Star are still thrown at the invader
  (`DonateTroopExecution`), as today.
- **Teammates and Lords.** Teammates also need gate reach now. Lords that donate troops to
  teammates (`AiAttackBehavior`) will do so only when in reach.
- **Feeding the invader** (GN12) is a new way to gang up on the throne. It goes on the RW5 list:
  whether invasions backed by several players' gates end rounds too quickly.

### 5.3 Engine touch points

- A reach test on the player, used by `canDonateGold` / `canDonateTroops`: some finished gate
  has some recipient tile within its range. The nearest tile of a territory to an outside point
  is on its border, so checking the recipient's **border tiles** against each gate is enough.
  The Hegemon always passes. For a Hegemon recipient, the test is against the domain tiles.
  Cache the result per tick for the menu.
- `canDonateGold` / `canDonateTroops` (`PlayerImpl`): the `isFriendly` requirement goes and the
  reach test takes its place. The Hegemon's gold refusal goes entirely: the throne sends gold
  (GN4) and receives it (GN5). The cooldown and the lobby toggles stay (GN6, GN11). Nothing bars
  the invader in code today beyond the alliance requirement, so GN12 needs no change, only a
  test.
- The donation executions are reused (`DonateGoldExecution`, `DonateTroopExecution`).
- Client (`RadialMenuElements.ts`): `allyRequestElement` / `allyExtendElement` become items in
  a new handshake submenu, alongside `allyDonateTroopsElement` / `allyDonateGoldElement`
  (which exist but are not placed in the root menu today). `centerButtonElement` loses its
  friendly-donation branch, the root menu's `showDonateInsteadOfAttack` swap goes (GN9),
  `giftMenuElement` moves one level down into the throne's handshake (GN10), and
  `reinforceThroneElement` becomes the handshake's troop item on the Dark Star.

## 6. Roadmap

Each step is a self-contained change with its tests (`src/core` changes always carry tests), its
`en.json` text, a wiki rebuild (`npm run wiki`) and the docs (the design doc's rules, the
Buildings reference and its levers, the Combat doc where it applies). Every question is answered;
steps RW0–RW4 can be built in any order.

| Step    | What                                                                                                                                                                                                                                                                                                                                             | Size | Waits on |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | -------- |
| **RW0** | **Special thrones off.** Drop `special` from the throne lines (`ThroneRegistry.THRONE_TYPES`, `MasterLobbyService`) and hide the Special pane in the lobby browser; keep the code for later.                                                                                                                                                     | S    | —        |
| **RW1** | **Warheads** (§3): names, prices, the 10-tile erasing Antimatter Reaction, the shield exception, the 25% levy, the Void missiles option retired, Lords' choice, text and tests.                                                                                                                                                                  | M    | —        |
| **RW2** | **Shielded posts** (§4): placement on posts only, the post count and combat checks, the 100-tile shield, the icon, footprint and text.                                                                                                                                                                                                           | S–M  | —        |
| **RW3** | **Tithes** (§2): intent, flight and ring, landing and transfer, cooldown, the radial entry, messages, the AI Hegemon, Lords spending down, `HegemonSim` output, the cue when Tom supplies it.                                                                                                                                                    | L    | —        |
| **RW4** | **The gate network** (§5): the reach test, the donation rules (no alliance, the throne's gold, the gated reinforcement), the handshake submenu, the centre button and the throne's slot.                                                                                                                                                         | M    | —        |
| **RW5** | **Balance.** A `HegemonSim` sweep with tithes in (what they bring in, and whether the shadow tax stays, TI6), then a playtest. Check: tithe pressure on the early game, whether 5M warheads are still fired, whether 100-tile shields leave the Gamma Ray Burst any targets, and whether invaders supplied through gates end rounds too quickly. | —    | RW1–RW4  |

### 6.1 RW5 measurements (`HegemonSim`, 2026-10-25)

Milky Way, AI only, 20 minutes; `--no-tithe` (added for this) switches off the AI throne's tithes.

| Run                 | Tithes landed gold | Shadow tax (and donations) | Flagged launches | Outcome                 |
| ------------------- | ------------------ | -------------------------- | ---------------- | ----------------------- |
| FFA seed a          | 2.3M               | 14.4M                      | 0                | Throne held             |
| FFA seed b          | 1.0M               | 15.1M                      | 0                | Overthrown at 19:45     |
| FFA seed c          | 2.0M               | 9.5M                       | 0                | Overthrown at 13:33     |
| Teams (Barons only) | 34.7M              | 6.6M                       | 0                | Throne held, no landing |
| FFA a, no tithe     | —                  | 14.2M                      | 0                | Throne held             |
| FFA b, no tithe     | —                  | 21.1M                      | 0                | Throne held             |
| Teams, no tithe     | —                  | 6.7M                       | 0                | Throne held, no landing |

- **Lords fire no warheads any more**, tithes or not (the same seed showed 22 flagged launches in
  September, mostly 1M Nuclear Warheads). At 5M each, and with Lords saving towards five Gamma Ray
  Bursts (25M) before spending freely, they never get there. Open: Q15.
- **Tithes bring the AI throne 1–2M a round in FFA**, a tenth of the shadow tax: Lords spend down
  under the ring (TI10). Against Barons, who do not react, they bring five times the shadow tax.
  The AI throne has no use for gold, so this matters for a human throne. TI6 (keep the shadow tax)
  stands.
- **Overthrows**: two of three FFA rounds fell with tithes on, none of two without. Too few runs to
  read anything into; the playtest decides.
- **After the revision** (seeds a, b, c; half tithes over the Population Center allowance,
  Reactions kept out, Lords' fallback): 11–15 tithes landed a round and took **nothing** (Lords
  spend down to thresholds their Population Centers raise into the millions); 0–3 Antimatter
  Reactions and still no Gamma Ray Burst; 7–15 Shield Arrays; all three rounds overthrown
  (16:43, 17:01, 12:51).
- **After the second revision** (flat 500k, half share; Lords' bursts may hit bystanders):
  tithes took 0.7–1.0M a round from 12–15 landings; Lords fired 0–3 Gamma Ray Bursts and 0–1
  Antimatter Reactions; 11–14 Shield Arrays; all three rounds overthrown (13:48, 16:21, 16:00).
- Not measurable here: Lords build no Shield Arrays and do not supply invaders, so 100-tile shields
  and gate-fed invasions wait for the playtest.

## 7. Questions

### 7.1 Answered (Tom, 2026-10-25)

| #      | Question                                        | Answer                                                                                         |
| ------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Q1** | Does a shield keep out the punitive strike?     | No. Every troop strike, the throne's and the players', passes through shields, as today (SH3). |
| **Q2** | Where exactly does a shield stop troops?        | Nowhere. Troops are never stopped; the post's defence radius stays 30 (SH3).                   |
| **Q3** | Does the gate network need an alliance?         | No. Gate range is the only test (GN1). Alliances themselves are not limited by range (GN7).    |
| **Q4** | Which way does the Hegemon take part?           | The throne reaches everyone (GN4); challengers supply it only within gate range (GN5).         |
| **Q5** | Where are transfers ordered?                    | In a two-level handshake menu: Donate troops, Donate gold, Propose alliance (GN8).             |
| **Q6** | Do donation cooldowns apply?                    | Yes (GN6). The lobby toggles and the invader became Q13 and Q14.                               |
| **Q7** | Can a Shield Array go on bare ground?           | ~~No.~~ Yes since 2026-10-27: free-standing again (SH1 revised).                               |
| **Q8** | May the throne erase land near its own rim?     | Yes, with no restriction (WH6).                                                                |
| **Q9** | May a player dodge a tithe by giving gold away? | Yes (TI11). The AI's first tithe comes after one minute of play (TI9).                         |

### 7.2 Answered (Tom, 2026-10-25, second round)

| #       | Question                                               | Answer                                                                      |
| ------- | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| **Q10** | Does the centre button keep donating troops?           | No. Donations move to the handshake; the centre is the ground attack (GN9). |
| **Q11** | Does the throne's Gift slot become the two-level menu? | Yes: Gift, Donate troops, Donate gold (GN10).                               |
| **Q12** | Does gold to the throne stay closed?                   | No. Challengers may send the throne gold within gate range (GN5).           |
| **Q13** | Do the lobby's donation toggles still apply?           | Yes, between challengers; the throne ignores them (GN11).                   |
| **Q14** | Do donations to the invader stay closed?               | No. The invader can be supplied like anyone in reach (GN12).                |

### 7.3 Answered (Tom, 2026-10-25, RW5)

| #       | Question                                                   | Answer                                                                                                                                                                      |
| ------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q15** | Lords no longer fire warheads. Lower their savings target? | Yes: one 5M warhead, not five (`getSaveUpTarget`).                                                                                                                          |
| **Q16** | Do Lords build Shield Arrays?                              | Yes, one: once a Lord owns at least one of every other building, it builds one where it covers most of its buildings (`maybeBuildShieldArray`; on a post until 2026-10-27). |

## 8. Changelog

- **2026-10-25, second revision (Tom)** — The Population Center allowance is dropped (too much):
  tithes take half the gold above a flat 500k. Lords may fire a Gamma Ray Burst with collateral:
  under a Dark Star, any difficulty, the blast must spare only their own and their friends'
  ground; otherwise they fall back to an Antimatter Reaction. Built.

- **2026-10-25, revision (Tom)** — Tithes take **half** the excess, over a threshold of 500k plus
  250k per Population Center level (TI2, TI3, TI10). The Antimatter Reaction is **kept out by
  shields** and its blast is the old Nuclear Warhead's, 12/30 (WH2 reversed, SH3). Lords no
  longer aim it at shields: they try a Gamma Ray Burst, then fall back to a Reaction where only
  the smaller blast fits their target's ground. Built the same day.

- **2026-10-25, RW5 follow-up** — Q15 and Q16 answered and built: Lords save towards one 5M
  warhead, and shield one post once they own one of everything else. Re-measured (seeds a, b, c):
  9–13 Shield Arrays standing at the end, 0–3 Antimatter Reactions fired at them, still no Gamma
  Ray Burst; all three rounds overthrown (12:43, 16:52, 15:32). `HegemonSim` now counts
  challengers' warheads by unit and the arrays standing.

- **2026-10-25, after the build** — Tom: the tithe keeps the strike's flight, no special
  flight rules, although across most maps it lands in about a second (the ring is short-lived;
  Lords still react in time). Punish taking the throne's attack slot near a flagged gate, and no
  hover ring for a post's 30 tiles, are fine for now. The tithe cue is credited.

- **2026-10-25, built** — RW0-RW4 built on `feat/rework`. Notes on what the code settled:
  the levy is one lever (`punitiveLevyPercent`); Lords keep their structure spacing at the old
  30 tiles (`ATOM_BOMB_SPACING`) rather than the Antimatter Reaction's 10; a shield array goes
  up beside its post, which keeps defending until the array stands and then makes way; the
  handshake's greyed items say why (out of reach, on cooldown, switched off); Lords under a ring
  order a building and size bulk upgrades down to the reserve every two ticks; the tithe flies
  as a projectile flagged `tithe` and its ring uses the nuke telegraph. No hover ring for a
  post's 30 tiles (plain posts have none either). RW5 is next.

- **2026-10-25, third revision** — Tom: the rework is **released all at once** (built on
  `feat/rework`). The proposed details are decided as written: the tithe tooltip's preview (TI7),
  the AI Hegemon's aim (TI9), the messages and the sound audience (§2.2, cue supplied). Lords
  spend the Antimatter Reaction on shields, not on erasing ground (§3.2). Icons: the Gamma Ray
  Burst takes the Nuclear Warhead's, the Antimatter Reaction gets a stylised antihydrogen atom.
  Build order RW0 → RW1 + RW2 → RW4 → RW3 → RW5 (100-tile shields need their breaker).

- **2026-10-25, second revision** — Tom's answers to Q10–Q14. Donations live only under the
  handshake (the centre button and the attack slot stop donating); the throne's Gift slot
  becomes the same two-level menu; challengers may send the throne **gold** as well as troops
  within gate range; the lobby toggles still apply; the invader **can** now be supplied,
  reversing H6's closure. Rules GN9–GN12. Every question answered; RW0–RW4 ready to build.
- **2026-10-25, revision** — Tom's answers to Q1–Q9. Shields no longer keep out landings: every
  troop strike passes through, as today. A shielded post is **captured intact** (a plain post is
  still destroyed). The shield radius rises to **100**, the Gamma Ray Burst's. Shield Arrays go
  only on Defense Posts. Gate transfers need **no alliance**, only range. The throne reaches
  everyone, with gold. Challengers reinforce the throne only within range. Cooldowns apply. The
  handshake becomes a two-level menu. The throne may erase land freely, and dodging a tithe by
  charity is fine. New questions Q10–Q14, all on the gate network's details; RW1–RW3 are ready to
  build.
- **2026-10-25** — Written from Tom's decisions in a design conversation: tithes (TI1–TI10),
  Gamma Ray Burst and Antimatter Reaction (WH1–WH5), Shield Arrays built on Defense Posts
  (SH1–SH5), the gate network (GN1–GN5), special thrones off (RW0). Roadmap RW0–RW5; questions
  Q1–Q9 open. Nothing built.
