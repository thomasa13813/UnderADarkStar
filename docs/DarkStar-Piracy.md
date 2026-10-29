# Under a Dark Star — Piracy

> **Piracy**: an eliminated challenger stays in the round as a single anonymous raiding ship, the
> **corsair**, and may beach it to return to the map as a tiny challenger. Proposed by Tom on
> 2026-10-14; the four shaping decisions were taken the same day (§3). Companion to
> `DarkStar-Design.md` (C1 elimination, H6/H16/H17 on the Dark Star, S7 the space economy, §6.15
> destroyers, §6.18 freighters) and `DarkStar-Lobbies.md` L31 (the death screen). Rule ids are
> **PR1–PR18**; **F22** in the design doc's table points here. Every shaping question is decided;
> the numbers are levers (§5). Target: built and
> on the private test of **Sunday 2026-10-18**, behind a lobby toggle. Changelog at the end.
>
> Status tags as in the design doc: **[Decided]** · **[Proposed]** · **[Open]**.

## 1. The problem and the proposal

**The problem.** C1 makes elimination final: a challenger with no nebula left sees _You died_ and
chooses between Spectate and Exit (since L31, also _Join Next Round_ on a public throne). Most
leave. A half-empty room is a worse round for everyone still in it, and the player who left has
nothing to do with the minutes the round still has to run.

**Tom's proposal, as given.** An eliminated player gets a third choice, **Embrace piracy**. Taking
it lets them spawn **one destroyer-like ship** in deep space where they click. It sails and patrols
like a destroyer and takes orders like one, moving wherever the player sends it. Every freighter it
raids adds **100 troops** to the ship's hold, up to **2,500**. The player may at any time **land
the ship on nebula** to start an invasion with the hold, taking a small territory and, with luck,
rebuilding from it. If the ship is destroyed, a new one can be spawned after a short cooldown,
about **20 s**. Pirates are tiny and weak, but they are in the game, and they create dynamics the
round would not otherwise have.

## 2. Assessment

### 2.1 What fits

- **It solves a real retention problem without touching the Hegemon bargain.** C1 was decided
  together with H16: elimination is final, and in exchange the Hegemon can never eliminate anyone.
  Piracy does not give the Hegemon a way to kill; it gives the killed a way to stay. H16 stands
  untouched. C1 needs one clause changed ("cannot re-deploy" becomes "may return only as a
  pirate").
- **The fiction is right.** Space pirates preying on freighters in deep space need no explaining,
  and the galaxy already has the pieces: destroyers, freighters on lanes, harbours, the moat.
- **Most of the machinery exists.** The engine's warship already patrols a point, chases and
  captures freighters within its patrol range, shells fleets and warships, repairs at a harbour,
  and **already takes new orders**: a player clicks a destroyer, then clicks deep space, and the
  `move_warship` intent re-points its patrol (shift-drag selects several). Tom's "set it and
  forget it" is how destroyers are mostly used, not what they can do. A pirate ship is the same
  unit with a different owner state, a different payout on capture, and one new order: land.
- **A landing is a fleet arrival.** The engine's transport landing conquers the shore tile and
  starts an ordinary attack from it with the troops it carried. The pirate's landing reuses that
  code path, with the hold as the troops, plus the guaranteed claim (PR8). A click inland already
  resolves to the nearest shore the ship can reach (`targetTransportTile`), so "click land, the
  corsair goes and invades there" is the fleet's own targeting.
- **The economics are already in place to make a comeback plausible.** A player with a handful of
  tiles regrows fast on the engine's curve (a 2,500-troop foothold grows by roughly 80 troops a
  tick), and the troop ceiling for a few tiles is still about 100k. A pirate who lands and survives
  a minute is a small challenger again, not a corpse. With raid gold in the bank (PR16) they can
  put a spaceport down at once.
- **Lords will hunt pirates for free.** `NationWarshipBehavior` already retaliates with a warship
  when one of its freighters is taken, so the galaxy pushes back without new AI work.
