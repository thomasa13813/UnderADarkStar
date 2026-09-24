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
  [Decided 2026-09-20] A raze is a **direct strike**: the Hegemon aims at any challenger tile and, after
  a flight time that grows with distance, the strike falls there and razes outward — no fleet, so it
  reaches inland players and works where the moat is a landlocked lake. [Built 2026-09-23, §6.9] The
  flight is a visible **projectile** on the nuke's arc from the Dark Star's centre, at nuke speed, with
  an impact ring on the aim tile; everyone sees it coming. It pays for the land from the Hegemon's fixed pool — [Decided 2026-09-21] at a
  **deliberately poor rate** (`razeAttackerLossPercent` / `razeSlowPercent`, 300/300: three times the
  troops and three times the time of an ordinary conquest) — runs until its troops are spent, the target
  has no land within reach, or it is recalled (survivors come home). It **can never eliminate** a
  challenger (H16). **Structures on razed land are destroyed.** The target can fight it (H17).
  [Built 2026-09-22] A human Hegemon orders one with the **Strike** action — its own `strike` order,
  never a fleet — on any challenger tile, sized by the troop slider; **one live strike per target**,
  any number of targets; a recall in flight brings the troops home whole, on the ground it pays the
  engine's retreat malus.
- **H9 — Diplomacy.** The Hegemon **cannot ally** with anyone. It **can donate** to any player, and any
  player can donate to it (H6). This needs a change to the engine, where donation currently requires
  the two players to be allied or team-mates (`canDonateGold` / `canDonateTroops` → `isFriendly`).
- **H10 — Hegemon warships are purely defensive.** It can build warships, but they are hostile only
  towards the player currently invading the domain.