- **A foothold cannot be swallowed.** The engine's enclosure rule (a cluster surrounded by one
  hostile player is handed to them) never applies to a cluster touching an ocean shore
  (`surroundedBySamePlayer`), and a beached corsair's claim always does.

### 2.2 What bites: engine facts that shape the design

- **A dead player is purged, and "alive" means "owns a tile".** `isAlive()` is `tiles > 0`; the
  moment it goes false `PlayerExecution.removeOnDeath` deletes every unit, every alliance and all
  gold, stamps the finishing place, and stops running. `canBuild` refuses anything to a non-alive
  player, as do donations, trade, attacks and most of the roster. A pirate is a **third state**:
  no tiles, but present. The implementation keeps `isAlive()` as it is (standings, the win check
  and the death screen depend on it) and adds a `pirate` state checked at the dozen or so gates a
  pirate needs open: build the ship, move it, land it, be shot at, be seen on the map. This audit
  is the real cost of the feature, not the ship. §6 says why it is a bounded risk.
- **Capturing a freighter means "sail it to my port".** Today a capture changes the freighter's
  owner and it sails to the captor's nearest spaceport with a harbour on that body of space; with
  no such port the destroyer **does not even target** freighters, and a captured ship with nowhere
  to go is deleted. A pirate has no port, so the raid is its own payout: **capture and scuttle**
  (the freighter is deleted on the spot; the hold and the pirate's purse grow, PR5/PR16). The
  trading partners lose the cargo as they do today.
- **Freighters have two safe zones the pirate cannot touch.** A freighter on a **land leg** is out
  of every ship's reach (§6.18), and one hugging a **shoreline** is `safeFromPirates` (the engine's
  anti-camping rule, which the name now makes literal). Lanes along coasts and inland ports are
  pirate-proof; open-space lanes are the hunting ground. Quiet maps will starve pirates and busy
  ones will feed them.
- **A player under 100 tiles dies at the first touch.** `AttackExecution.handleDeadDefender`
  wholesale-conquers any player with fewer than 100 tiles the moment any attack reaches them. A
  landing party of 2,500 troops alone takes some tens of neutral tiles; a fresh spawn is about 50
  tiles and 25,000 troops. Hence the guaranteed claim of exactly 100 tiles (PR8): the bare minimum
  not to be popped on arrival, and nothing more, as Tom decided.
- **The Dark Star's invasion slot is a griefing lever.** H6 allows one invader at a time; a pirate
  landing on the domain would take the slot and block a real invasion for the price of nothing.
  **Pirates never land on Hegemon tiles**, domain or bubble (PR9).
- **Destroyers shoot fleets first.** The warship's first priority is any transport ship in range,
  before warships and freighters, and it needs no reload against them. A pirate parked on the moat's
  approach could sink a challenger's throne-bound invasion fleet at zero cost, which lets a dead
  player decide who wins. PR6 takes that away.
- **Structures change hands with their tile.** `PlayerExecution` gives any structure standing on a
  tile you own to you. A free 100-tile claim that swallowed a spaceport or a city would be the
  cheapest conquest in the game, so the claim never includes a tile with a structure (PR8); the
  hold's attack may still take them the ordinary way.
- **The engine already calls something "piracy".** Captured-freighter gold is `piracyGold` and the
  leaderboard string is _Piracy Gold/min_. It becomes **Raid gold** on screen (PR17) so the word
  means one thing.
- **Standings are stamped at the first death.** `recordDeathPosition` is first-write-wins, so a
  pirate who returns and falls again keeps the place of their first fall. Harmless for now; it
  matters when the leaderboard (B5) counts placings.
- **The spawn phase and the opening are not affected.** Elimination cannot happen before the round
  begins, and the pirate's orders pass through `Executor.createExec` like any other, so the opening
  gate and replays need nothing new.

### 2.3 What could go wrong