- **H11 — AI Hegemon personality.** Defensive by default; when its troops have sat at the ceiling for a
  while it may launch a punitive attack at the most powerful challenger. [Decided 2026-09-20 — the
  "leveller"] Only while nobody is invading; "most powerful" is the largest **troop capacity** (land and
  cities), and only a real threat is struck (capacity ≥ 25% of the Hegemon's ceiling). It sends 25% of
  its troops at the target's greatest city, recalls the strike once the target is clearly below the
  runner-up (85% of their capacity) or the moment the Dark Star is invaded, then waits 90 s. All tunable.
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

- **H16 — Tyranny: the Hegemon cannot eliminate anyone.** [Decided 2026-09-21] A strike's troop cost is
  multiplied by a **tyranny** penalty that depends only on the **target's share of the map's land**
  (Dark Star tiles not counted; _not_ on its strength relative to the Hegemon). No penalty at
  `tyrannyFreePermille` (3%) and above; below that the multiplier is
  `(free − floor) ÷ (share − floor)`, rising without limit towards `tyrannyFloorPermille` (0.5%), at and
  below which a player **cannot be struck at all** (the strike is refused, or goes home if it razed its
  target down to the floor). Because the target shrinks as it is razed, every strike self-limits.
  Bullying the weak is ruinous; only a real power can be struck efficiently. Tyranny applies to strikes
  only: evicting an invader from the Dark Star is ordinary combat, so a player whose homeland is gone
  can still die on the Dark Star.
- **H17 — Strike counterplay: the bubble.** [Decided 2026-09-21; replaces the same-day "hold" design]
  A strike is an ordinary conquest: the land it takes is the strike's **bubble**, Hegemon-owned while
  the strike lasts and bordering the target, so the target **fights it like any other invader** — an
  attack order on the Hegemon (the HUD's **Counter-attack** button, or clicking the bubble) takes bubble
  tiles back over land. The bubble is **defended by the strike's own troops**, never by the Dark Star's:
  every tile retaken costs the strike its troops-per-bubble-tile (the bubble is costed as no smaller than
  `razeBubbleMinTiles`, 200), so a fresh compact bubble is expensive to breach and a sprawling one is
  soft — no explicit grace window. **Only the struck player may attack the bubble**; everyone else, and
  the AI, is refused until it pops (the invader's attack on the Dark Star itself is unaffected).
  **Structures the bubble rolls over are captured**, and die when it pops — retake the tile first and
  you keep your city. When the strike ends (troops spent, target at the tyranny floor, nothing left in
  reach, recalled, or the throne fallen) the bubble **pops**: whatever it still holds reverts to neutral
  for anyone to scramble over. Strikes are exempt from the engine's troop-for-troop cancelling. AI
  nations need no special rule: the engine's retaliation against an attacker already fights the bubble.

### 3.3 Challengers

- **C1 — Elimination is final.** [Decided 2026-09-21; replaces resettlement] A challenger who loses all
  territory is out of the round: they may **spectate or leave** to find another game (the engine's
  existing behaviour), and cannot re-deploy. In exchange, **only other challengers can eliminate a
  challenger** — never the Hegemon (H16).
- **C2 — Raids [Direction agreed, details open].** Challengers get an option to **raid** another player:
  an attack that razes territory back to neutral instead of claiming it.
- **C3 — Launch from the core.** At round start all challengers visibly **launch from the Dark Star to
  their starting territory** (an arc animation like the engine's nuke trajectories). [Built
  2026-09-24, §6.12] Presentation only, on the same projectile flight as strikes and stargate shots:
  when the spawn phase ends every human and nation launches from the Dark Star's centre to its spawn
  tile (Tribes are on the map from the start), the camera pulls out to the whole map, a territory's
  fill and name stay hidden until its projectile lands (its border shows from the start), and **the
  round begins when the last one has landed**: the opening is a phase of the sim between the spawn
  phase and play — nothing runs, nothing is earned, the clock holds at 20:00, orders queue — lasting
  the longest flight, capped at 15 s (longer flights are played faster); the ordinary 5 s spawn
  immunity starts at the landing, as in vanilla. The flights themselves are the client's alone (no
  units in the sim, nothing on the wire), so a reconnecting client and a replay skip them. The
  Hegemon watches its subjects scatter from the wide view. [Decided 2026-09-24 after Tom's first
  look] No landing rings; Tribes do not fly (acceptable for now, not a decision).
- **C4 — Stargates.** [Decided 2026-09-22; plan in §6.8] A challenger **structure** that launches a
  **strike-style projectile** carrying troops at any tile within its **range**: the shot flies an arc
  like a nuke and, on landing, **conquers** the tile and fights outward from it exactly as a transport
  landing does (the land is kept — a beachhead behind any coastline). Silo-like: costs gold, builds
  over time, one shot then a **cooldown**; the range is **small and grows with the gate's upgrade
  level**; a player may build **any number** of gates, each with its own reload. A shot **may land on
  the Dark Star** — an invasion that bypasses the moat, subject to the single-invader rule and the
  cooldown (H6, H12) — so gates are the late-game road to the throne. Troops for a shot come from the
  troop slider and leave at launch. **SAMs do not intercept** gate shots. One projectile unit type (`Projectile`, built 2026-09-23 for
  the throne's strike, §6.9) carries gate shots too, drawn in its owner's colours. [Built 2026-09-24,
  §6.10, humans only] Decided with the numbers in F15: a shot may target **any tile that is not the
  shooter's own** (neutral land included — a gate is the landlocked player's port); it lands and fights
  whoever holds the tile by then, or the troops simply join if it became a friend's; a shot bound for
  the Dark Star is refused at launch during the cooldown or while the slot is taken, and turns back
  (troops home at once) if the slot is claimed in flight; only the struck player may land on a strike's
  bubble; a shot in flight can be recalled, troops home whole. Raids (C2) will reuse the same delivery with a razing landing, later.
  [Built 2026-09-24, §6.11] **Nations build and fire gates** like silos: every nation, by a per-city
  ratio the difficulty sets, a first gate early, at most three; a nation ready for the throne wants a
  gate that reaches the moat and upgrades or builds towards it; a ready gate in range of the rim fires
  the invasion instead of a fleet; otherwise gates shoot at rivals beyond the nation's land, at neutral
  land across water, and last at a land neighbour's far side — never at friends, never a second shot on
  a pocket already fighting, never while holding the slot.

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
test map. (F3, F4 and F10 were resolved on 2026-09-20 → H12–H14, S1; F7 was dropped on 2026-09-21 with
resettlement — C1.)

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | **Calibrating Hegemon strength (H4).** Approach is decided; the numbers are not. [Proposed placeholders, in `HEGEMON_DEFAULTS`] troop ceiling = 100% of what ONE player owning every land tile of the map as authored could field (`2·(L^0.6·1000+50000)`; Milky Way ≈ 5.0M), regeneration = the standard curve against that ceiling, gold = 100/tick per 50k land tiles (Milky Way ≈ 886). To settle while building M1: what counts as "mid-round" (10 of 20 minutes?), which AI mix and difficulty the calibration games use, whether one curve over land-tile count fits all map sizes, and where in the 25–40% band to start. **Target [Decided 2026-09-20]:** roughly a third to a half of AI-only rounds end in an overthrow. First measurement (§6.5): 0/6 at ceiling 100%, 1/6 at 70%, 3/6 at 50%. **Superseded by §6.6:** with strike counterplay, 3/6 at ceiling 100% — re-measure after the last stand before changing the ceiling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F2  | **Invasion slot — presentation and tuning (H6, H12, H13).** Rules are settled. Remaining: how the slot, the invader, the stall state and each player's cooldown are shown to everyone (HUD indicator); whether the forced counter-attack switches off again if a stalled invader resumes advancing; and playtest tuning of the 5 s stall threshold and the 5 min cooldown.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| F5  | **Domain and moat dimensions (H1, H14).** Intent is decided (large legible disc; thin moat); numbers are not. Implemented as tunables in `HEGEMON_DEFAULTS` (`domainRadiusPermille: 90`, `moatWidthPermille: 10`, `moatMinTiles: 15` → Milky Way: radius 157, moat 17), centred on the map centre, **confirmed by Tom in play 2026-09-20 (name legible at full zoom-out, moat reads well)**; **[Built 2026-09-24, §6.12] a map declares its own Dark Star in `info.json` as `hegemon: { center: [x, y], radius, moat? }` (full-scale tiles, halved on a compact map; the moat falls back to the sizing rule; a disc that does not fit the map is refused at load), and the first galaxy map, Event Horizon (§5.3), uses it at exactly the computed size (radius 162, moat 18 on 1800×1800) — the dimensions to confirm by eye there.** [Proposed] Express both as fractions of the map's shorter side so they scale with any map: **domain radius ≈ 8–10%** (on a 2000-tile-wide map that is a disc ~350 tiles across, ~100k tiles — the engine sizes name labels to territory, so this reads clearly at full zoom-out) and **moat width ≈ 1%, minimum ~15 tiles**, tuned so a transport crosses in a few seconds. Confirm by building a test map and looking at it. Maps declare the centre in `info.json` (`hegemon: { center, radius }`) with a computed centre disc as fallback. Still open: what terrain the domain is, and how it is drawn (accretion-disc shader vs. ordinary territory fill).                                                                                                                                                                                                                          |
| F6  | **Raids (C2).** The Hegemon's side is decided (H8, H16, H17: direct strike at a poor rate, structures destroyed, cannot eliminate, can be held). Still open for challenger raids: what does a raid cost, and what stops raiding from being strictly better than conquering against a rival you can't hold ground from? Can a raid target the Hegemon's domain (presumably not — H6)? Measured caveat: a large AI resettles razed land almost at once, so a raze's lasting harm is the structures it destroys. [2026-09-22] Delivery is decided: a raid will be a stargate shot (C4) with a razing landing instead of a conquering one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| F15 | **Stargate numbers and details (C4).** The rules are decided; the numbers are not: range per level, gold cost and construction time, cooldown, whether an upgrade improves range or reload (or both), minimum troops per shot, how a shot on the Dark Star interacts with a fleet already bound for it, whether nations build and use gates from the start (§6.8 stage 5), and the final name (F14). [Decided 2026-09-23] The projectile flies at **nuke speed** (`strikeSpeed`, 10 tiles per tick) on the standard nuke arc, with a single impact ring at the 200-tile bubble footprint and no aim preview. [Decided 2026-09-24, starting points in `STARGATE_DEFAULTS`] **Range 120 tiles at level 1, +60 per level, capped at level 5 (360)** — on World, nations spawn a median 75 tiles apart and ~280 from the moat, so a level-1 gate reaches a neighbour's heartland and the throne needs a forward gate or upgrades; **an upgrade buys range only** (reload fixed; more throughput = another gate); **1M gold, 10 s to build, 60 s reload** (a silo: 1M, 10 s, 9 s), upgrades priced as another gate; minimum 1 troop per shot, no maximum; same projectile speed as the strike; the nearest ready gate fires, the tooltip names the wait when none is. [Decided 2026-09-24, §6.11] Nations build and fire gates from the start, under the AI's own numbers (a per-city ratio by difficulty, first gate at 0.4 per city, cap 3, in `NationStructureBehavior`; firing eagerness by difficulty in `NationStargateBehavior`). Still open: what a shot on the Dark Star does to a fleet already bound for it (nothing today), whether the gate numbers survive F1, and whether exclaves need a cap (§6.11 measures them). |
| F8  | **Nukes around the Dark Star (H7).** Domain tiles are immune but targetable: a nuke aimed at them lands and does nothing [Decided]. Still open: Can the Hegemon itself build silos and nuke challengers, and if so is that land razed or merely irradiated? Are SAMs/defense posts available to it?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F9  | **Donations (H6, H9).** Are donations open between _any_ two players now, or only to/from the Hegemon and to the current invader? Any limits to prevent a coalition funnelling everything into one super-invader — or is that the intended strategy?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| F11 | **Hegemon toolkit (H15).** The role is decided — balance-of-power counterweight — and strikes cost normal troops, so spending the pool on strikes versus keeping it for defence **is** the core decision [Decided]. Still open: are razing and donations enough, or does the Hegemon need more (nukes — see F8; embargo-like edicts; visibility into challengers' strength)? Note that regeneration at the current F1 placeholder refills a 25% strike in under a minute, so the tension is weak until F1 is calibrated. [2026-09-22] Visibility is built: the throne's challenger table (§6.7). New from the first human seat: a do-nothing Hegemon loses 95% of the domain to one invader (H13 only bites on a stall) — should a human get the AI's landing wave too, or is active defence the point?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F12 | **Edge cases.** Hegemon disconnects mid-round (AI takes over?); the invader disconnects; an AI challenger (Nation/Tribe) lands the killing blow (next round gets an AI Hegemon per R6?); team modes (probably out of scope at first).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F13 | **Hegemon identity across rounds.** Beyond the high-score table (S5): titles, reign counter in the lobby, anything inherited besides the seat.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F14 | **Names.** Sci-fi names for units, structures, Tribes/Nations and resources (rename surface in §5.4). [Decided 2026-09-24] A first pass on the Event Horizon map only: its 24 nations carry sci-fi polity names (Orion Combine, Vega Ascendancy, … in its `info.json`) and its Tribes draw on the `space` theme; units, structures and resources keep their names for now.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

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
  next round you defend the throne against AI challengers. [2026-09-22] The **seat** is a modal
  toggle ("Play as the Hegemon") that sets `isHegemon` on the human's player entry and nothing else:
  that one boolean is the seam a future throne module drives (persisting the reign, the winner
  choosing the next map, rule sliders — none built).
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
- **A map's own Dark Star [Built 2026-09-24, §6.12]:** `info.json` may carry
  `hegemon: { center: [x, y], radius, moat? }`; the Go generator passes it through to `manifest.json`
  untouched, `loadTerrainMap` validates and halves it for a compact map, and both the sim and the
  client build the disc from it (a centred disc sized from the map when absent, as before).
- **Event Horizon** (`map-generator/assets/maps/eventhorizon/`, category `cosmic`, 1800×1800,
  ~450k land tiles, 24 nations) is the first galaxy map authored around the Dark Star: three spiral
  arms of star clusters in an annulus around an open centre, spiral lanes of deep space between the
  sectors, void at the corners, the nations in a ring at about 400 tiles from the centre. It is
  written by `scripts/generateGalaxyMap.ts` (deterministic for its seed; `--seed`, `--size`,
  `--land`) — `image.png` and `info.json` — and then `npm run gen-maps` as for any map. The Go
  toolchain lives at `<home>\go-sdk\go\bin` on Tom's machine (the official zip, no installer).
- **Gap:** terrain colours are global, not per-map, and map thumbnails are hard-coded
  blue-sea/green-land in `map-generator/map_generator.go` (`getThumbnailColor`).

### 5.4 Presentation

- **Renderer:** hand-written **WebGL2** (not Pixi.js) — `src/client/render/`, documented in
  `src/client/render/CLAUDE.md`. HUD is Lit components in `src/client/hud/layers/`.
- **Colours are data:** terrain palette in `src/client/render/gl/render-settings.json` (`terrain.*`,
  overridable via `TerrainColorOverrides` → `TerrainPass.setTerrainColors`); player palettes in
  `src/client/render/gl/default-theme.json`. A DarkStar theme is mostly a new JSON file.
- **The Hegemon's look (2026-09-24):** by default the seat is drawn as a black hole — near-black fill,
  a purple border band two tiles wide and a pale one-tile rim outside it (`theme.hegemon.*` in the
  theme JSONs, band width `mapOverlay.hegemonBorderThicken`). The fill is drawn near-opaque
  (`mapOverlay.hegemonFillAlpha`) so the terrain does not tint it, and the name is drawn light
  (`name.nameShadeHegemon`). It is a default, not a uniform: a seat holder with their own colour
  cosmetic or pattern palette keeps it and gets an ordinary single border, and in team games the
  team colour wins. `PlayerView.rimColor()` decides; `WebGLFrameBuilder.syncHegemonLook` pushes the
  owner to the renderer; `BorderComputePass` flags the band (G channel), `BorderStampPass` paints
  rim and band, `TerritoryPass` and the name pass apply the fill alpha and name shade.
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

### 6.3 As built — invasion economics and the first HUD (2026-09-20)

- **The invader gains nothing from the Dark Star (H5).** `Player.domainTilesHeld()` is subtracted from
  the tile count in `Config.maxTroops` and from the attacker's `numTiles` in combat (the large-territory
  bonuses). Before this, every domain tile raised the invader's own troop cap, so a successful invasion
  snowballed.
- **Client state.** `PlayerUpdate` carries `domainTilesHeld`, `invasionCooldownUntil` (a tick) and
  `invasionStalled` (set on the invader; `HegemonExecution` → `Game.setInvasionStalled`). `GameView.hegemon()`
  and `GameView.darkStar()` (geometry recomputed client-side from the map size) serve the HUD.
- **HUD (minimal, pulled forward from M2).** The **crown** marks the Hegemon while it lives — on the map
  (`computePlayerStatus`'s `hegemonSmallID`) and in the hover overlay (`getFirstPlacePlayer`). A
  **`dark-star-panel`** under the game timer shows the Hegemon's troops against its ceiling, the share
  of the domain it still holds, the invasion status (unchallenged / invader's name / you are invading /
  stalled) and the viewer's re-invasion cooldown. Strings under `dark_star.*`. Not yet verified in the
  browser when written.

### 6.4 As built — razing and punitive strikes (2026-09-20)

- **`RazeExecution` (H8).** The engine's attack only advances over tiles next to the attacker's own
  land; the Hegemon borders nobody and razed tiles never become its own, so a strike keeps **its own
  frontier**: the set of tiles it has razed, advancing over the target's tiles next to those (whoever
  holds them now; rebuilt from the whole set when it runs dry, since the target may have resettled).
  Troops leave the Hegemon at launch; after a flight from the domain centre (a counted delay at first;
  since 2026-09-23 a real projectile, §6.9) it lands on the aimed tile, creates an ordinary `Attack` (source tile set, so the HUD and
  the engine's troop-for-troop cancelling of opposing attacks work) and razes with `Config.attackLogic`
  costs via `relinquish()`. Structures die because `PlayerExecution` already deletes units on unowned
  land. If the tile changed hands in flight the troops come home. A recall costs the engine's 25% retreat
  malus. The target is warned (`events_display.dark_star_strike_inbound`).
- **No wire change.** A Hegemon's existing `boat` intent aimed outside the Dark Star becomes a
  `RazeExecution` (`ExecutionManager`); the client UI for it belongs to the play-as-Hegemon chunk.
- **Guards.** A Hegemon `AttackExecution` skips tiles outside the Dark Star (H8), and neither absorbs a
  raze strike when merging attacks on the same player nor counts one as a defence of the domain.
- **Punitive strikes (H11), `HegemonExecution.punish`**, AI Hegemon only; tunables `punitive*` in
  `HEGEMON_DEFAULTS`. Two findings from `HegemonSim` shaped it: (1) "most troops right now" flips every
  few seconds as nations spend their armies, so strength is **capacity** (`Config.maxTroops`); (2) with
  close leaders a single razed city ended every strike within a second, so the recall has hysteresis
  (`punitiveRecallPercentOfRival`), and the aim is the target's **highest-level city** (nearest border
  tile as fallback) because razed land is resettled almost immediately.
- **Measured (AI-only, 20 min).** World: 8 strikes from minute ~4, most 6–60 s, razing 4–16k tiles and
  3–4 cities and costing the Hegemon 0.1–1.5M troops; they fall on four different nations and nobody
  invades (previously Benin invaded at 16:25 and won at 18:43) — the Hegemon wins on the timer. Milky
  Way: 4 strikes; Predators, struck twice, invade at ~minute 15 and are evicted. Against a strong
  target with few neighbours a strike can burn all its troops for almost no net land.
  `HegemonSim` now logs every strike.

### 6.5 As built — AI challengers go for the throne (2026-09-20)

- **Before:** a nation only ever landed on the Dark Star by accident — a random boat (which skips
  targets stronger than itself) or retaliation for a strike — and with a fifth of its army.
- **`NationHegemonBehavior`** (`src/core/execution/nation/`), asked by `NationExecution` before
  `maybeAttack()`; if it acts, the nation leaves its other wars alone that turn. Nations only — Tribes
  never invade [Decided]. Nations stay **self-interested**: nothing helps another invader [Decided].
  - **Launch:** the slot is free for it (`canInvadeDarkStar`), no fleet of its own is already bound for
    the Dark Star, and its troops reach a share of the Hegemon's **current** troops that falls linearly
    over the round (`aiInvadeTroopPercentAtStart` 100 → `aiInvadeTroopPercentAtEnd` 50): bolder as the
    timer runs down, and opportunistic when the Hegemon has just spent troops on a strike or on another
    invader. It sends `aiInvasionSendPercent` (70%) to the nearest point of the domain's rim.
  - **Push:** while it holds the slot, every attack turn it sends everything above
    `aiInvasionReservePercent` (20% of its capacity) into the land attack.
- **Measured (AI-only, 20 min, 3 seeds per map; `HegemonSim` now prints a round summary).** Invasions
  begin at minute ~10 (was ~13–16 on World, almost never on Milky Way), 3–5 per round by different
  nations in succession. At the current F1 placeholder the throne holds every time: **0 of 6 overthrown**,
  domain never below 68%, Hegemon troops down to 1.3–2.9M. With `--ceiling 70`: 1 of 6 (and one round to
  1% of the domain); `--ceiling 50`: **3 of 6**. Target agreed with Tom: roughly a third to a half of
  AI-only rounds end in an overthrow — so F1 lands near 50–60% of today's ceiling _for AI challengers_;
  humans will be stronger, and the last stand will pull the other way.

### 6.6 As built — strike counterplay and tyranny (2026-09-21)

- **Why.** Tom's playtest: strikes felt "punishing and effectively unstoppable". Checked in the running
  game: the HUD's Retaliate button _did_ cancel a strike troop for troop, but it was a trap — a strike is
  25% of the Hegemon's pool (1.56M, several times a challenger's army), razing cost it only ~35–100
  troops a tile (3.4k tiles gone in 13 s, 70% of the strike went home), spending your army on the cancel
  lowered your troop density and made the rest of the razing _cheaper_, and nothing on screen said a
  strike could be fought at all.
- **First attempt, replaced the same day:** a 5 s grace window, then a "hold" — troops committed to an
  abstract defence pool froze the razing and ground the strike down 3:1, with a Defend button and an AI
  defence rule. Tom: the fight "halted basically immediately" and it over-complicated things; he proposed
  the bubble instead. The hold, its two `AttackUpdate` fields, the AI rule and the tunables are gone.
- **Cost and speed (H8).** `RazeExecution` scales `attackLogic`'s attacker loss by
  `razeAttackerLossPercent` × tyranny and its tick cost by `razeSlowPercent`.
- **Tyranny (H16).** `Config.hegemonTyrannyLossPercent(tiles)` (null = immune), from the map's land as
  authored. Checked at launch (refused, with a message to the Hegemon) and before every tile (the strike
  goes home at the floor). World ≈ 690k land tiles: floor ≈ 3.4k tiles, no penalty from ≈ 21k.
- **The bubble (H17).** `RazeExecution` lands by conquering the aimed tile for the Hegemon and advances
  the engine's way (target tiles next to Hegemon tiles — the domain borders nothing, so any such tile is
  bubble), recording what it took; `pop()` relinquishes whatever it still holds. The `Attack` is
  `markStrike()`ed. **No wire change** beyond `AttackUpdate.isStrike`. In `AttackExecution`: strikes are
  excluded from the cancel loop; a land attack on the Hegemon by a player holding no domain tile and not
  `isStruckBy()` it is refused before troops are taken (also `Player.canAttack(tile)` for the UI), and its
  tile loop skips bubble tiles for anyone but the struck player; bubble tiles are costed against the
  strike (`Game.hegemonBubbleTiles()`, floored at `razeBubbleMinTiles`) and the defender loss comes off
  the strike, not the Hegemon. `GameImpl.conquer` pops every bubble the moment the Hegemon loses its last
  Dark Star tile, so the conqueror's attack sees it dead and records the killing blow (R2/R3). **Orphans
  (2026-09-22):** the engine's enclave rule (`PlayerExecution.removeCluster`) hands the Hegemon any
  pocket of the target's land a jagged bubble seals in, behind the strike's back, so a pop that only knew
  its own conquests left those tiles standing, unattackable once the strike was gone. Now every strike is
  registered for its whole life (`Game.hegemonStrikes()`), a bubble **adopts** whatever Hegemon land
  beyond the moat it touches (when its front is refreshed and when it pops), and a pop then **sweeps** any
  remaining Hegemon tile beyond the moat that no other live strike's bubble claims. `HegemonExecution`
  also sweeps every 10 ticks when no strike is alive at all, so nothing can stand beyond the moat without
  one. Captured
  structures ride the engine's existing capture-on-conquest; the pop leaves them on unowned land and
  `PlayerExecution` deletes them. `Game.hegemonDomainTiles()` is the domain share (the HUD's "Domain
  held" and the sim use it; `numTilesOwned` includes the bubble).
- **HUD.** A purple "Dark Star strike" row in `attacks-display` with a **Counter-attack** button (the
  ordinary attack intent) and a hint; the front's map label reads "STRIKE n". The inbound warning says
  the strike holds nothing once it ends. `.claude/skills/run-openfront` now works on Windows (real GPU;
  the game refuses software WebGL).
- **Measured (`HegemonSim --set key=value,…` overrides any tunable; it logs each strike's bubble peak,
  what popped to neutral and whether the target fought).** AI-only, 3 seeds × World + Milky Way: AI
  targets fight 24 of 32 strikes with no special code; a fought strike lasts 30–56 s with the density
  floor at 200 (without it, a big standing army snuffed a fresh 8-tile bubble in 1 s — each tile retaken
  cost the strike an eighth of itself); bubbles peak at 100–3,400 tiles and pop 0–2,700 to neutral; the
  Hegemon burns 2–7M troops a round on strikes for 150–8,000 popped tiles — very poor value, as intended.
  Overthrows: 2/6 without the floor, 0/6 with it (small samples; re-measure with the last stand).

### 6.7 As built — playing the Hegemon in singleplayer (2026-09-22)

Narrow by design: the seat in one game, nothing about who holds the throne between games.

- **The seat.** The singleplayer modal's "Play as the Hegemon" toggle (shown under the Dark Star
  toggle, FFA only) puts `isHegemon: true` on the human's player entry; everything downstream already
  existed (`GameImpl.seatHegemon` takes a flagged human over creating the AI, `SpawnExecution` refuses
  its spawn, `HegemonExecution` skips the AI's response waves and punitive strikes for a human). Two
  things did not: a singleplayer spawn phase only ended when the human spawned, so a seated human waited
  forever — `HegemonExecution.maybeEndSpawnPhase` now ends it once every nation has taken its place (or
  after 10 s); and the win modal treated an enduring Hegemon as an AI "nation" win.
- **The strike order.** A new `strike` intent (`tile`, `troops`; appended to the wire union) replaces
  the boat piggyback — the Dark Star sends no fleets, and the schema now says so. The radial menu's boat
  slot becomes **Strike** for the Hegemon (any challenger tile beyond the Dark Star, sized by the troop
  slider), with a tooltip giving the troops and the tyranny cost ("×N", "too small to strike", or
  "already striking"). No left-click auto-strike: launching a share of the army takes the menu. The
  Hegemon's plain attack is refused beyond the Dark Star (`Player.canAttack`), so the centre button and
  a left click on a challenger do nothing.
- **In flight.** `Game.strikesInFlight()` holds a strike between launch and landing (`StrikeInFlight`,
  implemented by `RazeExecution`); `PlayerImpl.toUpdate` rides it on the attack arrays as an
  `AttackUpdate` with `isStrike`, `aimTile` and `landsAtTick`, for the Hegemon (outgoing) and the target
  (incoming). The landed `Attack` keeps the in-flight id, so the HUD sees one row from launch to end.
  **One live strike per target** (`Game.hegemonStrikeOn`, refused with a message). A recall is the
  ordinary `cancel_attack`: `PlayerImpl.orderRetreat` recalls an in-flight strike by id.
- **HUD.** `attacks-display`: the Hegemon's strike row ("Strike on X · landing in Ns / Razing", Recall);
  the target's inbound row shows the countdown and hides Counter-attack until it lands; clicking either
  jumps to the aim tile. `dark-star-panel` from the throne: the H13 line reads "your income is being sent
  against the invader", a "Your strikes hold N tiles" line, and a **sortable challenger table**
  (nations and humans, never Tribes): troops, capacity (`Config.maxTroops`), cities, land share, and
  strike status (Free / ×N / Immune / Striking / Invading). Win modal: "The Hegemon Reigns Supreme"
  (a win from the throne, a loss for everyone else) and "Overthrown by X" for a fallen human Hegemon.
- **Sim.** `HegemonSim --human` seats a passive human (no waves, no punitive strikes; stall routing
  only). **World, seed a: a do-nothing throne survives on the timer with the domain at 5%** — Ethiopia
  lands at 15:12 and grinds it down while the Hegemon's troops never drop below 5.2M, because H13 only
  fires on a stall and an advancing invader is otherwise unopposed. A human Hegemon must defend by
  attacking the invader's domain tiles; whether it should also get the AI's landing wave is a playtest
  question. AI-only rounds are unchanged (4 strikes, all fought, 5 landings, throne holds).
- **Verified in the browser** (Playwright, World, 50 Tribes): toggle → seated with the whole domain and
  full troops at tick 14, no spawn prompt, table populated; at minute ~0.6 Russia crossed the tyranny
  floor, tooltip "Strike Russia with 1.25M troops / Tyranny: ×11.8", strike row "Landing in 4s", landed
  with a 211-tile bubble and "Razing", recall returned the survivors (troops 5.29M → 6.18M).
- **Deferred:** donations (H9), the all-in last stand (an AI rule tied to F1), a map marker or arc for
  the flight, throne persistence (§5.2).

### 6.8 Plan — projectiles, stargates and the opening (2026-09-22) [Stages 1–3, 5 and 6 built, §6.9–§6.12]

Tom's direction: balance later, gameplay first; stargates (C4) are the mechanic that sets DarkStar apart
from OpenFront, and the flight they need is the same one the throne's strike and the opening (C3) want.
Decisions taken 2026-09-22 are in C4. What the engine offers, then the stages.

**What is already there.**

- **A gate shot is a boat landing without the boat.** `TransportShipExecution` on arrival does
  `attacker.conquer(dst)` and starts `new AttackExecution(troops, attacker, target, dst, false)` — an
  attack seeded from the landing tile, troops paid at departure. That is the beachhead. The throne's
  `RazeExecution` differs only in razing instead of keeping the land.
- **The nuke flight is a real unit on a sim-driven Bezier arc** (`NukeExecution` +
  `PathFinder.Parabola`), with a **motion plan** recorded at launch so the client derives its position
  each tick and `UnitPass.applyMissileSmoothing` lerps between ticks. Incoming-target circles
  (`NukeTelegraphPass`), launch/impact sounds and shockwave FX hang off small per-type registrations
  (`SMOOTHED_NUKE_TYPES`, `MISSILE_TYPES`, `FxSettings.nukeExplosionRadius`, `SoundEffectController`).
- **The throne's strike has no visual today** — it counts ticks and lands. Making it a projectile unit is
  the change that unifies strikes, gate shots and the opening.
- **Costs to know.** The sprite atlases (`resources/atlases/*.png`) are committed PNGs and the generator
  the code refers to is not in the repo — a new unit or structure column is hand-edited until we write
  one. `UnitType` enum order and `StatsSchemas.otherUnits` order are zbin wire contracts: **append
  only**. No SAM interception means no entry in `SAMMissileExecution`'s whitelist.

**Stages** — each its own branch with tests and a browser check; the game stays playable after each.

1. **Tooling (small). [Built 2026-09-23]** An in-repo atlas generator from `resources/sprites/` for the unit, structure and
   fx atlases, and an "adding a unit type" checklist in `src/client/render/CLAUDE.md`. v1 art: the atom
   bomb glyph for the projectile (in its owner's colours — the shader does the colouring), a placeholder SVG for the gate (stage 3).
2. **The strike as a projectile (medium). [Built 2026-09-23]** A new projectile `UnitType` (appended), launched from the
   Dark Star's centre on the Parabola pathfinder with a motion plan; `RazeExecution` lands when the unit
   arrives (flight time = distance ÷ speed, like a nuke, replacing `razeTravel*`). Registered as a
   smoothed missile, with a telegraph circle on the aim tile, launch and impact cues. Delivers the
   "nuke-style strike" on its own; everything after reuses it.
3. **Stargates (large). [Built 2026-09-24, §6.10]** `UnitType.Stargate` in `Structures` (cost, construction time, `upgradable`,
   silo-style cooldown via `missileTimerQueue`; `StargateExecution` modelled on `MissileSiloExecution`).
   A `stargateSpawn` beside `nukeSpawn`: nearest ready gate within `stargateRange(level)`. Aiming like a
   nuke: on a tile in range the attack submenu offers the shot, sized by the troop slider; a range ring
   (`RangeCirclePass`) while placing and hovering. A `gate_shot` intent (tile, troops — it carries
   troops, so not `build_unit`). The shot flies as the stage-2 projectile and lands as the boat landing;
   a landing on the Dark Star goes through `canInvadeDarkStar` and turns back like a fleet if the slot
   is taken. Humans only.
4. **Build-menu growth (medium, parallel with 3).** The modal already wraps and scrolls; the radial build
   submenu becomes a **scrollable list** past the current slice count; **no hotkey** for new types.
5. **AI gates (medium). [Built 2026-09-24, §6.11]** Nations build gates (`NationStructureBehavior` ratio table) and shoot at
   neighbours they cannot reach over land, and at the throne when `NationHegemonBehavior` would invade.
   Without this, gates are a human-only edge and the sim's numbers mislead.
6. **The opening, C3 (medium, M2). [Built 2026-09-24, §6.12]** Presentation only: during the spawn-immunity window after the
   spawn phase ends, the camera pulls out, every player's projectile flies from the Dark Star to its
   spawn tile on the stage-2 flight drawing, territory is revealed as each lands, play begins when
   immunity ends. No sim change; the Hegemon watches its subjects scatter.

Balance (F1, the last stand) follows stage 5.

### 6.9 As built — atlas tooling and the strike as a projectile (2026-09-23)

Stages 1 and 2 of §6.8, narrow by design: no stargate structure, no menu changes.

- **The atlas generator.** `npm run gen-atlases` (`scripts/generateSpriteAtlases.ts`, node only — its
  own PNG codec, since `canvas` is not built under `--ignore-scripts`) rebuilds `unit-atlas.png`,
  `icon-atlas.png`, `fx-atlas.png` and `fx-atlas-meta.json`; `--check` verifies without writing. The
  generator the passes cited (`generate-sprite-atlases.mjs`) never existed in the repo or upstream.
  Findings from reproducing the committed atlases: the unit and fx atlases rebuild **pixel-for-pixel**,
  but five unit glyphs (warship, atom bomb, hydrogen bomb, MIRV, SAM missile) were never the
  `resources/sprites/` PNGs of that name — the GL renderer's glyphs are smaller resamples with no source
  in git — so they now live as their own files in `resources/sprites/gl/`, extracted from the atlas. The
  icon atlas is anti-aliased SVG renders from an unknown rasteriser: a Chromium render (Playwright) of
  the same SVGs matches five columns to within anti-aliasing (max alpha delta 55), while the committed
  silo glyph matches no SVG in the repo and is kept as a PNG cell. Icon columns already in the committed
  atlas are therefore copied unchanged; only new columns are rendered. The renderer guide gained the
  "adding a unit type" checklist.
- **`UnitType.Projectile`** (appended — enum order is zbin wire order; no stats entry, the strike already
  records `stats().attack`) with `targetTile` + `trajectory` params, cost 0, spawnable anywhere. It is
  skipped by a nuke's unit kill, and SAMs cannot target it (whitelist).
- **`RazeExecution`** builds the projectile at the Dark Star's centre and records a grid motion plan the
  way `NukeExecution` does (the same Parabola pathfinder, `strikeSpeed` tiles per tick, replacing
  `razeTravelMinTicks` / `razeTravelTicksPer100Tiles`); `landsAtTick` is the exact landing tick, known at
  launch. On arrival the unit is moved onto the aim tile, marked `reachedTarget` (the client's impact
  cue) and deleted, and the strike lands as before. A recall in flight deletes the unit without an
  impact; the throne falling in flight removes it too. The in-flight HUD row and `Game.strikesInFlight()`
  are unchanged.
- **Client.** `UT_PROJECTILE` appended to `ALL_UNIT_TYPES`; a 13th unit-atlas column (the atom bomb
  glyph); `SMOOTHED_NUKE_TYPES` + `MISSILE_TYPES` (lerped between ticks, drawn above structures, a
  nuke-style trail), **owner colours, no flicker** (decided: one shared type, so a future gate shot flies
  in its owner's colours for free); an impact ring on the aim tile through `NUKE_MAGNITUDES`
  (`PROJECTILE_TELEGRAPH_RADIUS` = 8, the ~200-tile bubble footprint, one ring); a small shockwave and
  flash at impact (`fx.strikeImpactRadius`); the atom launch/hit sounds stand in as cues.
- **Measured.** World seed a, AI-only: identical to the previous build until the first strike lands at
  minute 2.8, then the rounds diverge on timing (a flight is now the arc ÷ 10 tiles/tick, 5–8 s on World
  rather than 3 s + distance); both end with the throne holding on the timer (before: 4 strikes,
  5 landings, domain low 16%; after: 3 strikes, 2 landings, domain low 36% — one seed, not a trend).
  Browser (Playwright, World, 50 Tribes, human throne): a strike on Russia launched at tick 390 landed
  at tick 447 exactly as the HUD announced, trail and impact ring visible, bubble grew from 6 to 155
  tiles in 3 s; a second strike recalled in flight vanished and its troops came home.
- **Deferred.** Own art and sounds for the projectile; an aim preview (no hover phase to draw it in);
  a launch marker at the Dark Star.

### 6.10 As built — stargates for human players (2026-09-24)

Stage 3 of §6.8. Humans only (nations neither build nor fire gates, stage 5), no build-menu redesign
(a seventh structure slice fits the generated radial submenu), no raids.

- **`UnitType.Stargate`** (appended; in `Structures`, so the build menu, upgrades, capture and
  destruction come for free; no stats entry — the stats table would need a column for one) with the
  numbers in F15 as `STARGATE_DEFAULTS` (`Config.stargateRange(level)`, `stargateCooldown()`), placed
  like a silo. `UnitInfo.maxLevel` is new (level 5); `canUpgradeUnit` honours it. The Hegemon cannot
  build one (`canBuildUnitType`). `StargateExecution` reloads it after the cooldown; a gate holds one
  shot whatever its level (a silo's level is its charge count — not reused).
- **`Player.stargateFor(tile)`**: the nearest built gate with the tile in range, a ready one before a
  reloading one, as `{ gateId, gateTile, level, range, readyInTicks }`; the worker puts it on
  `PlayerActions.gateShot` for the client.
- **`gate_shot` intent** (tile, troops; appended to the wire union) → `GateShotExecution`: refused for
  the Hegemon, water, the shooter's own or a friend's tile, a strike's bubble unless the shooter is the
  struck player, the Dark Star under the transport's own rules (cooldown / occupied messages), and when
  no gate in range is ready (`events_display.gate_shot_no_gate`). Otherwise the troops leave at launch
  **on the unit** (`Projectile` gained an optional `troops` param, so the HUD's boat rows show them), the
  gate goes on cooldown, the target is warned (the naval-invasion inbound row), and the shot flies the
  strike's arc from the gate. Landing = `TransportShipExecution`'s arrival without the boat: conquer the
  tile, `AttackExecution` from it; on the Dark Star that claims the slot and the throne's landing wave
  answers (§6.2). Ours or a friend's by then: the troops join. Mid-flight, a Dark Star shot whose slot is
  claimed by someone else turns back (`dark_star_turned_back`, troops home at once). Recall =
  the boat cancel order on the projectile's unit id (`BoatRetreatExecution` falls through to
  `Game.gateShotsInFlight()`).
- **Client.** `UT_STARGATE` (structure set, atlas column via the generator from a placeholder ring
  SVG, shapes + light settings); build-table entry with no hotkey; the attack submenu gains a **Gate
  shot** slice whenever `gateShot` is set, sized by the troop slider, tooltip "Gate shot: N troops / From
  a level L gate (R tiles range)" and "Gate reloading: Ns"; `RangeCirclePass` draws a second, blue ring
  (the firing gate's range) while the radial menu is open on a reachable tile (`ShowAimRangeEvent`,
  cleared whenever the menu hides) and the white placement ring while placing or upgrading a gate;
  shots ride the boat rows (troops, target, ETA, recall) with the gate icon; the silo's build cue.
- **The enclave rule and beachheads (found by Tom in play, 2026-09-24).** A gate shot's landing is a
  small cluster sealed in by one enemy, and `PlayerExecution.removeClusters` (every 20 ticks) hands such
  a cluster to the player around it: the pocket vanished within two seconds, the attack lost its
  frontier and retreated, and the troops came home without a loss — an invasion that "failed on
  landing". Transports never met this because a shore tile borders water, which the surrounded check
  treats as a way out. A first fix exempted a pocket only while its landing attack lived; Tom then saw
  the pocket pop the moment the attack burnt out unless it had reached water or joined his main land.
  **Decided (options weighed 2026-09-24: a structure anchor, a size floor, a grace period, absorb only
  under attack, tagging every landed tile, or conceding strikes as troop sinks): the landing tile is a
  tagged "beachhead".** `Player.markBeachhead(tile)` at landing; the tag is dropped the moment the tile
  changes hands (`GameImpl.conquer` / `relinquish`); `removeCluster` never absorbs a territory holding a
  beachhead tile. Nothing else changes: a pocket that reaches water or joins the homeland is stable by
  geometry anyway (the checks are redone every 20 ticks), so the tag only matters for a landlocked
  exclave, which now stands until someone retakes the tile it landed on — then it is an ordinary enclave
  again. No unit, nothing drawn, nothing on the wire (every client runs the sim). On the Dark Star the
  invader's foothold therefore falls to the throne's reconquest (the landing wave, or the H13 counter-
  attack once the invasion stalls), never by fiat. Known consequences, accepted: the rule is invisible
  (a marker for the owner is a later nicety); the landing tile is a single hidden weak point of a
  landlocked pocket; exclaves accumulate with shots, to be revisited once nations fire gates (stage 5).
  Boats are unchanged (a shore landing was never absorbable).
- **Tests.** `tests/Stargate.test.ts` (15): build/cost/level cap, `stargateFor` and ranges, refusals,
  flight and beachhead on neutral and enemy land, the intent, recall, a Dark Star landing claiming the
  slot, refusal while the slot is taken, the mid-flight turn-back, the bubble rule, and the enclave
  rule against a beachhead inside a nation and inside the Dark Star (with real combat and the players'
  own `PlayerExecution`s, which `setup()` does not add): the pocket outlives its attack, falls when the
  landing tile is retaken, and the Dark Star foothold falls to the H13 counter-attack.
- **Measured.** World seed a, AI-only: byte-identical to the previous build (no AI gates). Browser
  (Playwright, World, 30 Tribes, a human spawned 155 tiles from the centre with infinite gold): two
  gates built, placement ring 120 tiles wide reaching the moat, aim ring and the submenu slice with its
  tooltip, a shot at Madagascar 105 tiles away in the air ~10 ticks with its HUD row, a shot on the
  domain that landed, claimed the slot and was evicted by the landing wave — the panel then showed the
  5-minute cooldown.
- **Deferred.** Own art for the gate; a "gate shot" label instead of the boat row's; whether a shot on
  the Dark Star should turn back a fleet already bound there; the menu list (stage 4) once more slices
  arrive. AI gates followed as §6.11.

### 6.11 As built — nations build and fire stargates (2026-09-24)

Stage 5 of §6.8. Decided with Tom before building: every nation gets gates under the silo's
affordability logic, with the difficulty setting how many and how eagerly; a gate sits before the silo
in the build order; far-side shots into a land neighbour are allowed at the lowest priority; the gate
fires the invasion ahead of the fleet and never reinforces its own foothold. No new gate rules or
numbers for humans, no menu work, no balance change.

- **Building (`NationStructureBehavior`).** `UnitType.Stargate` joins the ratio table (per city:
  Easy 0.10, Medium 0.15, Hard 0.20, Impossible 0.25; perceived cost +100% per gate owned, so the
  nuke save-up still applies), the first gate at 0.4 per city like the first silo, a hard cap of
  three, in the build order Port → Factory → SAM → **Stargate** → Silo. Hegemon mode only (the
  behaviour is handed the nation's `NationHegemonBehavior` and asks `game.darkStar()`). **The throne
  want:** while `wantsThrone()` holds (slot free for it, troops at the falling bar of §6.5) and no gate
  reaches the rim, the nation upgrades the gate that falls least short if its levels left would close
  the gap (`gateReaches()`: gate, the rim tile it would aim at, shortfall), else builds a first gate —
  before any other structure. **Placement** (`stargateValue`): interior and spaced like a silo, minus a
  third of a point per tile from the aim: the Dark Star's edge in the throne state, else the centre of
  the nearest hostile player whose land does not touch ours.
- **The invasion by gate (`NationHegemonBehavior`).** The launch decision is unchanged; when it fires,
  a ready gate whose range reaches the rim (`rimTileToward(gate)`: where the line to the centre enters
  the disc) shoots the same `aiInvasionSendPercent` share of the army at that rim tile through
  `GateShotExecution`, and the transport is the fallback. A shot bound for the Dark Star counts as a
  fleet under way; while holding the slot the nation pushes by land only.
- **Shots at rivals (`NationStargateBehavior`, new, asked after the throne check and before the land
  attack; a shot ends the turn like a random boat).** With a ready gate, and by difficulty (Easy one
  turn in four, Medium one in two, Hard and Impossible every turn), in order: **a hostile player whose
  land does not touch ours** (one border scan; the FFA boat rule — never someone stronger; a cheap
  bounding-box check before sampling 25 of their tiles; the tile nearest the gate, as a boat picks the
  near shore); **neutral land across water** (only when `nearby()` holds no neutral land to walk into;
  random tiles within a ready gate's range at least 10 tiles from our border, never the Dark Star);
  **a land neighbour's far side** (a sampled tile at least 30 tiles from our border, the farthest from
  the gate). Troops through `AiAttackBehavior.gateShotTroops` — a fifth of the army under the same
  reserve caps and "too weak" refusal as a boat. Honesty: friends and the Hegemon are never targets;
  a player we already fight from a landing (an outgoing attack with a source tile) or have a shot in
  the air at is skipped; a reloading gate is not ready; the execution's own refusals stand behind all
  of it.
- **`Player.beachheads()`** exposes the tagged tiles (the sim's exclave count).
- **Measured (`HegemonSim`, which now logs every gate built and upgraded, every shot and its fate,
  whether the pocket still stands 30 s after landing, Dark Star landings by gate versus fleet, and the
  landlocked beachhead pockets alive at the end).** World and Milky Way, seeds a/b/c, AI-only, 20 min, Medium,
  before and after. **Overthrows: 1 of 6 before (World c, by fleet), 1 of 6 after (World a, by a gate
  landing at 17.9 min)** — the rate is unchanged, the rounds that fall are different ones (the same
  timing noise as every earlier change). **Landings on the Dark Star: 21 before, all by fleet; 22 after,
  12 by gate and 10 by fleet** — more than half of all invasions now skip the moat. Gates: 236 built in
  the six rounds (26–59 per round, by 13–32 nations), 31 upgrades; 780 shots, 776 landed, 4 turned
  back (a slot claimed in flight), 13 on the Dark Star; the pocket still stood 30 s after landing in
  613 of 754 checked (81%). Domain low: World 36/45/0% → 0/93/93%, Milky Way 31/82/86% → 47/66/19%.
  **Landlocked beachhead pockets alive at the end: World 4, 9, 23; Milky Way 1, 0, 3** — from single
  tiles standing on the tag alone (a "1t" pocket is exactly the hidden-weak-tile case of §6.10) to
  inland conquests of thousands of tiles that only count because they touch no water. On World the
  map ends visibly pockmarked; on Milky Way hardly at all. That is the number Tom asked for to decide
  whether the beachhead rule needs a cap — the sim's per-round list names each pocket.
- **Tests.** `tests/NationStargate.test.ts` (11): a throne-ready nation builds its first gate in the
  nearer half of its land and in range of the rim, no gate without the ratio, the upgrade closes a
  gap of two levels and stops; the invasion goes by gate and lands (then the land push, no second
  shot), by fleet when the gate is short, neither while another power holds the slot, by fleet when
  the gate is reloading; a shot across the moat at a rival with no land border sized as a boat landing
  and fighting from its landing tile, no second shot on a rival already fought from a landing, nothing
  from a reloading gate until the cooldown passes, never at an ally, never outside Hegemon mode.
- **Deferred.** An exclave cap or decay, once Tom has seen the pockets in play; gates on the AI's
  raids (C2); F1 with everything in.

### 6.12 As built — the opening and the first galaxy map (2026-09-24)

Stage 6 of §6.8 and the map half of M2. Decided with Tom before building: the opening is
**client-only** (no projectile units in the sim, nothing on the wire, skipped on a reconnect
catch-up and in replays); **spawn immunity in Hegemon mode is extended to cover the longest flight,
capped at 15 s**, and play starts the moment the last one lands; **fill and name are hidden** until the
landing while borders, Tribes and the Hegemon show from the start, and only **humans and nations
fly**; the map is **Milky Way sized with 24 nations in a ring**, the Dark Star **carved by the engine**
from an `info.json` override, **sci-fi names on this map only**, and it is called **Event Horizon**.
Go came from the official zip into the user profile, no installer.

- **The window is a phase of the sim (`src/core/game/Opening.ts`, `GameImpl.endSpawnPhase`,
  `GameImpl.mayRun`).** When the spawn phase ends the sim measures, for every spawned human and
  nation, the flight from the Dark Star's centre to its spawn tile on the projectile's own path
  (`flightPath`: the Parabola stepper at `strikeSpeed`, exactly as `RazeExecution` and
  `GateShotExecution` step it; a flight takes `path.length` ticks), fixes the **opening window** at
  the longest, capped at `openingMaxSeconds` (15) in `HEGEMON_DEFAULTS`, and sets the round's
  **start tick to the end of that window**. Until then `inOpening()` holds: no execution runs or is
  initialised except a spawn already under way (`Execution.activeDuringOpening`, which only
  `SpawnExecution` answers, so a nation's last hop still lands and a client's late pick is
  refused), so there is no income, no expansion, no AI; orders sent meanwhile queue as intents do
  during the spawn phase and run on the first tick of play; `ticksSinceStart` is 0, so the round
  clock, the win check and spawn immunity all start at the landing — the ordinary 5 s immunity
  follows the opening rather than covering it (Tom, 2026-09-24: the countdown must not tick while
  nobody can play). The `SpawnPhaseEndUpdate` carries the deferred `startTick` and `openingTicks`
  to the client, which mirrors `inOpening()`; `Game.openingTicks()` exposes the window.
  Deterministic: every client runs the same sim over the same spawn tiles. Outside Hegemon mode the
  window is 0 and nothing changes.
- **The flights (client, `src/client/view/OpeningFlights.ts`).** Launched by `GameView` on the
  `SpawnPhaseEnd` update once that tick's player updates (the spawn tiles) are in, as **phantom
  units**: `UnitState` entries with negative ids that never existed in the sim, of type `Projectile`
  in their owner's colours, stepped along the same path each tick, so the renderer cannot tell them
  from a strike — the unit pass draws and smooths them, the trail manager stamps their trails, the
  telegraph pass rings every landing tile, and the landing is reported as a dead unit that reached its
  target, which plays the impact flash. The phantoms carry no target tile, so no telegraph ring is
  drawn (Tom found the rings clutter). A flight longer than the window samples its path over fewer
  ticks and lands as the window ends. A nation that hops once more after the phase ends re-aims its
  flight; a human who spawns inside the window gets a flight that still lands by its end; after it,
  players simply appear. Skipped when the config is a replay or when four ticks arrived within 150 ms
  (a catch-up).
- **What is hidden.** The frame carries `hiddenOwners`; `TerritoryPass` reads a one-byte-per-owner
  texture and discards the fill of an owner still in flight (`uHiddenOwners`, TEXTURE10). Names are
  left out of the frame's name map until the landing. Borders, the spawn ring and the Hegemon are
  untouched.
- **Camera and cues (`src/client/controllers/OpeningController.ts`).** At launch the camera glides
  to the Dark Star's centre at the fit-all scale (`GoToPositionEvent` gained an optional zoom,
  `TransformHandler.fitAllScale`) and one launch cue plays; each wave of landings plays an impact cue
  (at most one per 5 ticks); when a challenger's own flight lands the camera glides to its landing
  tile at the engine's post-spawn zoom of 8 — `ClientGameRunner` defers its own post-spawn go-to
  while the opening plays, since that move used to override the pull-out a tick later. The Hegemon
  and a spectator keep the wide view. The immunity bar (`ImmunityTimer`) and the Dark Star panel wait for the
  round to begin (the sidebar's panels now also refresh on the phase change, since the clock holds
  through the opening).
- **The map's own Dark Star (`DarkStarOverride`).** `info.json` → `manifest.json` (the Go
  generator passes unknown keys through) → `TerrainMapData.hegemon` (validated, halved for
  `GameMapSize.Compact`) → `createGame(…, darkStar)` on the sim side and `GameView.darkStar()` on the
  client; `computeDarkStarGeometry` takes the override and refuses a disc that does not fit.
  `HegemonSim` and the test `setup()` helper pass it through.
- **Event Horizon.** `scripts/generateGalaxyMap.ts` (seed 7) writes the image and `info.json`:
  1800×1800, 449,751 land tiles after generation (Milky Way: 442,979), void beyond a ragged rim at
  about r = 860, open deep space inside about r = 205 (the carved disc and moat end at 180), three
  logarithmic spiral arms of noisy star clusters with scattered clusters between them, five spiral
  lanes of deep space, elevation rising towards the arm cores; 24 nations placed on land nearest an
  evenly spaced ring at r ≈ 400 ± 36 (jittered, at least 70 tiles apart, with room around each); flags
  empty; `themes: ["space"]`; `multiplayer_frequency: 4`; `hegemon: { center: [900, 900], radius:
162, moat: 18 }`. In the map list under `cosmic` as "Event Horizon" (`GameMapType.EventHorizon`).
- **Measured (`HegemonSim`, seeds a/b/c, 400 Tribes, Medium, 20 min).** No overthrow in three
  rounds (the Hegemon held on the timer each time); Dark Star landings 5, 5 and 3 — **13 in all, 9 by
  gate and 4 by fleet**; domain low 63 %, 85 % and 71 %; gates built 20/19/19 by 10–13 nations with
  5–7 upgrades; shots 25/23/29, all landed, pockets held after 30 s in 22/25, 20/23 and 23/29;
  landlocked pockets at the end 1, 0 and 0. Against §6.11 on the same build of the AI: World and
  Milky Way ran 26–59 gates and ~130 shots a round with 72 and 18 nations; Event Horizon's 24 nations
  fire far less, and the Dark Star is invaded about as often as on Milky Way. The opening window on
  this map measured 79 ticks in the browser (25 flyers, 30 Tribes); the first landing at 3.2 s and the
  last at 7.9 s, the round beginning on that tick with the clock still at 20:00.
- **Tests.** `tests/HegemonOpening.test.ts` (11): the window is the longest flight and the round
  begins as it ends; nothing runs during the opening and orders queue; a spawn under way lands while
  a late pick is refused; the window is capped and the ordinary immunity follows the landing; Tribes
  do not lengthen it; none outside Hegemon mode; the override places the disc, the moat falls back, a disc that does not fit
  is refused, the manifest's entry reaches the loaded map halved on a compact map, a malformed entry
  is refused. `tests/client/OpeningFlights.test.ts` (6): a phantom launches at the start tick, follows
  the path without going back and lands exactly when the sim's flight would, revealed and reported
  once; a flight longer than the window lands as it ends; the hidden set is reported once per change;
  re-aiming and late spawners; the controller's pull-out, cues, return home and the Hegemon's wide
  view (no target tile on a phantom). `MapConsistency` covers the new map's files.
- **Deferred.** Own art for the projectile and a launch sound of its own; the flights in replays;
  decorative stars in the void and a per-map palette; per-map thumbnail colours; whether 24 nations is
  the right count once Tom has played the map.

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
| **M1.5**  | Challenger systems, in the §6.8 order: atlas tooling → the strike as a projectile → stargates (C4) → build-menu growth → AI gates; then raids (C2) on the same delivery, defensive-only Hegemon warships (H10). Balance (F1, last stand) follows, once a round contains everything a round will contain.                                         |
| **M2**    | First galaxy map authored around the Dark Star (Event Horizon, with the `info.json` Dark Star — **built 2026-09-24, §6.12**); launch-from-the-core opening (C3, **built 2026-09-24, §6.12**); HUD: Hegemon marker, invasion-slot indicator, round countdown, victory screens.                                                                    |
| **M3**    | Succession: private-lobby hand-off through the successor-lobby flow; singleplayer throne persistence.                                                                                                                                                                                                                                            |
| **M4**    | Sci-fi re-theme: strings, palette/theme JSON, atlases, names, audio.                                                                                                                                                                                                                                                                             |
| **M5**    | Release hygiene: §8 cleanup, remove/stub API-dependent features, local game archive.                                                                                                                                                                                                                                                             |
| **M6**    | Public lobbies with a persistent Hegemon (own persistence + identity).                                                                                                                                                                                                                                                                           |

**M1 slices** (each independently testable):

| Slice | Goal                                                                                                                                                                                                                                                             | Status               |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1     | **The throne exists:** `hegemon` config + `isHegemon` flag, disc/moat terrain, seated passive AI Hegemon, fixed map-scaled strength, troop bleed, win rules R1–R5, cheap guards (no mop-up/cluster capture/nuke damage on the domain, no alliances).             | **Built 2026-09-20** |
| 2 ✔   | **Invasion economics:** the invader gains nothing from domain tiles (H5); units standing on the domain survive nukes too (rest of H7).                                                                                                                           |                      |
| 3 ✔   | **Single-invader slot:** claimed on landing, held while any domain tile is held, inbound transports turn back, 5-minute cooldown from eviction (H6, H12).                                                                                                        |                      |
| 4     | **The Dark Star fights back, razing, diplomacy:** stall detector and forced counter-attack (H13) ✔, raze mode (H8) ✔, open donations (H9).                                                                                                                       | H9 outstanding       |
| 5     | **AI Hegemon + calibration:** punitive strikes (H11) ✔, Nations treat the Hegemon as the objective ✔, strike counterplay + tyranny (H16, H17) ✔, play as the Hegemon in singleplayer (§6.7) ✔, all-in last stand, headless F1 calibration, private-lobby toggle. | In progress          |

Confirm F5 on a test map early in M1 (F1 is calibrated during it); F6 before M1.5; the rest can be
settled by playtesting.

## 10. Glossary

| Term                          | Meaning                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Hegemon**                   | The asymmetric ruler role: starts dominant, cannot expand. One per round. Human or AI.                            |
| **Challenger**                | Any non-Hegemon player.                                                                                           |
| **Dark Star / Domain**        | The central black-hole region: the Hegemon's territory, the only tiles it may ever own.                           |
| **Invader**                   | The single challenger currently allowed to attack the domain.                                                     |
| **Raze / Raid**               | An attack that returns land to neutral instead of claiming it.                                                    |
| **Stargate**                  | A challenger structure that fires a troop-carrying projectile at any tile in range; it lands as a beachhead (C4). |
| **Projectile**                | The shared flight — a unit on a nuke-style arc with a motion plan — used by strikes, gate shots and the opening.  |
| **Tyranny**                   | The cost penalty on striking a small player; at the floor they cannot be struck at all.                           |
| **Bubble**                    | The land a strike holds while it lasts; fought over by the struck player, pops to neutral.                        |
| **Overthrow**                 | Eliminating the Hegemon (zero tiles).                                                                             |
| **Killing blow**              | The conquest that eliminates the Hegemon; its owner wins the round.                                               |
| **Round / Reign**             | One game / the consecutive rounds a player holds the throne.                                                      |
| **Tribe**                     | Engine term for a simple bot (`PlayerType.Bot`).                                                                  |
| **Nation**                    | Engine term for the smarter, map-defined AI (`PlayerType.Nation`).                                                |
| **Intent / Turn / Execution** | Player action → server-bundled tick of intents → deterministic sim object that applies it.                        |

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
- **2026-09-20** — Built: the invader gains nothing from domain tiles (H5), and a first HUD — the crown
  marks the Hegemon, and a Dark Star panel shows its strength, domain share, the invader, stall state and
  the viewer's cooldown (§6.3). Tom confirmed the slot + counter-attack balance in play beforehand.
- **2026-09-20** — Razing (H8) and the AI's punitive strikes (H11) built (§6.4). Decided with Tom: a raze is
  a direct strike on any challenger tile after a flight time (no fleet); normal troop costs, can eliminate;
  structures on razed land are destroyed; the AI is a "leveller". Changed after measuring: the strongest
  challenger is judged by troop capacity, strikes aim at the greatest city, and the recall has hysteresis.
  F6 narrowed to challenger raids; F11 narrowed to extra tools.
- **2026-09-20** — AI challengers now go for the throne (§6.5): nations invade deliberately, with 70% of
  their army, once strong enough against the Hegemon's current troops (the bar falls from 100% to 50% over
  the round), and keep pushing while they hold the slot. Decided with Tom: Nations only (no Tribes),
  self-interested (no cooperation), and an F1 target of a third to a half of AI-only rounds ending in an
  overthrow. Measured: 0/6 at the placeholder ceiling, 3/6 at half of it.
- **2026-09-21** — Strike counterplay and tyranny built (§6.6; the "hold" design described below was
  replaced by the bubble the same day — see the next entry). Decided with Tom: **resettlement is dropped**
  — elimination is final, players spectate or leave (C1 rewritten, F7 and the M1.5 item removed) — and in
  exchange the **Hegemon can never eliminate a challenger**: a tyranny penalty on strikes scales with the
  target's share of the map's land (free above 3%, immune at 0.5%) (H16). Strikes are uncounterable for
  5 s, then the target can commit troops to a **sustained hold** that stops the razing and kills three
  attackers per defender; AI nations defend too (H17). Razing made poor value for the Hegemon (300% cost,
  300% slower) (H8). Measured: a round's razing falls from 49–70k tiles to 4–9k, and AI-only overthrows
  rise from 0/6 to 3/6 at the unchanged ceiling (F1).
- **2026-09-21** — Strike counterplay redesigned as the **bubble** (H17, §6.6) after Tom found the hold
  halted the fight instantly and over-complicated it. A strike now conquers a bubble of Hegemon land that
  the target fights over like any invader; the bubble is defended by the strike's own troops (no explicit
  grace: density does it), only the struck player may attack it, captured structures die when it pops,
  and it pops to neutral when the strike ends. The hold, Defend button, grace timer and AI defence rule
  were removed; commit `409388f20`. Follow-up: `razeBubbleMinTiles` (200) so a fresh bubble is not
  snuffed in a second.
- **2026-09-22** — **Play as the Hegemon in singleplayer** built (§6.7), narrow by design. Decided with
  Tom: the strike is aimed from the radial menu on any challenger tile and sized by the troop slider
  (no fleet — a direct hit from anywhere is the mechanic, and it now has its own `strike` order); one
  live strike per target, any number of targets; a recall keeps the engine's retreat malus; H13 stays
  automatic and visible, not overridable, and a human gets no landing wave; the throne sees a sortable
  table of the challengers; AI challengers are unchanged against a human; the flight keeps its short
  travel time (an arc or marker is later, and instant strikes are a tunable away); "The Hegemon Reigns
  Supreme" / "Overthrown by X". Deferred: donations (H9), the last stand, throne persistence. Measured:
  a passive human throne keeps only 5% of the domain on World seed a (F11 note).
- **2026-09-22** — **Orphaned bubble tiles fixed.** Tom saw Hegemon land left standing on the map after a
  strike ended, when the front was jagged or counter-attacked; only the next strike on that player made it
  attackable again. Cause: the engine's enclave rule gave the Hegemon sealed-in pockets the strike never
  took. Bubbles now adopt touching orphans, a pop sweeps everything beyond the moat that no live strike
  holds, and the Hegemon's own execution sweeps when no strike is alive (§6.6).
- **2026-09-22** — **Stargates decided (C4) and the projectile plan written (§6.8).** Tom: balance can
  wait, gameplay is still too undefined; stargates are the mechanic that differentiates DarkStar. Decided:
  a gate shot **conquers** (a beachhead, like a transport landing without the boat); it **may land on the
  Dark Star** under the single-invader rule; silo-like cost/build/cooldown with a small range that grows
  by upgrade level, any number of gates; no SAM interception; one projectile sprite for strikes and gate
  shots; the throne's strike will fly visibly with an impact circle (fine that the target sees it coming);
  the build menu grows as a scrollable list with no hotkeys for new types. Staged: atlas tooling → the
  strike as a projectile → stargates → menu growth → AI gates → the C3 opening on the same flight. F15
  holds the numbers. F1 moves to after AI gates.
- **2026-09-23** — **Atlas tooling and the strike as a projectile built (§6.8 stages 1–2, §6.9).**
  Decided with Tom: the projectile flies at nuke speed on the standard nuke arc (no flat short hops), one
  impact ring at the 200-tile bubble footprint, no aim preview for now, and one shared `Projectile` unit
  type drawn in its owner's colours (no nuke flicker) so stargate shots reuse it. The generator revealed
  that five GL unit glyphs and the silo icon had no source in the repo; they are now checked-in sprites.
  F15 loses the speed question; H8 and C4 note the visible flight.
- **2026-09-24** — **The Hegemon looks like a black hole by default (§5.4).** Near-black fill, a
  two-tile purple band and a pale one-tile rim, from `theme.hegemon.*`; overridden by the seat
  holder’s own colour cosmetic or pattern palette, and by team colours. New `rimColor()` on
  `PlayerView`, a dual-border owner on the border compute/stamp passes, `hegemonBorderThicken`.
- **2026-09-24** — **Stargates for human players built (§6.8 stage 3, §6.10).** Decided with Tom (F15):
  range 120 +60 per level to level 5, upgrades buy range only, 1M gold / 10 s / 60 s reload, any tile
  that is not your own (neutral land included), land-and-fight if the tile changed hands, refused or
  turned back under the Dark Star's slot and cooldown rules, bubble only for the struck player, recall
  allowed, nearest ready gate fires, a seventh radial slice, "Stargate" with a placeholder icon.
  `UnitType.Stargate` and the `gate_shot` intent are appended (wire order); `UnitInfo.maxLevel` is new.
  Tom's first playtest found gate invasions "defeated on landing, troops home without casualties": the
  engine's enclave rule was absorbing the beachhead. Decided after weighing the options (§6.10): the
  landing tile is a tagged **beachhead** — a pocket holding one is never absorbed as an enclave until the
  tile itself is retaken; the Dark Star foothold falls only to reconquest (H13); no softening measures.
- **2026-09-24** — **Nations build and fire stargates (§6.8 stage 5, §6.11).** Decided with Tom: every
  nation, silo-style with the difficulty setting the per-city ratio and the firing eagerness, cap three;
  the gate before the silo in the build order; far-side shots into a land neighbour allowed at the lowest
  priority; the gate fires the invasion ahead of the fleet and never reinforces its own foothold. A
  throne-ready nation upgrades or builds towards the moat. `NationStargateBehavior` is new; C4 and F15
  updated. Measured: overthrow rate unchanged at 1 of 6, 12 of 22 Dark Star landings now by gate, 780
  shots in six rounds, and 4–23 landlocked pockets left on World at the end (1–3 on Milky Way) — the
  input for the exclave-cap question, which stays open.
- **2026-09-24** — **The opening and the first galaxy map built (§6.8 stage 6, M2, §6.12).** Decided
  with Tom: the opening is client-only (phantom projectiles on the strike's path, nothing in the sim
  or on the wire, skipped on catch-up and in replays); spawn immunity in Hegemon mode is extended to
  the longest flight, capped at 15 s, and play begins as the last one lands; fill and name are hidden
  until the landing while borders, Tribes and the Hegemon show throughout; only humans and nations
  fly; the map is Milky Way sized with 24 nations in a ring, the Dark Star carved by the engine from
  a new `info.json` `hegemon: { center, radius, moat? }` override (F5's deferred piece), sci-fi names
  on this map only (F14), and it is called **Event Horizon**. C3, F5, F14 and §5.3 updated; the map
  is written by `scripts/generateGalaxyMap.ts`; Go runs from the official zip in the user profile.
  Measured on Event Horizon (seeds a/b/c): no overthrow, 13 Dark Star landings (9 by gate), 0–1
  landlocked pockets; the opening window is 7.9 s there.
- **2026-09-24** — **The opening became a phase of the round (§6.12).** Tom's first look: the flights
  are a great start, but the game was running underneath them (nations expanded and the clock ran while
  a watching player waited) and the landing rings were clutter. Decided: the sim holds the round until
  the last flight lands — nothing runs, orders queue, the clock stays at 20:00 — and the ordinary 5 s
  immunity begins at the landing rather than covering the flights; no rings on the phantoms; Tribes
  still do not fly (acceptable for now). `inOpening()` on both sim and client, `Execution.activeDuringOpening`.