- **The immortal nuisance.** A free, repeatable unit whose only penalty for dying is 20 s is a
  harassment tool: park beside a rival's harbour, raid, die, respawn on the same tile, repeat.
  Mitigations: the cooldown climbs with each sinking and the respawn point is kept away (PR10), and
  the pirate cannot shoot fleets (PR6).
- **Kingmaking.** Even without shooting fleets, a pirate can starve one challenger's trade and
  not another's. That is the intended dynamic, bounded by one ship's reach, and a pirate who
  overdoes it draws the Lords' warships. Anonymity (PR15) stops it being personal.
- **Collusion and laundering.** A pirate cannot donate troops or gold (both require an alive
  sender), cannot ally, and holds nothing to gift. Two channels remain and are accepted: a pirate
  may beach on a friend's coast and let the friend take the foothold back, which hands the friend
  the engine's conquest share of the pirate's raid gold (`conquerGoldAmount`); and a pirate may
  raid only the friend's rivals. Both are small, visible, and no worse than what two allied
  challengers already do.
- **Noise for the living.** Every raid today posts a _trade ship captured_ event to the victim.
  Keep the event and name the raider _Pirates_ (PR15). No sound cue for a raid: a busy corsair
  would ring it all round long (Tom, 2026-10-17). The beaching has one, for the pirate and the
  coast's owner (S8).
- **Clutter at the end.** Pirates landing in the last minute to pad a standing. PR12 closes
  landings in the final minute.
- **Autopilot pirates.** A corsair patrols and raids by itself. A pirate who closes the tab would
  leave a ghost ship raiding for the rest of the round, which defeats the purpose (the player is
  not in the room) and annoys the living for nobody's fun. PR18 scuttles it.

## 3. Decisions [Decided 2026-10-14, Tom]

1. **Pirates must be able to return.** The landing is in; the hold's growth and cap are the
   tuning levers, not the comeback itself.
2. **Landings may go onto other players' coasts**, not only neutral nebula.
3. **Fragility is accepted, with a floor.** A landing automatically claims the bare minimum that
   stops it being popped on arrival (the engine's 100-tile mop-up threshold); beyond that a pirate
   starts very weak. A pirate is a nuisance, not a contender, and almost never wins.
4. **Build it for the Sunday test.** Tom has Saturday and Sunday before the friends test (Launch
   stage 7) to build it with Claude. It ships behind a lobby toggle so the test can run without it
   if it is not ready (§7).
5. **Anonymous while at sea.** A pirate's corsair shows no name and no player colours; the player
   is revealed in their true colours only when they take territory.
6. **Two-click control.** A pirate controls the corsair and nothing else: a click on deep space
   sends it there to patrol and raid; a click on land sends it to invade the nebula at that coast.
7. **Raid gold.** The engine's captured-freighter gold is renamed on screen. Eliminated players
   lose all their gold at death but accumulate gold freely through piracy, alongside the capped
   hold of troops.
8. **The five follow-ups.** A pirate who leaves has the corsair scuttled (PR18); a sinking loses
   the whole hold (PR10); a slow heal anywhere (PR11); raid gold is a flat 10k (PR16); the claim
   is a free predetermined bite (PR8).

## 4. Rules

- **PR1 — Who. [Decided]** A **challenger** eliminated while the round goes on may embrace piracy
  from the death screen, any number of times in a round. The Hegemon never does (its fall ends the
  round). Lords and Barons do not (no AI pirates in the first version).
- **PR2 — The corsair. [Proposed]** A pirate owns exactly **one ship**, the **corsair**: the
  engine's warship unit (`UnitType.Warship`) with a hold, drawn as a pirate ship in a neutral
  pirate livery (PR15). Health, shell damage and reload as a destroyer's; **no veterancy**. It
  always sails at a destroyer's chasing pace, two steps a tick, on patrol, in a chase and to a
  landing [Tom 2026-10-15].
- **PR3 — Spawning. [Proposed]** The pirate clicks any **deep-space tile outside the Dark Star and
  its moat** and the corsair appears there, at once the first time. It costs nothing. A click on
  land, the disc or the moat is refused with a heads-up line.
- **PR4 — Orders. [Decided]** The corsair patrols its spawn tile until told otherwise. A click on
  **deep space** re-points its patrol (the engine's `move_warship`, same body of space). A click on
  **land** orders a landing (PR7) at the nearest shore of that nebula the ship can reach (the
  fleet's `targetTransportTile`). A pirate's whole input is these two clicks; the radial menu, the
  build bar and the troop slider are hidden. **A click on deep space while a landing is under way
  cancels it** and the corsair patrols there instead: no confirmation dialog, a mis-click costs a
  detour and nothing else.
- **PR5 — Raids. [Proposed]** The corsair hunts **any freighter** within its patrol range as a
  destroyer does, with the same exclusions (land legs, shoreline, the Dark Star's water). Reaching
  one **scuttles** it: the freighter is deleted where it stands, the trading partners get nothing,
  the hold gains `pirateRaidTroops` (**100** on screen) up to `pirateHoldCap` (**2,500** on
  screen; the engine stores troops ten times the displayed figure), and the pirate's purse gains
  the raid's gold (PR16). Victims see the existing _trade ship captured_ event, by
  _Pirates_. A full hold keeps raiding for the gold.
- **PR6 — No fleet sinking. [Proposed]** The corsair **never fires on fleets** (transport ships).
  It returns fire on **warships** that enter its range, and warships may hunt it. The throne's
  destroyers engage it only inside the moat (H10, unchanged).
- **PR7 — The landing. [Decided]** The corsair sails to the shore tile and **beaches**: the ship
  is consumed, the player **claims** the landing's tiles (PR8), the hold lands as an ordinary attack
  from the claim (the fleet-arrival code path), and the player is a challenger again in their own
  name and colours. Their old alliances are gone (deleted at death); their raid gold is theirs
  (PR16); spawn immunity does **not** apply. An empty hold may still land (the claim is the
  landing; the hold is the push).
- **PR8 — The claim. [Decided]** A landing takes, at no cost,
  `pirateLandingTiles` (**100**, exactly the mop-up threshold, so `tiles < 100` is false on
  arrival) land tiles nearest the shore tile by BFS, from **neutral nebula or the coast owner's
  tiles**, **never** a tile with a structure on it (clipped out, the owner keeps it), never a
  Hegemon tile, never impassable. If fewer than 100 such tiles are reachable the landing is
  refused (a rock too small to live on). Troops on the claimed tiles are not fought for: the
  claim is a bite, the owner may bite back at once. [Tom 2026-10-14] The bite is a predetermined
  minimum and free; the hold is what the returned player attacks with from it.
- **PR9 — Where a landing may go. [Decided]** Any coast **except** the Hegemon's (domain or
  bubble, H6/H17) and the coast of a player under **spawn immunity** (`canAttackPlayer`). Shield
  arrays do not stop it (they stop missiles, not troops, C5). On a team throne (L8) a pirate keeps
  their team and may not land on a teammate's coast.
- **PR10 — Death and return. [Decided]** A sunk corsair loses its **whole** hold (Tom: no mercy
  for pirates); the purse stays with the
  player. The pirate may spawn another after `pirateRespawnSeconds` (**15**) **doubling with each
  sinking** in the round (15, 30, 60 s…, capped at `pirateRespawnCapSeconds`, **120**), anywhere in deep space outside the disc and
  moat, including where it was sunk (the 150-tile exclusion was dropped, Tom 2026-10-20). **The same wait
  runs from every elimination** [Tom 2026-10-15]: a player who has just died waits 15 s before
  their first corsair, and a returned pirate who falls again waits again, so no one can land,
  be overwhelmed and relaunch in the same breath. Every phase transition, player to corsair or
  corsair to corsair, carries the wait; the sinking count persists across returns within the
  round.
- **PR11 — Repair. [Decided; rate Proposed]** The corsair heals **slowly, anywhere** in deep space:
  one health every `pirateHealEveryTicks` (**3**) ticks, a third of a harbour's passive rate, so a
  corsair shot to a sliver is whole again in about five minutes. It never docks (no port, no moat).
- **PR12 — The last minute. [Proposed]** Landings are refused in the round's final minute
  (`pirateLandingClosesSeconds`, **60**). Raids continue.
- **PR13 — Round end. [Proposed]** A pirate at the timer is a spectator for the end screen; R3/R4
  are unchanged. A pirate at sea can never win; a returned challenger can, like anyone who was in
  the round from its start (a drop-in's victory is void, Lobbies L44).
- **PR14 — Standings. [Proposed]** The first elimination stamps the finishing place, as today.
  [Decided 2026-10-17, Tom: **no piracy data is tracked or shown.**] The sim keeps two per-round
  counters (`pirateRaids`, `pirateLandings`) that nothing reads; no leaderboard line is planned
  and B5 is unchanged.
- **PR15 — Anonymity. [Decided]** While a player is a pirate, their corsair is drawn in a **single
  pirate livery** shared by every pirate (black hull, no owner colour, a pirate marker instead of
  a name), its hover card says _Pirates_, and the raid event names _Pirates_, not the player. No
  selection box is drawn on it, not even for its owner [Tom 2026-10-15]. The sim knows the owner (it
  must: determinism, the hold, the return); only the view hides it. A returned challenger is in
  their own name and colours from the claim onward. Spectators and the Hegemon see the same livery
  as everyone.
- **PR16 — Raid gold. [Decided]** A scuttled freighter pays the pirate a **flat** `pirateRaidGold`
  (**10,000**), whatever the voyage: a full hold's 25 raids are 250k, a destroyer's price or a
  spaceport and a city. Uncapped, on the player, survives a sinking, wiped by a second death like
  any death. Counted as raid gold for the stats and taxed by the throne like any income (H4).
- **PR17 — The word. [Decided]** The engine's captured-freighter gold stat reads **Raid Gold** on
  screen (`piracyGoldPerMin` string). Code identifiers keep their names.
- **PR18 — A pirate who leaves. [Decided]** When a pirate's client is marked disconnected
  (`mark_disconnected`, the engine's AFK mark), the corsair is **scuttled** and the cooldown is not
  started; a pirate who comes back embraces again from the death screen. A ghost ship raiding on
  autopilot serves nobody.

## 5. Numbers (every one a lever)

| Tunable                       | Draft        | Why this starting point                                                                                             |
| ----------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `pirateRaidTroops`            | 100          | Tom's figure, as shown on screen (1,000 in engine units, which are ten times the display). 25 raids to a full hold. |
| `pirateHoldCap`               | 2,500        | Tom's figure, on screen (25,000 in engine units). A tenth of a fresh spawn's 25,000; a foothold, not a return.      |
| `pirateLandingTiles`          | 100          | Exactly the engine's mop-up threshold: the bare minimum not to be popped on arrival, and no more (decision 3).      |
| `pirateRespawnSeconds`        | 15           | Tom's figure (2026-10-15), after an elimination and after the first sinking.                                        |
| `pirateRespawnCapSeconds`     | 120          | The doubling stops here: a pirate sunk five times waits two minutes, not forever.                                   |
| `pirateLandingClosesSeconds`  | 60           | Closes the last-minute padding without touching raids.                                                              |
| `pirateRaidGold`              | 10,000       | Tom's figure. Flat so the purse reads simply; 25 raids buy a destroyer.                                             |
| `pirateHealEveryTicks`        | 3            | A third of a harbour's passive heal (1 a tick): whole again in ~5 min, so a hurt corsair hides rather than lands.   |
| Corsair health / shell / rate | as destroyer | One unit type, one set of numbers; retune only if pirates win warship duels they should not.                        |

**To measure on Saturday with the headless sim** before freezing the numbers: freighters a corsair
takes per minute on each map's busiest lane; the gold a raid pays on average; how long a 100-tile,
2,500-troop foothold on a Baron's coast survives; how often a Lord's warship finds a stationary
corsair.

## 6. Performance and the elimination system

**Performance: no measurable cost.** A pirate is one more warship execution (there are already up
to ten per Lord), one boolean on the player, and a few boolean checks at gates that run once per
intent, not per tick. The claim is a one-off BFS of 100 tiles. Anonymity is a view-side colour
lookup that already happens per unit. Nothing new runs every tick for every tile.

**Elimination: the risk is correctness, not performance, and it is bounded.** Three things keep
the blast radius small:

- **Death itself is untouched.** `isAlive()` stays `tiles > 0`; the purge, the finishing-place
  stamp, the death screen and the win check run exactly as today. Piracy begins **after** death as
  a new state with a short, explicit list of permissions. Everything the engine denies a dead
  player it still denies a pirate unless the list says otherwise.
- **The return is a known path.** Beaching is the fleet landing's own code plus a 100-tile claim
  built like a spawn disc, then the player's execution is added back, as the spawn phase adds it.
  The engine already handles a player going from zero tiles to some (that is every spawn).
- **The win check cannot see pirates.** In Hegemon rounds victory runs through the Hegemon only
  (R1–R4) and a pirate can never hold a domain tile (PR9). In the engine's own modes the land-share
  and last-side-standing checks count tiles and `isAlive()`, which a pirate at sea does not have.

The places that **will** need care, and the tests that pin them: the client's "am I dead"
branches (HUD, radial menu, spectator camera, the death modal's reopen on a second death);
`players()` is alive-only, so anything iterating it must not be where the corsair is drawn or
targeted; the stats' first-write-wins death stamp; a returned pirate's `PlayerExecution` running
once, not twice. All of this is the Saturday audit in §7, and every gate gets a test.

## 7. Build plan for the weekend

Behind `piracy: { enabled }` in the game config, a **lobby toggle** beside the Hegemon's (host
lobby and singleplayer), **on** for the Sunday test unless slice C is not done, in which case the
test runs with it off and nothing else changes.

| Slice | What                                                                                                                                                                                                                                                                                                 | Size | Done when                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| **A** | Sim: the pirate state, the `embrace_piracy` intent, the corsair's spawn branch, the pirate flag in `WarshipExecution` (no fleets, scuttle, hold, gold), the sinking cooldown with doubling and exclusion, PR18 on the disconnect mark; the gate audit; `tests/Piracy.test.ts` for all of it.         | M    | A headless pirate spawns, raids, banks troops and gold, is sunk and respawns on schedule, every gate tested.    |
| **B** | Sim: the `pirate_land` intent, `PirateLandingExecution` (sail, cancel, the claim with structure clipping and the Hegemon/immunity refusals, the attack, the return, the execution re-added), the last-minute close; tests for every refusal and the return, and that the Hegemon suites do not move. | M    | A headless pirate beaches on a Baron's coast, holds 100 tiles, pushes with the hold, can die and embrace again. |
| **C** | Client: _Embrace piracy_ on the death screen (and the modal's reopen), the two-click `PiracyController`, hidden HUD, the hold bar and respawn countdown, the pirate livery and _Pirates_ labels (PR15), the lobby toggle, strings in `en.json`.                                                      | M    | Tom plays a round in singleplayer, dies, raids, lands, in the real client.                                      |
| **D** | After the test: the _Raid Gold_ rename (PR17), cues (S8, Tom supplies), the as-built note in the design doc, C1 and L31 amended, a Lords check that a scuttle still triggers retaliation.                                                                                                            | S    | Docs and ledger current.                                                                                        |

A and B are Saturday, C is Sunday morning, D is after the test. If Saturday runs long, C's livery
and hold bar are the first things to drop (a corsair in the player's colours with a plain
destroyer sprite is playable, just not anonymous).

## 8. Engine touch points

- **State.** `PlayerImpl`: `isPirate()`, `embracePiracy()`, `pirateRespawnAt`, `pirateSinkings`;
  set by `embrace_piracy`, cleared by a landing. `isAlive()` unchanged. The corsair's execution
  owns the hold and the cooldown; no per-tick player execution while at sea.
- **Gates to open for a pirate** (the audit): `canBuildUnitType` (alive check; the corsair only),
  `warshipSpawn` (a pirate branch beside the Hegemon's: deep space outside disc and moat, the
  exclusion radius), `MoveWarshipExecution` (fine as is), `canAttackPlayer` both ways, the client's
  "am I alive" gates (`ClientGameRunner`, HUD layers, `MainRadialMenu`), the view's player list
  (pirates are not in `players()`; the ship must still be drawn and targeted).
- **The corsair.** `WarshipExecution`: a `pirate` flag like `hegemon`; `findBestTarget` skips
  transports for a pirate and drops the "a port to bring the prize to" requirement;
  `huntDownTradeShip` scuttles, adds to the hold (`unit.troops()`/`setTroops` exist; the warship
  params gain `troops`) and pays `pirateRaidGold`; no veterancy, no retreat, a slow heal everywhere
  (PR11) in place of the harbour heal. `TradeShipExecution` is untouched (a deleted
  ship ends its execution as today).
- **The landing.** `pirate_land` (tile) → `PirateLandingExecution`: resolves the shore
  (`targetTransportTile`), validates PR9 and PR12, sails with the water pathfinder, is cancelled by a
  later `move_warship`, then on arrival claims (BFS from the shore tile over land, skipping
  structures, Hegemon tiles and impassable, 100 tiles or refuse), `conquer`s them, starts
  `AttackExecution(hold)` against the coast's owner (or neutral), deletes the ship, clears the
  pirate state, re-adds `PlayerExecution`.
- **Death again.** `removeOnDeath` deletes the corsair when a returned pirate falls again; the death
  screen's `hasShownDeathModal` resets when a pirate lands.
- **Leaving.** `MarkDisconnectedExecution`: if the player is a pirate, scuttle the corsair (PR18).
- **Wire.** `Schemas.ts`: `EmbracePiracyIntentSchema { tile }`, `PirateLandIntentSchema { tile }`;
  `ZbinWire` entries; `Executor.createExec` cases; `Transport` events; `piracy` in `GameConfig`
  and the lobby's `ConfigPatch` copied keys.
- **Client.** `WinModal` button and reopen; `PiracyController` (the two clicks; replaces the
  warship selection controller for a pirate); `PirateHoldPanel` HUD layer; the livery in the unit
  colour lookup and the hover card (`Pirates`); the raid event text; `en.json` strings.
- **AI.** Nothing. Check that Lords' retaliation still fires on a scuttle.
- **Tests** (`tests/Piracy.test.ts`): embrace only when dead and only as a challenger, only with
  the toggle on; spawn only in deep space outside disc and moat and outside the exclusion; the hold
  grows by 100 per raid to 2,500 and the gold by 10k a raid, the freighter gone; land legs
  and shorelines skipped; a fleet in range not fired on, a warship is; a landing on neutral and on a
  Baron's coast claims exactly 100 tiles with no structure among them and starts the attack; on
  the domain, a bubble, an immune player, a teammate, in the last minute, on a rock under 100
  tiles: refused; a landing cancelled by a move order; a sunk corsair's cooldown doubles and the
  exclusion holds; a disconnect mark scuttles; a returned pirate who dies again may embrace again
  and runs one player execution; the Hegemon suites unchanged.

## 9. Still open (F22)

Every shaping question is decided (§3, §4). What remains is numbers: each value in §5 is a lever,
read off Saturday's headless runs first and the Sunday test after. One check for after the test:
whether a free 100-tile bite out of a defended coast feels fair to the bitten (PR8); if not, the
hold pays for the owner's tiles at the ordinary rate.

## 10. Amendments this makes elsewhere (slice D)

- `DarkStar-Design.md` **C1**: "cannot re-deploy" → "may return only as a pirate
  (DarkStar-Piracy.md)" [Done 2026-10-17]; **§4** F22 (pointer added 2026-10-14); **§10 Glossary**: _pirate_,
  _corsair_, _raid_, _hold_, _claim_; a §6 as-built note with the build.
- `DarkStar-Lobbies.md` **L31**: the death screen has a fourth action. [Done 2026-10-17]
- `DarkStar-Sound.md`: _embrace_ (the pirate alone), ~~_raid_ (pirate and victim)~~, _beaching_
  (the pirate and the coast's owner). [Done 2026-10-17: `embrace` and `beaching` wired from Tom's
  files; no raid cue, which would repeat all round long (Tom).]
- `resources/lang/en.json`: _Piracy Gold/min_ → _Raid Gold/min_ (PR17). [Done 2026-10-17, with a _Piracy_
  section on the help page's rules.]

## 11. Changelog

- **2026-10-14** — First draft from Tom's proposal: assessment, rules, numbers, touch points,
  eight decisions for Tom. Same day, Tom decided: pirates must be able to return; landings may go
  on other players' coasts; fragility accepted with a guaranteed 100-tile claim and nothing more;
  build it for the Sunday 2026-10-18 test behind a toggle; anonymous at sea, revealed on landing;
  two-click control; raid gold renamed and accumulated by pirates. Rules renumbered PR1–PR18
  (PR8 the claim, PR15 anonymity, PR16 raid gold, PR17 the word, PR18 leaving); §6 on performance
  and the elimination system; §7 the weekend plan; §9 the five questions still open.
- **2026-10-14, later** — Tom's answers to the five follow-ups: scuttle a leaving pirate's corsair
  (PR18), a sinking loses the whole hold (PR10), a slow heal anywhere (PR11, one health every 3
  ticks proposed), raid gold a flat 10k (PR16), the claim a free predetermined bite (PR8). Every
  shaping question is now decided; §9 is numbers only.
- **2026-10-15** — Slices A–C built on `feat/piracy`. Tom confirmed the hold figures are
  on-screen troops: `raidTroops` 1,000 and `holdCap` 25,000 in engine units (the engine stores
  ten times what it shows). A Lord's stargate aim crashed on a player just back from piracy
  (cluster box unset before its first PlayerExecution tick); the box now starts null. Later the
  same day, Tom: no selection box on the corsair (PR15); the corsair always sails at the chase's
  pace, two steps a tick (PR2); the wait is 15 s and runs from every elimination as well as every
  sinking (PR10).
- **2026-10-17** — PR17 done ahead of slice D (_Raid Gold/min_), and the help page's rules gain a
  _Piracy_ section with the round's elimination rule pointing at it (`HelpModal.ts`, `en.json`,
  `tests/client/HelpModalRules.test.ts`), so the friends test can read the mechanic. Slice D
  keeps the rest.
- **2026-10-17, later** — Slice D, most of it: the cues (`embrace`, `beaching`; no raid cue), C1 and
  L31 amended, the glossary rows; and Tom's call that **no piracy data is tracked** (PR14: the
  counters stay unread, no leaderboard line). Left of slice D: the as-built note in the design
  doc's §6 and the Lords check that a scuttle still triggers retaliation.
- **2026-10-20** — Tom: the respawn exclusion is gone (PR10). A sunk pirate may launch the next
  corsair anywhere a first one may, wreck site included, and the "too close" toast is removed;
  the wait alone separates corsairs. `respawnExclusion` and the sinking tile left the config, the
  player state and the wire.
- **2026-10-28** — PR13 notes that a returned challenger's win counts only for a player who was in
  the round from its start: in the planned rooms a drop-in's victory is void (Lobbies L44).
