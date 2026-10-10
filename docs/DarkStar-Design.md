step 1 (spaceports, harbours, destroyers) built 2026-09-26, §6.17; step 2 (freighters overland) built 2026-09-26, §6.18; step 3 (straight lanes) built 2026-09-26, §6.19, kept at hop threshold 3; step 4 (names) built 2026-09-26, §6.20. **Built.** |# Under a Dark Star — Design Reference

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
- The galaxy is feudal. Below the Hegemon stand the **Lords**, the map-defined AI players
  ("Nations" in the code), and beneath them the **Barons**, the simple bots ("Tribes" in the
  code). [Decided 2026-10-07] Player-facing text and these documents use the feudal names; the
  code identifiers keep the old ones.
- Deep space is crossed by **fleets** [Decided 2026-10-09]: the engine's transport ship ("boat"
  in the code and the intents) is a fleet in every player-facing string, with a star-fighter icon
  in the radial menu. The radial menu's warhead slot wears the stargate and its gate shot the
  sword: everything in that menu launches from a gate (the Hegemon's from the Dark Star), and the
  sword means troops.
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

The Hegemon core, stargates, the opening and the first galaxy map are built (as-built notes §6.1–§6.12,
history in §11). On 2026-09-24 Tom reviewed the whole design: §3 records the rules as they stand after
that review, §4 what is still open, §9 the road from here to release.

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
- **H2 — Starting state, and no structures on the Dark Star.** Full troops (at its ceiling), gold
  income from the shadow tax (H4), **no structures — ever**. [Decided 2026-09-24] **Nothing can be
  built inside the Dark Star**, by the Hegemon or by an invader: no cities, ports, factories, silos,
  SAMs, defence posts or gates on domain tiles. The Hegemon therefore has no nukes, no home economy to
  grow and no navy of its own beyond H10 (F8 is closed by this rule — a Hegemon silo would have been a
  raze that skipped tyranny and the bubble). What the throne builds, it builds in its vassals' lands
  (H18). [Built 2026-09-25, §6.13] Domain tiles are never structure sites for anyone, and the
  Hegemon can build no structure of its own anywhere, a strike's bubble included.
  [Revised 2026-09-28; built the same day, §6.23] **Missiles are the exception.** The throne may buy
  a Nuclear or Antimatter Warhead at any player's price (S6) and it flies from the **Dark Star's
  centre**, as its strikes do: no launcher, no reload, gold is the only limit. A gate its strike
  captured is never fired (H19), MIRVs stay off. [Revised 2026-09-29] Its warheads are **kept out
  of shield arrays like anyone else's** (C5); only its strikes pass through.
- **H3 — Strength scales with the map, not the player count** — for the troop ceiling. Gold scales
  with the round's economy (H4).
- **H4 — Strength target.** [Revised 2026-09-24] The Hegemon is a **large pool that refills slowly**,
  not a fountain. At the placeholder numbers (regeneration at 100% of the standard curve against a
  ~5M ceiling) a full strike refilled in under a minute and the throne razed its way through the
  mid-game without ever risking an invasion, tyranny notwithstanding. Direction decided: **cut troop
  regeneration severely** and, if needed, **raise the ceiling** to compensate, so that a full-size
  strike is a real commitment — with the army away and the pool refilling slowly, the throne is open
  to an invasion it cannot answer. Rationing the pool between strikes (H8), gifts (H18), donations
  (H9) and the Dark Star's defence is the Hegemon's game. **Gold is a shadow tax:** each tick the
  Hegemon earns a share of the challengers' combined gold income, deducted from nobody, so its
  economy tracks the round's economy rather than the map (the fixed per-tick income of the
  placeholder is replaced). The original guide — ceiling around 25–40% of the map's potential, about
  a third of the challengers' mid-round strength — stands as the ceiling's starting point.
  **Method:** explicit `Config` tunables (`refillMinutes`, `troopCeilingPercentOfWholeMapCap`, the tax
  share), swept with the headless sim, then a short list playtested (F1). The AI Hegemon's strike
  thresholds (H11) are left as they are and retuned after. [Built 2026-09-27, §6.21 — the M4 first
  pass, every number a lever:] **The refill is flat**, not the engine's curve: the same troops every
  tick, the ceiling over `refillMinutes` (20). Tom's reasoning: the curve peaks part way up and crawls
  near empty, so a Hegemon bled dry — by design or by collusion with an invader — could be kept down
  by a slow-rolled invasion for as long as the round lasts; a flat refill is well below what a
  challenger holding half the map regenerates at its best, well above what an emptied challenger
  gets, and makes a slow-rolled invasion the losing choice. Ceiling **125%** of the whole-map cap
  (Milky Way ≈ 6.2M). **Shadow tax 3%** of everything the challengers earn each tick — workers,
  trade, trains, piracy and conquest alike, read from their lifetime income totals — about a
  mid-table challenger's income, rising with the round.
- **H5 — Strength is decoupled from territory.** The Hegemon's regeneration and ceilings **do not fall**
  as its domain is conquered, and an invader gains **no benefit** (no troop cap, income, etc.) from
  domain tiles it holds. **Troop bleed:** each domain tile the Hegemon loses costs it
  `troops ÷ the domain's ORIGINAL tile count` — a constant share per tile, however much it has already
  lost (the engine's own rule, `troops ÷ current tiles`, would bleed it faster as it shrank).
- **H6 — One invader at a time.** Only **two players can ever occupy the Dark Star at once: the Hegemon
  and one invader.** Invader status is defined purely by occupancy — the invader is whichever
  challenger holds any tile inside the domain. Everyone else can take part only indirectly, by
  reinforcing the Hegemon with troops (H9, open since 2026-10-04); donations to the invader stay closed.
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
- **H9 — Diplomacy.** The Hegemon **cannot ally** with anyone [built, §6.1]. [Decided 2026-09-24]
  The Hegemon **may donate troops to any challenger** — its own precious, slow-to-refill troops (H4),
  spent to prop up whoever the balance needs (H15). This relaxes the engine's `isFriendly`
  requirement in `canDonateTroops` for a Hegemon donor only; the existing donation flow (order, HUD
  button, cooldown) is reused. **Shelved:** gold donations from the throne (liked, not a priority) and
  challengers donating to the invader (revisit if a playtest asks). F9 closed.
  [Built 2026-09-25, §6.13] The throne's troop donations also ignore the lobby's donation toggle
  and may go to the current invader; gold donations are refused outright.
  [Decided 2026-10-04, built the same day, §6.25] **Anyone may donate troops to the Hegemon** while
  its pool has room — no alliance, the lobby toggle ignored, the cooldown as usual. **While someone
  holds the Dark Star, every troop donated to the throne goes straight into the counter-attack
  against them**, stalled or not, human or AI throne. Why: a round can deadlock when an invader takes
  most of the domain and exhausts the throne but loses its land beyond the moat, so its troop cap
  collapses (H5) and neither side can move; the other challengers' donations finish the failed
  invasion and free the slot, and are how rivals compete for the throne by proxy.
- **H10 — Destroyers of the Dark Star.** [Revised 2026-09-24] The Hegemon may build **destroyers**
  (the engine's warship, S7) **without a port** — it has none (H2). They **spawn in the moat** and are
  purely defensive: they move to intercept fleets bound for the domain and harass the trade of the
  player currently invading the Dark Star; they never engage anyone else. [Built 2026-09-25, §6.15]
  Placed on any moat tile from the attack menu; moat-bound; the moat repairs them; they answer an
  enemy warship only inside the moat; the AI Hegemon does not build them yet.
- **H11 — AI Hegemon personality.** Defensive by default; when its troops have sat at the ceiling for a
  while it may launch a punitive attack at the most powerful challenger. [Decided 2026-09-20 — the
  "leveller"] Only while nobody is invading; "most powerful" is the largest **troop capacity** (land and
  cities), and only a real threat is struck (capacity ≥ 25% of the Hegemon's ceiling). It sends 25% of
  its troops at the target's greatest city, recalls the strike once the target is clearly below the
  runner-up (85% of their capacity) or the moment the Dark Star is invaded, then waits 90 s. All tunable.
  [Revised 2026-09-27] "At the ceiling" is now **75% of it** (was 95%): with the flat refill (H4) the
  throne rarely tops up again after its first strike, and Tom wants it engaging the galaxy without
  dipping below three quarters of its pool to do so — punitive strikes (H19) are its cheaper voice.
  **The last stand** [Decided 2026-09-27, §6.21]: once an invader holds **40% of the domain**, an AI
  Hegemon goes all in — every second, everything above a **5% reserve** of its ceiling is sent
  after the invader, its leveller strike already recalled — and stays in until the invader is
  evicted. No button for a human Hegemon: recall and counter-attack already exist by hand.
  **Lords never nuke the Dark Star** [Decided 2026-09-27]: a warhead there does nothing (H7), yet
  the AI kept throwing them (the throne being the incoming attacker, the most hated and the crown
  by turns); every rule in the Lord's target search now passes over the Hegemon.
- **H12 — Claiming and releasing the invasion slot.** The slot is claimed **when an invasion transport
  lands** on the domain (not at launch). It is held for as long as the invader holds **any** domain
  tile, and passes on only once they hold none — an invasion cannot simply "end" while the invader
  still occupies part of the Dark Star. Other players' transports already heading for the Dark Star
  **turn around the moment their attack becomes invalid** because someone else has landed (the engine's
  `BoatRetreatExecution` is the precedent; troops return home). A gate shot (C4) lands and turns back
  under the same rules. [Decided 2026-09-24] **There is no re-invasion cooldown.** The 5-minute
  timer from eviction (built in §6.2) proved far too harsh in play and is removed: an evicted
  challenger may land again as soon as the slot is free. [Built 2026-09-25, §6.13] Whether the slot
  itself should stay single is open (F16).
- **H13 — The Dark Star fights back against a stalled invasion.** An invasion is **stalled** once the
  invader's territory inside the domain has not changed for **5 seconds** (tunable). From that point,
  **all of the Hegemon's troop income is automatically sent into an attack on the invader** until they
  are evicted. While the invader is still advancing, the Hegemon defends normally. Troops donated to
  the throne go into that attack at once whether or not the invasion has stalled (H9, 2026-10-04). Consequently nobody can take a sliver of the domain and sit on the slot: a failed
  invasion is always pushed out, and domain tiles return to the Hegemon by reconquest, not by fiat.
  This is a rule of the role, applied identically to human and AI Hegemons.
- **H14 — The moat.** The Dark Star is separated from the rest of the map by a ring of "water" (deep
  space). The ring is **narrow**, so an invasion force launched from a well-chosen spot crosses quickly.
  Invasions arrive by transport across it, or over it by stargate (C4): the moat is the early-game
  filter, gates the late-game road. Its water is where the Hegemon's destroyers live (H10).
- **H15 — The Hegemon's job is the balance of power.** A human Hegemon steers the round: it stymies
  whichever challenger is becoming dominant before they can make a bid for the throne (razing attacks,
  H8) and props up their rivals (troop donations H9, gifted structures H18). It is the counterbalance
  to every upstart — and every tool it uses draws on the same slow-to-refill pool (H4).

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
  Lords need no special rule: the engine's retaliation against an attacker already fights the bubble.
- **H18 — Gifts: the Hegemon builds in its vassals' lands.** [Decided 2026-09-24] The Hegemon may
  place **any structure a challenger could build** — city, port, factory, defence post, SAM, silo,
  stargate — on **any challenger's territory**, paying the cost from its own gold (H4). The structure
  is a **gift**: it belongs to the host player outright from the moment it is placed, exactly as if
  they had built it (the engine ties a structure to the tile's owner, so it changes hands with the
  tile like any other). The host **cannot refuse** — challengers are the Hegemon's subjects, and the
  throne builds where it pleases. This is the throne's main lever on the balance of power (H15): a
  string of defence posts along the border of a player being overrun by an upstart, a city for a
  rival who is falling behind. [Built 2026-09-25, §6.14] Placement runs through the host's own
  rules with the throne as payer; a gift may also upgrade the host's existing structure; every
  challenger can receive one, Barons included; the host is told; the Gift takes the ally slot of the
  Hegemon's radial menu on a challenger's tile.
- **H19 — Missile launches invite a punitive strike.** [Decided 2026-09-26; built the same day,
  §6.16] A challenger who fires a
  missile from a silo (Nuclear or Antimatter Warhead, S6; the target does not matter, the Dark Star
  included) exposes that silo to a **punitive strike** by the Hegemon, a variant of the raze strike
  (H8) with its own rules. [Revised 2026-09-28] The launcher is now the **stargate** (C4; silos
  are off, S6) — read "gate" for "silo" below, the rules are unchanged:
  - **The flag.** The launch flags the silo for `punitiveFlagSeconds` (30 s) from its **most recent**
    launch. A silo that has fired both kinds carries the **more severe** flag (Antimatter), not the
    most recent. The Hegemon sees a badge around every flagged silo, red for Nuclear, white for
    Antimatter, and orders the strike by **clicking the silo** (a plain click, or the radial's
    Punish slot). The throne **may decline**: it pays
    nothing, so declining is how it shows favour (H15) or leaves an intimidating power alone.
  - **The levy.** The strike's troops are **not the Hegemon's**. When it is ordered, every living
    challenger, Barons included and the nuke's victim too, is levied a share of the troops it has at
    home: `punitiveLevyPercentNuclear` (10%) for a Nuclear flag, `punitiveLevyPercentAntimatter` (25%)
    for Antimatter (tunable; F20). Troops away on attacks and fleets are not levied. The levied total
    flies from the Dark Star's centre as a strike projectile (§6.9) and lands on the silo's tile, so
    the silo is captured at once (H17) and dies when the bubble pops unless its tile is retaken.
  - **No tyranny, a radius instead.** The strike pays no tyranny multiplier (H16) and can never be
    recalled. Its reach is capped: it razes only tiles within `punitiveRadius` (34: the Nuclear
    Warhead's outer blast radius of 30 with a quarter more area) of the silo, and it never takes the target below the tyranny floor
    (`tyrannyFloorPermille`), so H16 still holds for a player whose whole land fits in the pocket.
  - **Halt, then pop.** When nothing within its radius is left to take (or the floor is reached) the
    strike **halts** for `punitiveHaltSeconds` (5 s). If the target retakes any bubble tile in that
    time the halt is cancelled and the strike resumes out to its radius, halting again once it is
    full; the target may fight it exactly as any bubble (H17), a dense pocket that takes a real army
    to breach. An undisturbed halt, or troops spent, ends the strike: the bubble **pops** as in H17
    (land to neutral, the silo and every captured structure destroyed) and any troops left over are
    **burnt**: not returned to the levied, never the throne's.
  - **One at a time.** Ordering a strike on one of a player's silos clears every other flag that
    player holds, and no new flag arises on any of their silos while any strike (punitive or H8) on
    them is alive: a player under strike fires freely, and the salvo that follows a punishment is a
    feature. One live strike per target as before; any number of targets.
  - **The throne's gate.** A captured gate in the bubble is never the throne's launcher: its own
    missiles fly from the Dark Star (H2, revised 2026-09-28), and a captured gate's charge stays
    untouched.
  - **AI Hegemon.** Strikes any flag as soon as it may, except against a challenger holding less than
    `punitiveAIMinLandPermille` of the map's land (tunable, 50–100‰ to start).

### 3.3 Challengers

- **C1 — Elimination is final.** [Decided 2026-09-21; replaces resettlement] A challenger who loses all
  territory is out of the round: they may **spectate or leave** to find another game (the engine's
  existing behaviour), and cannot re-deploy. In exchange, **only other challengers can eliminate a
  challenger** — never the Hegemon (H16).
- **C2 — Raids. [Dropped 2026-09-24]** Challenger raids (razing attacks between challengers) are
  abandoned. Tom: a regular player has almost no incentive to raid, the incentives it would need add
  complexity, and the result would be unrewarding to send and frustrating to receive. Razing stays the
  Hegemon's alone (H8). F6 is closed and the raid delivery planned in §6.8 (a gate shot with a razing
  landing) is void.
- **C3 — Launch from the core.** At round start all challengers visibly **launch from the Dark Star to
  their starting territory** (an arc animation like the engine's nuke trajectories). [Built
  2026-09-24, §6.12] Presentation only, on the same projectile flight as strikes and stargate shots:
  when the spawn phase ends every human and Lord launches from the Dark Star's centre to its spawn
  tile (Barons are on the map from the start), the camera pulls out to the whole map, a territory's
  fill and name stay hidden until its projectile lands (its border shows from the start), and **the
  round begins when the last one has landed**: the opening is a phase of the sim between the spawn
  phase and play — nothing runs, nothing is earned, the clock holds at 20:00, orders queue — lasting
  the longest flight, capped at 15 s (longer flights are played faster); the ordinary 5 s spawn
  immunity starts at the landing, as in vanilla. The flights themselves are the client's alone (no
  units in the sim, nothing on the wire), so a reconnecting client and a replay skip them. The
  Hegemon watches its subjects scatter from the wide view. [Decided 2026-09-24 after Tom's first
  look] No landing rings; Barons do not fly (acceptable for now, not a decision).
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
  bubble; a shot in flight can be recalled, troops home whole.
  [Built 2026-09-24, §6.11] **Lords build and fire gates** like silos: every Lord, by a per-city
  ratio the difficulty sets, a first gate early, at most three; a Lord ready for the throne wants a
  gate that reaches the moat and upgrades or builds towards it; a ready gate in range of the rim fires
  the invasion instead of a fleet; otherwise gates shoot at rivals beyond the Lord's land, at neutral
  land across water, and last at a land neighbour's far side — never at friends, never a second shot on
  a pocket already fighting, never while holding the slot.
  [2026-09-26] With spaceports anywhere (S7) nobody is landlocked for trade: the gate is a **purely
  offensive** tool, the road past a front and to the throne.
  [Revised 2026-09-28; built the same day, §6.23] **Gates are also the missile launchers.** A
  Nuclear or Antimatter Warhead launches from the **nearest ready gate whose range covers the
  target** and spends the gate's one charge (the reload, shared with shots): a missile reaches
  only as far as a gate does — 180 at level 1, +75 per level — so range upgrades buy reach for
  warheads too, and a gate that has just fired one cannot shoot troops until it reloads. Lords
  fire the same way. Rationale (Tom): missiles were too oppressive once SAMs went, and a gate was
  too easy to ignore; tying the two makes both matter.
  [Revised 2026-09-30] Tom's balance pass: a gate costs a **flat 500k** (was 1M), new or per
  upgrade; the reload is **5 s** (was 60); and there is **no level cap** (was 5) — like a city, a
  gate upgrades for as long as the gold lasts, each level adding 75 to its range. Lords still
  stop at level 5 when upgrading a gate towards the moat (their own limit, not a rule), so their
  behaviour is unchanged apart from the cheaper price and the faster reload.
- **C5 — Shield arrays.** [Decided 2026-09-28; built the same day, §6.23; revised 2026-09-29,
  §6.24; price 5M → 2M 2026-09-30] A challenger **structure** (**2M gold**, 10 s build, **one level, no upgrades**) that
  projects a perimeter of `shieldArrayRadius` (35 tiles: half a level-1 SAM's 70, and never more):
  **no missile can harm anything inside it**. A warhead may be aimed anywhere, the array included;
  when it lands, the blast clears its circle as usual **except the tiles inside the perimeter** —
  no land lost, no troops killed, no structure destroyed there, no crater — so an Antimatter
  Warhead on an array wipes the ring from 35 to 100 and leaves the inside untouched, and a Nuclear
  Warhead (30) on the array itself does nothing at all. Nothing is refused and nothing is shot
  down. **The Hegemon's missiles are kept out like anyone else's** (revised from "pass through",
  Tom 2026-09-29); its **strikes** (H8, H19) still pass through. An array under construction
  protects nothing; a captured array shields its new owner; the owner's own missiles are not kept
  out. Gate shots are troops, not missiles, and land inside. The array shelters itself, so short
  of the throne's strike only conquest removes one — hence the price (Tom's baseline; F21). Lords
  do not build arrays yet (F21). Icon: a crenelated generator under a dashed dome (the silhouette
  of the Echo Base shield generator, not its name).

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
  our own persistence (M9).
- **S6 — Arsenal.** [Decided 2026-09-24] **MIRVs are removed** — disabled by default in Hegemon mode
  through the existing `disabledUnits` config, never offered in the build menu; the enum value stays
  (wire and replay format). The atom bomb is displayed as **Nuclear Warhead**, the hydrogen bomb as
  **Antimatter Warhead** — display strings only, enum values unchanged (§5.4). Hydrogen-bomb removal
  was considered and closed by the rename. [Built 2026-09-25, §6.13] The MIRV is hard-off in core
  whenever the Hegemon round is on (hosts cannot re-enable it) and the lobby hides its row.
  [Decided 2026-09-26] **SAM launchers are removed** the same way: the deterrent against a missile
  is the throne's punishment (H19), and a net of interceptors would spare most players that
  decision. The **Nuclear Warhead costs 1M gold** under a Dark Star (the engine's 750k elsewhere).
  [Decided 2026-09-28] **Missile silos are removed** the same way (hard-off under a Dark Star, the
  enum kept for the wire): the stargate is the launcher (C4), so a missile's reach is a gate's, and
  the shield array (C5) is the defence. The **Hegemon may fire missiles** from the Dark Star (H2).
- **S7 — Economy.** [Direction agreed 2026-09-24; revised 2026-09-26] The engine's structure stays:
  cities and factories joined by rail, ports spawning trade ships. [Revised 2026-09-26] **The economy
  goes to space.** (1) **Trade lanes**: a railroad is a **straight line** between its two stations —
  in the sim, not only on screen; a lane connects only if the line crosses no void and every water
  tile on it is shoreline water (the narrow-strait rule the rail pathfinder already applies), water
  tiles counting six toward the length budget as they do today; a blocked line means no connection,
  no bent fallback. (2) **Spaceports anywhere**: the port is placed **like a city**, anywhere in the
  territory, exactly where clicked. Its **harbour** is the nearest deep space reachable over land
  (never across the Dark Star's disc), one per body of space, where its freighters put to space and
  its destroyers are launched and repaired; a coastal port's harbours are its adjacent water, so
  nothing changes for it. (3) **Freighters** (the engine's trade ships) travel overland to and from a
  harbour at **half speed** (one tile every 2 ticks; tunable) and the deep-space leg at full speed:
  three legs — out of land, across space, into land. The route always goes via deep space and two
  ports that share no body of space do not trade (accepted for now). They cross any land but the
  Dark Star's disc, the moat included, and route cost never looks at who owns a tile. Spawn odds,
  destination weighting and the global throttle are unchanged; the payout stays per tile travelled.
  (4) **Destroyers** stay deep-space units: a challenger's is launched from the harbour of its
  nearest spaceport on the clicked body of space and patrols from the click as before; it retreats
  to a harbour to repair. (5) Names: **freighter**, **spaceport**, **Destroyer** ("Star Destroyer" is
  a Lucasfilm trademark), display strings only (F14); icons later (M6). Stargates stay a purely
  offensive tool (C4). Built in steps (M3.6): spaceports and harbours [Built 2026-09-26, §6.17],
  freighters overland [Built 2026-09-26, §6.18], straight lanes [Built 2026-09-26, §6.19; Tom kept them, hop
  threshold 3], the names [Built 2026-09-26, §6.20]. A
  freighter on a land leg cannot be captured — a destroyer's reach ends at the water's edge.
- **S8 — Audio.** [Revised 2026-10-04] Sound work has started, cue by cue: Tom describes the sound
  and the rule for who hears it, supplies the file (his own recordings, or CC0 / CC BY sources
  credited in `CREDITS.md`), and it is wired into `Sounds.ts` and the controllers. **Audience
  principle:** a cue is heard by the players involved, not by the whole map — a landing by the one
  who lands, the one who launched it and the one whose land it comes down on; a third player hears
  nothing. **The one exception:** the Hegemon hears every missile launch in the galaxy. A missile's
  detonation is heard by all. Cues under the principle so far: `launch` (troops leaving the Dark
  Star or a stargate — the opening, strikes and gate shots), `landing` (those troops coming down),
  `missile` (a nuke leaving a stargate; distinct from `launch` so the ear tells a missile from an
  invasion). The atom/hydrogen/MIRV launch cues are no longer played; the hit cues remain (§6.12
  and §6.9 notes). **Before any public release:** the remaining effects verified (the repo carries
  37 effect files that `Sounds.ts`
  plays, so silence in play is a bug to diagnose, not missing assets) and a unique, legally
  compliant soundtrack replacing the proprietary music (§8).
- **S9 — Map library.** [Decided 2026-09-24] Launch with **10–20 galaxy maps** authored around the
  Dark Star; Event Horizon is the first and `scripts/generateGalaxyMap.ts` the tool. Most or all
  existing maps — the Earth-geography ones in particular — are removed, decided map by map (F17).
- **S10 — Branding.** The splash page and main menu are still OpenFront's. Rebuild them for DarkStar
  before release, keeping the attribution §8 requires.

## 4. Open design questions

Tom expects more mechanics to emerge over time; this list is the current frontier, not the final one.
Closed so far: F3, F4, F10 (2026-09-20 → H12–H14, S1); F7 (2026-09-21, with resettlement — C1);
F2, F5, F6, F8, F9 and F11 (2026-09-24 review — the HUD is built and the counter-attack switch-off
decided; the disc's sizes are confirmed and its look built; raids dropped; nothing is built on the
Dark Star; troop donations from the throne only; the toolkit is strikes, troop donations, gifts,
destroyers and the challenger table). The playtest checks left over from them are collected in F19.

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Calibrating Hegemon strength (H4).** [Direction decided 2026-09-24] Regeneration is cut severely, the ceiling may rise to compensate, gold becomes a shadow tax on the challengers' combined income; the last stand (an AI rule: everything into the Dark Star's defence once the throne is truly threatened) rides with it. **Target [Decided 2026-09-20]:** roughly a third to a half of AI-only rounds end in an overthrow. **[First pass built 2026-09-27, §6.21]** `HEGEMON_DEFAULTS` now: ceiling = **125%** of what one player owning every land tile could field (`2·(L^0.6·1000+50000)`; Milky Way ≈ 6.2M), a **flat refill** of the ceiling over `refillMinutes` = **20** (~312k/min on Milky Way, a tenth of the old half-full rate), gold = a **3% shadow tax** on everything the challengers earn, the last stand at 40% of the domain with a 5% reserve, the leveller's bar at 75%. Before the change, with everything in: 0 of 6 overthrows; after: **3 of 6** at refill 10, 20 and 40 minutes alike (the AI throne's waves, not the refill, decide what it has when it matters), in the target band. Tom playtests the default with 10 and 40 minutes as the forgiving and harsh alternatives. Still open: the tax share (3% is a first guess at "a mid-table challenger's income"), whether one refill time fits all map sizes, the AI's other strike thresholds (H11) and the gate numbers (F15), and the Lords that stall on the last few percent of the domain. |
| F15 | **Stargate numbers (C4).** Rules and starting numbers are decided (range 180 +75 per level to level 5 — raised 2026-09-26 from 120 +60, which underperformed, 1M gold, 10 s build, 60 s reload, upgrades buy range only, nearest ready gate fires; Lords by difficulty ratio, cap 3 — details in C4 and `STARGATE_DEFAULTS`). [Revised 2026-09-30] Now a flat 500k, a 5 s reload and no level cap (+75 per level without end). [Closed 2026-09-24] A shot on the Dark Star does nothing to a fleet already bound for it. Still open: whether the gate numbers survive F1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| F12 | **Edge cases.** Hegemon disconnects mid-round (AI takes over?); the invader disconnects; an AI challenger (Lord/Baron) lands the killing blow (next round gets an AI Hegemon per R6?); team modes (probably out of scope at first).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| F13 | **Hegemon identity across rounds.** Beyond the high-score table (S5): titles, reign counter in the lobby, anything inherited besides the seat.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F14 | **Names and icons.** Sci-fi names for units, structures, Barons/Lords and resources (rename surface in §5.4; display strings only). [Decided 2026-09-24] Event Horizon's 24 Lords carry sci-fi polity names and its Barons draw on the `space` theme; Nuclear Warhead / Antimatter Warhead (S6); Destroyer with a spaceship icon and "spaceport" for the port (S7, low priority). Still open: the rest of the unit and structure names, resources, and whether Baron/Lord naming goes sci-fi on every map.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F16 | **Multiple invaders (H6, H12). [Open 2026-09-24]** The single-invader slot keeps the win condition simple (R3: the killing blow is unambiguous) but feels restrictive in play. Tom is not yet committed to opening the Dark Star to several invaders at once; the cooldown is already gone. To weigh if it opens: who wins when two invaders share the conquest (R3), whom H13 routes the counter-attack at, whether donations to an invader return (H9), the turn-back rule for fleets and shots, and the panel (F19).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| F17 | **The map library (S9).** Which existing maps stay — Tom decides map by map, instinct: most or all go, geography first (the `GameMapType` enum is wire format, but this fork has no replays or archive to keep compatible); whether every map's Dark Star is central (H1) or a map may place it elsewhere via `info.json`; how many Lords a galaxy map wants (24 on Event Horizon, to be judged in play); what the generator needs to produce 10–20 distinct maps (seeds and parameters, or hand-authored variants).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F18 | **Exclaves from gate landings (§6.10, §6.11).** A landlocked beachhead pocket stands until its landing tile is retaken. Measured: World ends with 4–23 such pockets, Milky Way 1–3, Event Horizon 0–1. Whether a cap or decay is needed — likely moot once the geography maps go (F17); decide after Tom has seen the pockets on a galaxy map.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F19 | **Playtest checks outstanding.** On Event Horizon: the disc and moat by eye (radius 162, moat 18 — the computed default written into `info.json`); 24 Lords as a count; the 15 s opening cap; Barons not flying. From the throne: should a human Hegemon get the AI's landing wave, or is active defence the point (a passive throne kept 5% of the domain on World seed a); the 5 s stall threshold (H13). The HUD merge: [Closed 2026-09-25 — **dropped**] built as columns in the player table with the panel cut to a strip, played, and discarded: seen missing, the panel's fields (the throne's troop bar, domain held, the invasion status, the bubble, the challenger board with its strike status) justify a panel of their own. The panel stays as built (§6.3, §6.6); its only change is that the challenger board starts **collapsed**, with the throne's show/hide toggle to unfold it. Clean-up later if it earns it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F20 | **Punitive strike numbers (H19). [Open 2026-09-26]** The levy shares (10% / 25%, raised from 5% / 15% after the first look), the flag window (30 s), the halt (5 s), the radius (34, a quarter more area than the first 30) and the AI's land-share threshold are starting points. Because the levy taxes every challenger's troops, it moves the invasion curve, so H19 is built **before** the F1 sweep and its numbers ride with it. To judge in `HegemonSim` and in play: how often Lords nuke on a galaxy map (and so how often the galaxy is levied); whether a 15% levy in a radius-30 pocket is so dense that the halt is never disturbed; whether the pocket should follow the warhead that was fired (Antimatter's 100) rather than one radius for both.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| F21 | **Missiles on gates, shields and the throne's warheads (C4, C5, H2). [Open 2026-09-28]** The shield radius (35) is the cap Tom set, not a tuned number; the throne's missiles have no reload — gold-limited only — and may want a cadence once the shadow tax is tuned (F1); Lords do not build shield arrays and the AI Hegemon fires no missiles; a shield refusing gate shots was considered and left as no (gates are meant to matter more, not less). [2026-09-29] The array now shelters its zone from every missile, the throne's included, and costs 5M — Tom's baseline, not a tuned number. To judge in play: whether a level-1 gate's 180 leaves a warhead any target worth 1M, whether a 5M array around a capital is worth it or unanswerable (the throne's strike and conquest are the only answers), and whether a hole in the blast reads clearly on screen. [2026-09-30] The array drops to 2M and the gate to a flat 500k with a 5 s reload and no level cap: the same questions, at the new prices — plus whether warheads at a 5 s cadence and unbounded reach bring back the oppression that tying them to gates was meant to end.                                                                                                                                                                                                                                                                                                                               |

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
- **AI:** Bots are **Barons** to players (`TribeExecution.ts`, "Tribes" in the code); **Lords** are the
  smarter AI (`NationExecution.ts` + `src/core/execution/nation/*`, "Nations" in the code, shared
  `utils/AiAttackBehavior.ts`), spawned
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
  game's winner is _the_ Hegemon?". [Decided 2026-09-29] The answer is **thrones**: a fixed pool
  of 15 named persistent public lobbies, each with its own seat that the round's winner inherits.
  Full design, decisions L1–L15 and the implementation plan: **`docs/DarkStar-Lobbies.md`**.

### 5.3 Maps

- A map is a folder: `map-generator/assets/maps/<name>/image.png` + `info.json`; run `npm run gen-maps`
  (Go tool — read `map-generator/README.md` and `docs/Maps.md`). Outputs land in `resources/maps/<name>/`
  and `src/core/game/Maps.gen.ts` (generated — do not hand-edit; the `map` section of `en.json` is
  generated too).
- Only the **blue channel** matters: blue = 106 or transparent → water (deep space); blue 140–200 →
  land with rising elevation (plains → highland → mountain); `#000000` → impassable void.
- Already shipped: a `cosmic` map category with `milkyway`, `sol`, `mars`, and others — useful
  references. `info.json` supports free-text Lord names with no flag, `"themes": ["space"]` for
  Baron names, and `custom_tribes`.
- **A map's own Dark Star [Built 2026-09-24, §6.12]:** `info.json` may carry
  `hegemon: { center: [x, y], radius, moat? }`; the Go generator passes it through to `manifest.json`
  untouched, `loadTerrainMap` validates and halves it for a compact map, and both the sim and the
  client build the disc from it (a centred disc sized from the map when absent, as before).
- **Event Horizon** (`map-generator/assets/maps/eventhorizon/`, category `cosmic`, 1800×1800,
  ~450k land tiles, 24 Lords) is the first galaxy map authored around the Dark Star: three spiral
  arms of star clusters in an annulus around an open centre, spiral lanes of deep space between the
  sectors, void at the corners, the Lords in a ring at about 400 tiles from the centre. It is
  written by `scripts/generateGalaxyMap.ts` (deterministic for its seed; `--seed`, `--size`,
  `--land`) — `image.png` and `info.json` — and then `npm run gen-maps` as for any map. The Go
  toolchain lives at `<home>\go-sdk\go\bin` on Tom's machine (the official zip, no installer).
- **No Moon** (`map-generator/assets/maps/nomoon/`, 1800×1800, ~530k land tiles, 19 Lords) [Built
  2026-10-03] is the first map made from one of Tom's Paint sketches (`MapImages/NoMoon.png`): the
  Dark Star in the bottom-right corner, a beam of land running from it to the top left, where it
  has cratered and cracked a moon; the moon's debris is flung out to either flank. The beam is the
  direct road to the throne (plains core, highland rim; the fan of four rays nearest the moat is
  highland and mountain, so the last stretch is slow), the two debris chains are the fleet and
  stargate routes round the sides, and the cracks make the moon itself a set of shards. The drawing
  is generated, not painted: `npx tsx src/scripts/drawings/NoMoon.ts` writes
  `map-generator/drawings/No Moon.png` from a description of the parts, then `npm run map "No Moon"`
  builds it as for any drawing. First `HegemonSim` look: 2 overthrows in 3 seeds (one by the
  mid-beam Lord by gate, one by the largest debris fragment by fleet), the third to the timer.
  The drawing scripts share `src/scripts/drawings/Drawing.ts` (palette canvas, seeded noise,
  blobs, strokes, a Lord placer that works from the pieces of land, the PNG writer).
- **Nucleic Acid** (`map-generator/assets/maps/nucleicacid/`, 1800×1800, ~440k land tiles, 18
  Lords) [Built 2026-10-03] from Tom's second sketch: a double helix of land top to bottom with
  the Dark Star at its centre crossing. The two strands are 54-tile walls (plains with a highland
  rim) that end on the moat from the four diagonals, so armies can march at the throne along them;
  at the other two crossings one strand passes behind the other with a short gap, so each strand is
  three pieces and a crossing costs a fleet hop. Each bulge holds a row of four round base-pair
  islands that almost bridge the strands; the two rows nearest the throne get no Lords (staging
  islands for whoever takes them): with the outer island of each seated, one of those four
  overthrew the throne in all three AI rounds, so the Lord exclusion was raised from 380 to 500
  tiles and the strands carry more Lords instead. Void strips frame the helix.
  `src/scripts/drawings/NucleicAcid.ts`.
- **Nucleus** (`map-generator/assets/maps/nucleus/`, 1800×1800, ~470k land tiles, 12 Lords)
  [Built 2026-10-03] from Tom's third sketch: a Bohr atom. Eight round particles (highland and
  mountain cores) ring the Dark Star at 300 tiles, hugging the moat. They are Baron land: a first
  build seated Lords on every other particle, and a particle Lord overthrew the throne in all
  three AI rounds, twice inside 15 minutes (`NUCLEUS_SEATS` in the script turns them back on).
  Three elliptical orbits (800×200, at 90°, 30° and 150°) are cut where they pass behind the
  nucleus, giving six long arcs that run from near the particles out to the rim and back, each
  carrying one solid electron where its first Lord sits. Void outside a 1150-tile circle frames
  the atom. `src/scripts/drawings/Nucleus.ts`.
- **Jovian System** (`map-generator/assets/maps/joviansystem/`, 1800×1800, ~595k land tiles, 21
  Lords) [Built 2026-10-03] from Tom's sketch of Jupiter and the Galilean moons. The planet is a
  500-tile disc of land, leaning 7°, whose five dark belts are open space, so it is six zones of
  cloud (plains with streaks of highland and the white ovals as storms of high ground). The Great
  Red Spot is the Dark Star, low on the planet and left of centre, so the zones round it are Baron
  land and the Lords sit on the zones' far ends and on the moons: Io (volcanoes), Europa
  (cracks), Ganymede (grooves) and Callisto (craters and the Valhalla rings) on the diagonals at
  gaps of 110, 150, 200 and 240 tiles, with small irregular moons as stepping stones. The ring runs
  from the equatorial belt out to both edges of the map as a strip of land with the four inner
  moons on it. First `HegemonSim` look: overthrown in 3 of 3 seeds, all after 18 minutes and
  mostly by fleet. `src/scripts/drawings/JovianSystem.ts`.
- **Bullseye** (`map-generator/assets/maps/bullseye/`, 1800×1800, ~540k land tiles, 20 Lords)
  [Built 2026-10-03] from Tom's sketch: the Dark Star as the bull inside three concentric rings of
  land at 320–362, 505–562 and 715–780 tiles. Each ring is cracked into arcs (6, 8 and 12) whose
  cracks do not line up from one ring to the next, so every arc is its own piece of land; the two
  outer rings seat one Lord per arc, the inner ring is inside the 500-tile exclusion and is Baron
  land, the last stepping stone before the moat. Each ring faces the star with a ridge of highland
  and mountain. Void frames the corners. First `HegemonSim` look: overthrown in 2 of 3 seeds (both
  by gate, at 16 and 20 minutes), the third to the timer. `src/scripts/drawings/Bullseye.ts`.
- **Cube** (`map-generator/assets/maps/cube/`, 1800×1800, ~560k land tiles, 24 Lords) [Built
  2026-10-03] from Tom's sketch: a cube drawn corner on, with the Dark Star at the near vertex
  where the three faces meet. Solid faces would be about 1.8M tiles, three times the budget, so
  each 760-tile face is a four-by-four grid of parallelogram cells with 67-tile lanes between them
  (100 along the three edges that meet at the star), an archipelago in the shape of a cube. The
  faces are told apart by their light: the top face is plains, the right face has highland rims,
  the left face is in shadow with highland and mountain. The outer row of cells on each face seats
  a Lord, as does the third cell in on each face's diagonal (just past 500 tiles); the cells
  nearer the star are Baron land. First `HegemonSim` look: with the outer rows alone (21 Lords)
  the throne held in 3 of 3 seeds; with those three seated as well, overthrown in 3 of 3 (at 14½, 18 and 19 minutes; the fast one by an inner-diagonal Lord, the other two from the outer rows). `src/scripts/drawings/Cube.ts`.
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
- **Names:** Baron names from `resources/tribeNameThemes.json` (a `space` theme exists); anonymised
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
| AI            | new behaviour under `src/core/execution/nation/` or alongside `NationExecution.ts`                           | AI Hegemon (R6, H11); teach Lords/Barons to treat the Hegemon as the objective.                                                                                                                                                                            |
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
  `HEGEMON0`, name "The Hegemon", **not** in the Lord list, so no `NationExecution` drives it. It owns
  the whole domain and full troops from tick 0. Map Lords placed on the Dark Star (Milky Way's
  "Sagittarius A\*") lose their cell and spawn at random. `HegemonExecution` (the future rules engine)
  registers the seat's `PlayerExecution`. Server-side stamping of `isHegemon` is succession work (M5).
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
  (`invasionCooldownTicks`). [Removed 2026-09-25, §6.13: there is no cooldown.] The gate sits in `canBuildTransportShip` (so the UI and the AI never offer
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
  what is left); AI Lords rarely invade before minute ~13.

### 6.3 As built — invasion economics and the first HUD (2026-09-20)

- **The invader gains nothing from the Dark Star (H5).** `Player.domainTilesHeld()` is subtracted from
  the tile count in `Config.maxTroops` and from the attacker's `numTiles` in combat (the large-territory
  bonuses). Before this, every domain tile raised the invader's own troop cap, so a successful invasion
  snowballed.
- **Client state.** `PlayerUpdate` carries `domainTilesHeld`, `invasionCooldownUntil` (a tick; gone since §6.13) and
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
- **Leveller strikes (H11), `HegemonExecution.punish`**, AI Hegemon only; tunables `leveller*` (renamed from `punitive*` on 2026-09-26, when H19 took the name) in
  `HEGEMON_DEFAULTS`. Two findings from `HegemonSim` shaped it: (1) "most troops right now" flips every
  few seconds as Lords spend their armies, so strength is **capacity** (`Config.maxTroops`); (2) with
  close leaders a single razed city ended every strike within a second, so the recall has hysteresis
  (`punitiveRecallPercentOfRival`), and the aim is the target's **highest-level city** (nearest border
  tile as fallback) because razed land is resettled almost immediately.
- **Measured (AI-only, 20 min).** World: 8 strikes from minute ~4, most 6–60 s, razing 4–16k tiles and
  3–4 cities and costing the Hegemon 0.1–1.5M troops; they fall on four different Lords and nobody
  invades (previously Benin invaded at 16:25 and won at 18:43) — the Hegemon wins on the timer. Milky
  Way: 4 strikes; Predators, struck twice, invade at ~minute 15 and are evicted. Against a strong
  target with few neighbours a strike can burn all its troops for almost no net land.
  `HegemonSim` now logs every strike.

### 6.5 As built — AI challengers go for the throne (2026-09-20)

- **Before:** a Lord only ever landed on the Dark Star by accident — a random boat (which skips
  targets stronger than itself) or retaliation for a strike — and with a fifth of its army.
- **`NationHegemonBehavior`** (`src/core/execution/nation/`), asked by `NationExecution` before
  `maybeAttack()`; if it acts, the Lord leaves its other wars alone that turn. Lords only — Barons
  never invade [Decided]. Lords stay **self-interested**: nothing helps another invader [Decided].
  - **Launch:** the slot is free for it (`canInvadeDarkStar`), no fleet of its own is already bound for
    the Dark Star, and its troops reach a share of the Hegemon's **current** troops that falls linearly
    over the round (`aiInvadeTroopPercentAtStart` 100 → `aiInvadeTroopPercentAtEnd` 50): bolder as the
    timer runs down, and opportunistic when the Hegemon has just spent troops on a strike or on another
    invader. It sends `aiInvasionSendPercent` (70%) to the nearest point of the domain's rim.
  - **Push:** while it holds the slot, every attack turn it sends everything above
    `aiInvasionReservePercent` (20% of its capacity) into the land attack.
- **Measured (AI-only, 20 min, 3 seeds per map; `HegemonSim` now prints a round summary).** Invasions
  begin at minute ~10 (was ~13–16 on World, almost never on Milky Way), 3–5 per round by different
  Lords in succession. At the current F1 placeholder the throne holds every time: **0 of 6 overthrown**,
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
  forever — `HegemonExecution.maybeEndSpawnPhase` now ends it once every Lord has taken its place (or
  after 10 s); and the win modal treated an enduring Hegemon as an AI "Lord" win.
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
  (Lords and humans, never Barons): troops, capacity (`Config.maxTroops`), cities, land share, and
  strike status (Free / ×N / Immune / Striking / Invading). Win modal: "The Hegemon Reigns Supreme"
  (a win from the throne, a loss for everyone else) and "Overthrown by X" for a fallen human Hegemon.
- **Sim.** `HegemonSim --human` seats a passive human (no waves, no punitive strikes; stall routing
  only). **World, seed a: a do-nothing throne survives on the timer with the domain at 5%** — Ethiopia
  lands at 15:12 and grinds it down while the Hegemon's troops never drop below 5.2M, because H13 only
  fires on a stall and an advancing invader is otherwise unopposed. A human Hegemon must defend by
  attacking the invader's domain tiles; whether it should also get the AI's landing wave is a playtest
  question. AI-only rounds are unchanged (4 strikes, all fought, 5 landings, throne holds).
- **Verified in the browser** (Playwright, World, 50 Barons): toggle → seated with the whole domain and
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
4. **Build-menu growth (medium, parallel with 3). [Dropped 2026-09-24]** The gate fit as a seventh
   radial slice and raids (the next slice) were abandoned with C2; MIRVs go (S6), so the menu shrinks.
   Revisit only if a new structure type arrives.
5. **AI gates (medium). [Built 2026-09-24, §6.11]** Lords build gates (`NationStructureBehavior` ratio table) and shoot at
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
  flash at impact (`fx.strikeImpactRadius`). [2026-10-04] The atom cues that stood in are gone: a
  strike or stargate shot leaves to Tom's `launch` cue and lands to his `landing` cue, both heard by
  the shooter and the aimed tile's owner only (S8).
- **Measured.** World seed a, AI-only: identical to the previous build until the first strike lands at
  minute 2.8, then the rounds diverge on timing (a flight is now the arc ÷ 10 tiles/tick, 5–8 s on World
  rather than 3 s + distance); both end with the throne holding on the timer (before: 4 strikes,
  5 landings, domain low 16%; after: 3 strikes, 2 landings, domain low 36% — one seed, not a trend).
  Browser (Playwright, World, 50 Barons, human throne): a strike on Russia launched at tick 390 landed
  at tick 447 exactly as the HUD announced, trail and impact ring visible, bubble grew from 6 to 155
  tiles in 3 s; a second strike recalled in flight vanished and its troops came home.
- **Deferred.** Own art and sounds for the projectile; an aim preview (no hover phase to draw it in);
  a launch marker at the Dark Star.

### 6.10 As built — stargates for human players (2026-09-24)

Stage 3 of §6.8. Humans only (Lords neither build nor fire gates, stage 5), no build-menu redesign
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
  landlocked pocket; exclaves accumulate with shots, to be revisited once Lords fire gates (stage 5).
  Boats are unchanged (a shore landing was never absorbable).
- **Tests.** `tests/Stargate.test.ts` (15): build/cost/level cap, `stargateFor` and ranges, refusals,
  flight and beachhead on neutral and enemy land, the intent, recall, a Dark Star landing claiming the
  slot, refusal while the slot is taken, the mid-flight turn-back, the bubble rule, and the enclave
  rule against a beachhead inside a Lord and inside the Dark Star (with real combat and the players'
  own `PlayerExecution`s, which `setup()` does not add): the pocket outlives its attack, falls when the
  landing tile is retaken, and the Dark Star foothold falls to the H13 counter-attack.
- **Measured.** World seed a, AI-only: byte-identical to the previous build (no AI gates). Browser
  (Playwright, World, 30 Barons, a human spawned 155 tiles from the centre with infinite gold): two
  gates built, placement ring 120 tiles wide reaching the moat, aim ring and the submenu slice with its
  tooltip, a shot at Madagascar 105 tiles away in the air ~10 ticks with its HUD row, a shot on the
  domain that landed, claimed the slot and was evicted by the landing wave — the panel then showed the
  5-minute cooldown.
- **Deferred.** Own art for the gate; a "gate shot" label instead of the boat row's; whether a shot on
  the Dark Star should turn back a fleet already bound there; the menu list (stage 4) once more slices
  arrive. AI gates followed as §6.11.

### 6.11 As built — Lords build and fire stargates (2026-09-24)

Stage 5 of §6.8. Decided with Tom before building: every Lord gets gates under the silo's
affordability logic, with the difficulty setting how many and how eagerly; a gate sits before the silo
in the build order; far-side shots into a land neighbour are allowed at the lowest priority; the gate
fires the invasion ahead of the fleet and never reinforces its own foothold. No new gate rules or
numbers for humans, no menu work, no balance change.

- **Building (`NationStructureBehavior`).** `UnitType.Stargate` joins the ratio table (per city:
  Easy 0.10, Medium 0.15, Hard 0.20, Impossible 0.25; perceived cost +100% per gate owned, so the
  nuke save-up still applies), the first gate at 0.4 per city like the first silo, a hard cap of
  three, in the build order Port → Factory → SAM → **Stargate** → Silo. Hegemon mode only (the
  behaviour is handed the Lord's `NationHegemonBehavior` and asks `game.darkStar()`). **The throne
  want:** while `wantsThrone()` holds (slot free for it, troops at the falling bar of §6.5) and no gate
  reaches the rim, the Lord upgrades the gate that falls least short if its levels left would close
  the gap (`gateReaches()`: gate, the rim tile it would aim at, shortfall), else builds a first gate —
  before any other structure. **Placement** (`stargateValue`): interior and spaced like a silo, minus a
  third of a point per tile from the aim: the Dark Star's edge in the throne state, else the centre of
  the nearest hostile player whose land does not touch ours.
- **The invasion by gate (`NationHegemonBehavior`).** The launch decision is unchanged; when it fires,
  a ready gate whose range reaches the rim (`rimTileToward(gate)`: where the line to the centre enters
  the disc) shoots the same `aiInvasionSendPercent` share of the army at that rim tile through
  `GateShotExecution`, and the transport is the fallback. A shot bound for the Dark Star counts as a
  fleet under way; while holding the slot the Lord pushes by land only.
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
  the six rounds (26–59 per round, by 13–32 Lords), 31 upgrades; 780 shots, 776 landed, 4 turned
  back (a slot claimed in flight), 13 on the Dark Star; the pocket still stood 30 s after landing in
  613 of 754 checked (81%). Domain low: World 36/45/0% → 0/93/93%, Milky Way 31/82/86% → 47/66/19%.
  **Landlocked beachhead pockets alive at the end: World 4, 9, 23; Milky Way 1, 0, 3** — from single
  tiles standing on the tag alone (a "1t" pocket is exactly the hidden-weak-tile case of §6.10) to
  inland conquests of thousands of tiles that only count because they touch no water. On World the
  map ends visibly pockmarked; on Milky Way hardly at all. That is the number Tom asked for to decide
  whether the beachhead rule needs a cap — the sim's per-round list names each pocket.
- **Tests.** `tests/NationStargate.test.ts` (11): a throne-ready Lord builds its first gate in the
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
landing while borders, Barons and the Hegemon show from the start, and only **humans and Lords
fly**; the map is **Milky Way sized with 24 Lords in a ring**, the Dark Star **carved by the engine**
from an `info.json` override, **sci-fi names on this map only**, and it is called **Event Horizon**.
Go came from the official zip into the user profile, no installer.

- **The window is a phase of the sim (`src/core/game/Opening.ts`, `GameImpl.endSpawnPhase`,
  `GameImpl.mayRun`).** When the spawn phase ends the sim measures, for every spawned human and
  Lord, the flight from the Dark Star's centre to its spawn tile on the projectile's own path
  (`flightPath`: the Parabola stepper at `strikeSpeed`, exactly as `RazeExecution` and
  `GateShotExecution` step it; a flight takes `path.length` ticks), fixes the **opening window** at
  the longest, capped at `openingMaxSeconds` (15) in `HEGEMON_DEFAULTS`, and sets the round's
  **start tick to the end of that window**. Until then `inOpening()` holds: no execution runs or is
  initialised except a spawn already under way (`Execution.activeDuringOpening`, which only
  `SpawnExecution` answers, so a Lord's last hop still lands and a client's late pick is
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
  ticks and lands as the window ends. A Lord that hops once more after the phase ends re-aims its
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
  lanes of deep space, elevation rising towards the arm cores; 24 Lords placed on land nearest an
  evenly spaced ring at r ≈ 400 ± 36 (jittered, at least 70 tiles apart, with room around each); flags
  empty; `themes: ["space"]`; `multiplayer_frequency: 4`; `hegemon: { center: [900, 900], radius:
162, moat: 18 }`. In the map list under `cosmic` as "Event Horizon" (`GameMapType.EventHorizon`).
- **Measured (`HegemonSim`, seeds a/b/c, 400 Barons, Medium, 20 min).** No overthrow in three
  rounds (the Hegemon held on the timer each time); Dark Star landings 5, 5 and 3 — **13 in all, 9 by
  gate and 4 by fleet**; domain low 63 %, 85 % and 71 %; gates built 20/19/19 by 10–13 Lords with
  5–7 upgrades; shots 25/23/29, all landed, pockets held after 30 s in 22/25, 20/23 and 23/29;
  landlocked pockets at the end 1, 0 and 0. Against §6.11 on the same build of the AI: World and
  Milky Way ran 26–59 gates and ~130 shots a round with 72 and 18 Lords; Event Horizon's 24 Lords
  fire far less, and the Dark Star is invaded about as often as on Milky Way. The opening window on
  this map measured 79 ticks in the browser (25 flyers, 30 Barons); the first landing at 3.2 s and the
  last at 7.9 s, the round beginning on that tick with the clock still at 20:00.
- **Tests.** `tests/HegemonOpening.test.ts` (11): the window is the longest flight and the round
  begins as it ends; nothing runs during the opening and orders queue; a spawn under way lands while
  a late pick is refused; the window is capped and the ordinary immunity follows the landing; Barons
  do not lengthen it; none outside Hegemon mode; the override places the disc, the moat falls back, a disc that does not fit
  is refused, the manifest's entry reaches the loaded map halved on a compact map, a malformed entry
  is refused. `tests/client/OpeningFlights.test.ts` (6): a phantom launches at the start tick, follows
  the path without going back and lands exactly when the sim's flight would, revealed and reported
  once; a flight longer than the window lands as it ends; the hidden set is reported once per change;
  re-aiming and late spawners; the controller's pull-out, cues, return home and the Hegemon's wide
  view (no target tile on a phantom). `MapConsistency` covers the new map's files.
- **Deferred.** Own art for the projectile and a launch sound of its own; the flights in replays;
  decorative stars in the void and a per-map palette; per-map thumbnail colours; whether 24 Lords is
  the right count once Tom has played the map. [2026-10-04] The landing now plays Tom's `landing`
  cue, to the player whose flight came down only; the Hegemon and spectators hear none (S8).

### 6.13 As built — the throne's toolkit, chunk 1 (2026-09-25)

M3's small sim rules from the 2026-09-24 review, on `feat/hegemon-toolkit` (off
`feat/opening-and-galaxy-map`). Sub-questions settled with Tom the same day: the Hegemon's donations
ignore the lobby's donation toggle; it may donate to the current invader; the MIRV is hard-off in
core, not a lobby default; the Hegemon's build menu on the Dark Star opens greyed out rather than
being hidden (revisited with gifts, H18).

- **Nothing on the Dark Star (H2).** `PlayerImpl.validStructureSpawnTiles` — the owner-tile flood
  every land structure and port site goes through, for humans, the build menu (`buildableUnits`) and
  the Lords (`NationStructureBehavior` asks `canBuild`) alike — skips domain tiles, so no one can
  build on the Dark Star whoever holds the tile. `canBuildUnitType` refuses the Hegemon every
  `Structures` type outright (it used to refuse only the gate): none on the domain, none on a strike's
  bubble. This is what closes F8: a Hegemon silo is no longer possible. The AI Hegemon never built, so
  nothing changes for it. Gifts (H18) will go through the host's placement, not the Hegemon's.
- **No re-invasion cooldown (H12).** `invasionCooldownSeconds`, `GameImpl`'s per-player
  `_invasionCooldownUntil` map and the `invasionCooldownUntil` / `invasionCooldownTicks` accessors are
  gone; `canInvadeDarkStar` is now simply "nobody holds the slot, or you do". `PlayerUpdate` lost
  `invasionCooldownUntil` (client-side only, no wire change). `TransportShipExecution` and
  `GateShotExecution` refuse a Dark Star landing with `dark_star_occupied` alone; the
  `dark_star_cooldown` message and the panel's "You may invade again in" line went with it. The
  single-invader slot, the turn-back rule and H13 stall routing are untouched.
- **The Hegemon donates troops to anyone (H9).** `canDonateTroops`: a Hegemon donor skips both the
  `isFriendly` requirement and the lobby's `donateTroops` toggle (which only ever gated human
  recipients); a Hegemon recipient is refused for everyone. `canDonateGold` refuses the throne as donor
  or recipient explicitly (it already failed through `isFriendly`). The engine's per-recipient donation
  cooldown still applies. Nothing else changes: the HUD's donate button reads `canDonateTroops` from
  the player actions, so it appears on every challenger's panel for a human Hegemon; the order is the
  ordinary `DonateTroopsExecution`. No AI use yet.
- **No MIRVs, and the warhead names (S6).** `Config.isUnitDisabled(MIRV)` is true whenever
  `hegemonConfig().enabled` (FFA with the Hegemon on), whatever the lobby's `disabledUnits` says; the
  singleplayer lobby hides the MIRV row (`GameConfigSettings` gained `hiddenUnits`). The enum and the
  `disabledUnits` wire field are unchanged. `en.json` only: Atom Bomb → **Nuclear Warhead**, Hydrogen
  Bomb → **Antimatter Warhead**, in the unit names, build menu, keybind labels, event lines and the
  tutorial; MIRV strings are left (they show only outside Hegemon mode).
- **Sim baseline (`HegemonSim`, Event Horizon, seed a).** Identical to the pre-change run for the
  first six minutes, then diverging: `NationMIRVBehavior.considerMIRV` now returns before its
  hesitation roll, so every Lord's random stream shifts from the first tick a Lord with a silo and
  MIRV gold asks; the Lords also stop saving for a MIRV. A control run with only the MIRV hard-off
  reverted matched the pre-change run tick for tick until 17.08 — right after the second gate landing
  on the Dark Star, with the first invader (evicted at ~15) no longer barred by a cooldown — and
  differed only in that invader's later shots: H12 (and H2, on the beachhead) acting as decided,
  nothing else. All three runs ended on the timer with the throne alive; Dark Star landings 5 / 5 /
  6 (control); domain low 75 % / 69 % / 92 %; strikes 7 / 4 / 7.
- **Tests.** `tests/HegemonToolkit.test.ts` (10): the Hegemon can build no structure on the domain
  or on a bubble; an invader cannot fortify held domain tiles; a domain tile is never chosen as the
  site for a nearby build; challengers build as before; the throne donates to allies and strangers,
  the invader included, with the toggle off; gold and donations to the throne stay closed; the order
  carries the troops and the cooldown applies; MIRV off in Hegemon mode, the other warheads and
  MIRV outside Hegemon mode untouched. `HegemonInvasion.test.ts` now checks an evicted invader may
  sail again at once; `HegemonChallengerAI.test.ts` that the AI tries again the moment it is evicted.
- **Deferred.** AI use of the throne's donations (H9); the build entry on the Hegemon's own tiles
  is greyed rather than hidden until the gifts menu (H18) decides the menu's shape.

### 6.14 As built — gifts (2026-09-25)

M3 chunk 2, on `feat/hegemon-toolkit`. Sub-questions settled with Tom the same day: a gift may
also **upgrade** the host's existing structure; **every challenger** can receive one, Barons
included; the Gift **takes the ally slot** of the Hegemon's radial menu on a challenger's tile; the
host gets **one event line**.

- **Placement is the host's, the bill is the throne's.** `Player.buildableUnits`, `canBuild`,
  `findUnitToUpgrade`, `canUpgradeUnit`, `upgradeUnit` and `buildUnit` gained an optional **payer**
  (default: the player itself). Affordability is judged against the payer's gold and the payer is
  charged; the cost is always the host's own — their structure count, as if they had built it — and
  the build is recorded against the host (`recordUnitConstructed`), so their next one costs more.
  Everything the host could not do, the throne cannot gift: H2 keeps the Dark Star empty even for
  an invader's held tiles, and the Hegemon's own list stays refused (`canBuildUnitType`).
- **The order.** A new intent `gift_unit` `{ unit, tile, host, amount? }`, appended to the intent
  union (zbin order kept). `GiftExecution` refuses anyone but the Hegemon, non-structures, a dead or
  Hegemon host, and a tile the named host does not hold (the tile changed hands in flight — the
  throne is told with `dark_star_gift_refused`, nobody else gets the gift). Otherwise it hands over,
  from its first tick, to the ordinary `UpgradeStructureExecution` (an upgradable structure of that
  type is near the tile, `amount` steps) or `ConstructionExecution` (a new placement), both of which
  now take the payer. The structure is the host's from the first tick, under construction like any
  build; the host sees `dark_star_gift` / `dark_star_gift_upgrade` in the events display (the
  client translates the `unit` param through `unit_type.*`). Three ticks from order to placement:
  the gift, the construction's init, the build.
- **The menu.** `GameRunner.playerActions` for a Hegemon on a challenger's tile returns the
  **host's** `buildableUnits` with the Hegemon paying, plus `giftHost`. The radial menu then puts
  `giftMenuElement` (build icon, gold, tooltip "Gift to {name}") in the ally slot — the throne can
  never ally (H9) — and its submenu is the ordinary build submenu in a "gift" mode: same entries,
  costs and bulk-upgrade steps, the count is the host's, and every leaf sends `gift_unit` with the
  host; the sim decides between placing and upgrading. [Added the same day, after Tom's playtest]
  **The bottom build bar works too:** `UnitDisplay` lets the throne pick any structure (and the
  warship) on gold alone; `GameRunner.playerBuildables` — what the placement ghost asks — has the
  same host branch as `playerActions`, so the ghost turns green on a challenger's tile at the
  host's price, wears the host's colours, and `BuildPreviewController.createStructure` sends
  `gift_unit` to the tile's owner at the click instead of `build_unit`. The keyboard build grid
  (`build-menu`) is unchanged.
- **Tests.** `tests/HegemonGifts.test.ts` (10): the gift list is the host's list at the host's
  prices and empties when the throne cannot pay; a gift is the host's from the start, paid by the
  throne at the host's price and counted as the host's build, under construction then live; the
  host is told; a second gift of the same type upgrades the first; refused when not the Hegemon,
  when the named host does not hold the tile (with the throne's notice), on the Dark Star, when the
  throne cannot pay, to the throne itself, and for non-structures.
- **Deferred.** Gifts from the keyboard build grid; AI use of gifts (Lords neither give nor
  expect them); a per-gift refusal line beyond the changed-hands case (the others only warn).

### 6.15 As built — destroyers of the Dark Star (2026-09-25)

M3 chunk 3, on `feat/hegemon-toolkit`. Sub-questions settled with Tom the same day: the **AI
Hegemon does not build them yet** (its gold plan is M4's); an enemy warship is answered **only
inside the moat**; the **moat repairs** them (passive port healing anywhere in the ring); with
nothing in range they **sail to meet** an inbound invasion fleet.

- **Building.** The engine's `Warship` (shown as "Destroyer" from M6, S7). `PlayerImpl.warshipSpawn`
  has a Hegemon branch: no port, the ship spawns on the clicked tile if that tile is **moat water**
  (`Game.isInMoat`: water inside `isInDarkStarOrMoat` and outside the disc — new, on the interface),
  refused anywhere else. Ordered like any warship — from the bottom build bar (`UnitDisplay` lets the
  throne pick a warship without a port and greys out the structures) with the placement ghost on a
  moat tile, or from the attack submenu on a moat tile — through `build_unit` and
  `ConstructionExecution`; the engine's cost curve (250k rising per ship to 1M)
  from the throne's gold; any number. Challengers still need a port.
- **Moat-bound.** `WarshipExecution` knows a Hegemon owner (`hegemon`, set in `init`): random
  patrol tiles are moat tiles only; `MoveWarshipExecution` ignores a Hegemon order to a tile outside
  the moat. Passive healing applies while in the moat; there is never a retreat, since there is no
  port to retreat to. The half-resolution water pathfinder can still put a ship on a coast tile of
  the ring for a tick, as at any coastline (the tests allow one tile of slack).
- **Targeting** (`findBestTarget`, a Hegemon-only filter, `hegemonMayEngage`): transports only when
  their landing tile (`Unit.targetTile`, set at launch) is inside the Dark Star, whoever sent them;
  trade ships only when owned by the challenger holding the invasion slot (`darkStarInvader`), and
  without the "a port to bring the prize to" requirement — the captured ship finds no Hegemon port
  and is deleted, so it is simply lost to the invader; warships only while inside the moat. Everything
  else is skipped. Gate shots are projectiles and stay untouchable, as for SAMs.
- **Intercepting.** A new step after the three target priorities: with nothing in range, the nearest
  active fleet on the map bound for the Dark Star (ties by unit id) gives a station — the moat tile on
  the ray from the centre through its landing tile at the ring's midline, nudged outward to the
  nearest moat water (`moatTileToward`; one exactly-rounded square root and division, integer
  otherwise) — and the destroyer paths there, firing once the fleet is in range. With no such fleet
  it patrols as before.
- **Tests.** `tests/HegemonDestroyers.test.ts` (11): built in the moat without a port and nowhere
  else, the menu agrees, a challenger still needs a port, the build order spawns where pointed;
  patrol tiles stay in the ring, a move order out of the moat is ignored while one within it is
  taken, repair in the moat and never a retreat; an invasion fleet is engaged whoever sent it, a
  fleet bound elsewhere is left alone, only the invader's trade ship is taken, an enemy warship in
  the moat is engaged; a destroyer sails towards a fleet inbound on the far side.
- **Deferred.** AI Hegemon destroyers (M4); the "Destroyer" name and icon (M6, F14); a warship
  outside the moat shelling a destroyer from range goes unanswered by design — revisit if a playtest
  shows it being farmed.

### 6.16 As built — punitive strikes (2026-09-26)

M3.5, H19 as decided the same day. Tom's four answers before the build: the order is a **radial
slot** (not a bare click), the badge is seen by **the throne and the silo's owner**, **one radius**
for both warheads, and **everyone is told** of the levy.

- **The flag.** `Unit.punitiveFlag()` / `flagForPunishment()` / `clearPunitiveFlag()` on the silo
  (`UnitImpl`): warhead and expiry tick, the severer warhead kept, the expiry always the latest
  launch's; expired flags read as none. `NukeExecution` flags the silo right after `silo.launch()`
  — a Nuclear or Antimatter Warhead only (MIRVs are off anyway), never for the Hegemon, and not
  while `Game.hegemonStrikeOn(player)`. The flag rides `UnitUpdate.punitiveFlag`; the client's
  `UnitState` carries `punitiveWarhead` (1/2) and `punitiveExpiresTick`.
- **The strike is `RazeExecution` in punitive mode** (fourth constructor argument; the
  `punitive_strike` intent, tile only, appended to the union and to the hand-written `Intent`
  type). `init` finds the owner's flagged silo on the tile (refused with
  `dark_star_punitive_none` otherwise), skips the tyranny refusal, keeps the one-strike-per-target
  refusal, takes the **levy** — `levy()`: every living challenger in `players()`, Barons included,
  `floor(troops × percent ÷ 100)` each, told by `dark_star_levy` — clears the owner's other flags,
  and warns the owner with `dark_star_punitive_inbound`. The landed `Attack` is `markPunitive()`
  (which also marks it a strike, so `isStruckBy`, the bubble costing and the counter-attack rules
  all apply). In `tick`: the tyranny multiplier is 100 for a punitive strike and the floor, or an
  empty frontier, calls `halt()` instead of `comeHome()`; a halted strike ends after
  `punitiveHaltSeconds` unless `bubbleBreached()` (any bubble tile no longer the Hegemon's), which
  clears the halt and refreshes the frontier; `addNeighbors` skips tiles beyond
  `punitiveRadius` of the aim tile; `recall()` is a no-op and `PlayerImpl.orderRetreat` ignores a
  punitive attack; `comeHome()` adds nothing back to the throne. `StrikeInFlight.isPunitive()` and
  `AttackUpdate.isPunitive` carry it to the HUD. `RazeExecution.punitiveOption()` is what
  `GameRunner.playerActions` puts in `PlayerActions.punitiveStrike` for the throne on a flagged
  silo's tile (warhead, expiry, levy share, the levy in troops as it stands).
- **No nukes from a captured silo.** `PlayerImpl.canBuild` refuses the Hegemon the atom bomb, the
  hydrogen bomb and the MIRV outright.
- **AI Hegemon.** `HegemonExecution.punishLaunches()` every second: for each living challenger not
  under a strike and holding at least `punitiveAIMinLandPermille` of the map's land, the severest
  flag (then the freshest) is struck. The H11 leveller's tunables were renamed `leveller*`.
- **Tunables** in `HEGEMON_DEFAULTS`: `punitiveFlagSeconds` 30, `punitiveLevyPercentNuclear` 10,
  `punitiveLevyPercentAntimatter` 25, `punitiveRadius` 34, `punitiveHaltSeconds` 5,
  `punitiveAIMinLandPermille` 50.
- **Client.** Badge: a ring around each flagged silo through the nuke-telegraph pass
  (`extractPunitiveBadges` in `frame/derive/NukeTelegraphs.ts`, relation 3 = red for Nuclear, 4 =
  white for Antimatter, radii 3/6 tiles), derived in `GameView` for the throne and for the owner.
  Radial: `punishMenuElement` takes the **attack slot** on a flagged silo's tile when
  `playerActions.punitiveStrike` is set — tooltip with the warhead, the levy share and troops, the
  seconds left; it sends `SendPunitiveStrikeIntentEvent` (`punitive_strike`). HUD: the strike rows
  in `attacks-display` read "Punitive strike" / "Punitive strike on {name}", the incoming hint
  says it razes only around the silo, and the outgoing row has **no Recall**. Strings under
  `dark_star.punish_*`, `dark_star.punitive_*`, `dark_star.warhead_*` and `events_display.
dark_star_levy / dark_star_punitive_*`.
- **Tests.** `tests/PunitiveStrikes.test.ts` (12): the flag's life, severity and expiry; no flag
  under a strike; the option; the levy (the throne unchanged, the offender's flags spent, the
  leftover burnt — the throne is held at its ceiling, where it regenerates nothing); the Antimatter
  share; the landing on the silo, the radius cap, the halt and the pop with the silo destroyed;
  the resume on a retaken tile; no recall; the tyranny floor as a halt for a player whose land fits
  in the pocket; the intent from the throne and from a challenger; the AI striking a flag and
  sparing a player under the land bar. Test note: structure hand-over and clearing are
  `PlayerExecution`'s, so the harness registers one per challenger.
- **Measured (`HegemonSim`, which now tags punitive strikes and counts flagged launches).** AI
  only, seed a, 20 min. **Event Horizon:** 33 flagged launches, 11 strikes of which 8 punitive,
  levies 430–690k troops, 9–199 s each, all but one fought; three popped 1.9–2.5k tiles, the rest
  0–90 — the target retook the whole pocket. Round: 10 landings, domain low 79%, the throne holds.
  **Milky Way:** 22 flagged launches, 6 punitive of 11 strikes, levies 400–640k, 9–60 s, all
  fought, almost nothing popped (291 tiles from all 11 strikes). The pattern: a Lord with a
  large standing army retakes a fresh pocket faster than the strike razes it at the 3× raze slow
  rate, so a punitive strike against a strong power is beaten more often than not, while a
  smaller target loses the pocket. Whether that is the balance Tom wants is F20's question; the
  numbers to move are the levy shares, `razeSlowPercent` for punitive strikes, or the density
  floor.
- **Browser.** `.claude/skills/run-openfront/punitive.mjs` plays a challenger on Event Horizon:
  builds a silo, fires a Nuclear Warhead at the Dark Star, and screenshots the badge on its own
  silo (a solid red ring, the sprite visible inside; the AI throne then rightly spares a 52-tile
  human, so the strike never comes). `punitive-throne.mjs` plays the human Hegemon: waits for a
  Lord's launch, screenshots the badge and the radial on that silo, clicks Punish, and follows
  the strike to its pop. Seen working end to end (Event Horizon, minute 8): the red ring on
  Polaris Order's silo, the radial with Punish in the attack slot, a 314k levy with the throne's
  own troops untouched, "Landing in 3s" then "Razing around the silo" with no Recall, a 201-tile
  bubble, Polaris counter-attacking it, and the strike over 18 s after landing with the silo
  retaken — the target won the pocket, as the sim predicts for a strong Lord. Both scripts
  retry state reads across the client's own `/#refresh` reload, which also ended the first two
  attempts (not a sim error).
- **Revised the same day, after Tom's first look.** A plain left click on a flagged silo orders the
  strike (`ClientGameRunner.inputEvent` checks `actions.punitiveStrike` before the attack/boat
  branches; the radial slot stays). Levy 10% / 25%, radius 34. SAMs are hard-off under a Dark Star
  (`Config.isUnitDisabled`, the lobby's `hiddenUnits`; Lords already skip disabled structures).
  The Nuclear Warhead costs 1M gold in Hegemon mode. The inbound line is one sentence.
  **Tom then could not order one at all:** the option and the strike matched the clicked tile to
  the silo's one tile, while the icon and its ring are drawn several tiles wide, so nearly every
  click missed. Now `RazeExecution.flaggedSiloNear` finds the nearest flagged silo within
  `CLICK_RADIUS` (6 tiles) of the clicked tile, `PlayerActions.punitiveStrike` carries its
  `siloTile`, and the strike aims at the silo whatever tile was clicked (order or radial).
  **The badge scales with zoom** (Tom: hard to spot zoomed out): `NukeTelegraphPass.draw` now
  takes the zoom and sizes badge rings from the structure icon's own curve (`badgeRadius`, the
  icon's half size plus 15%, without the icon's zoomed-out dot regime), with a stroke of at least
  three screen pixels; the derive's radii are ignored for badges. The nuke telegraphs themselves
  are unchanged. **The ring is the click target** (Tom: a fixed tile radius felt delicate):
  `ClientGameRunner.flaggedSiloUnderClick` hit-tests a left click against every flagged silo's ring
  as drawn at the current zoom (`badgeWorldRadius` + `badgeWorldStroke`, shared with the pass) and
  sends that silo's tile; the radial's Punish sends the option's `siloTile` too; the worker's own
  reach for a queried tile (`CLICK_RADIUS`) is 12.
- **Deferred.** A per-warhead radius (F20); a badge countdown; the Dark Star panel listing flagged
  silos; a levy line that names the total.

### 6.17 As built — spaceports anywhere and their harbours (2026-09-26)

Step 1 of the space economy (S7, revised the same day; M3.6). Tom's calls before the build:
straight lanes in the sim, not only on screen; the three-leg freighter route with its two limits
accepted; the spaceport placed exactly where clicked, like a city; freighters cross any land but
the disc, the moat included; the overland penalty starts at **half speed** and the global spawn
throttle is left alone; stargates stay purely offensive.

- **Harbours.** `Game.harbours(portTile)` (`HarbourCache`, `src/core/game/Harbours.ts`): a
  breadth-first search over passable land from the port, level by level in the map's fixed
  neighbour order, stopping at the first level that touches water and keeping that level's first
  water tile on each body of space (`getWaterComponent`); the Dark Star's disc is never entered;
  `harbourMaxRange` (250 tiles) bounds the search. Each `Harbour` carries the tile and the overland
  `path` from the port (exclusive) to it (inclusive) — the freighters' land legs of step 2. Cached
  per port tile until the map's `waterVersion` changes; terrain only, so every client agrees. A
  coastal port's harbours are its adjacent water, with one-tile paths.
- **Placement.** `PlayerImpl.canSpawnUnitType` sends the port through `landBasedStructureSpawn`
  like a city; `portSpawn` and `radiusPortSpawn` are gone. A blocked site moves to the nearest free
  tile, as for any structure. The build menu and the placement ghost follow (they ask `canBuild`).
- **Destroyers.** `PlayerImpl.warshipSpawn`'s challenger branch: the click must be water; the ship
  spawns at the **harbour nearest the click** among the owner's active spaceports' harbours on the
  click's body of space (ties to the lower tile) and patrols from the click as before; without a
  spaceport reaching that body of space it is refused. `WarshipExecution` keys repair on harbours:
  the retreat target (`retreatPort`, unchanged on the wire) is a harbour tile; docking, capacity
  (`port.level()` per harbour) and active healing are counted around it (`portAt` finds the port
  behind a harbour); passive healing applies within range of any harbour of the owner's. The
  Hegemon's moat branch (H10) is untouched.
- **Lord AI.** `NationStructureBehavior`: a landlocked Lord still tries a spaceport (the
  build order no longer skips it; the crowded-map first structure stays a factory when
  landlocked, as before); with no
  coastal site, `randInlandPortTileArray` samples 5 territory tiles at most every 300 ticks and
  keeps those whose harbour reaches the ocean or a body of space shared with a trade partner.
  Coastal Lords place as before. `NationWarshipBehavior` centres its spawn search on the port's
  harbour.
- **Tests.** `tests/Spaceports.test.ts` (9): inland placement where clicked and the menu agrees; a
  coastal port's harbour is its adjacent water; an inland port's harbour is the nearest water with a
  land path to it; none out of range; the destroyer is launched from the nearest harbour, refused
  on land and without a port; a damaged destroyer retreats to an inland port's harbour, docks and
  repairs; beside the Dark Star a port harbours in the moat, the path never enters the disc, and a
  challenger's destroyer is launched into the moat from an inland port. `Warship.test.ts` now
  expects the harbour as the retreat target; the trade scenarios keep only ports standing on their
  shore tile (a blocked site now moves instead of failing) and their snapshots moved by under 1%.
- **Not yet.** Inland ports do not trade until step 2 (port pairing still wants adjacent water), and
  the harbour's path is unused until then. [Done 2026-09-26, §6.18]

### 6.18 As built — freighters overland (2026-09-26)

Step 2 of the space economy (S7). One call made while building: a freighter on its land legs is
**out of a destroyer's reach** (a ship in the harbour could otherwise take one on the tiles next
to it), so inland trade is slow but safe, as the trade-off intends.

- **Pairing.** `PortExecution.tradingPorts` pairs two ports when a harbour of each lies on the
  same body of space (`Game.harbours` + `getWaterComponent` / `hasWaterComponent`); the
  weighting, the spawn odds and the global throttle are as they were. A coastal port's harbours are
  its adjacent water, so its partners are unchanged; a port with no harbour trades with nobody.
- **The voyage.** `TradeShipExecution` sails three legs. `planVoyage` picks the first of the
  source port's harbours and the destination's **landing** on that body of space (`landingFor`),
  in harbour order, so every client agrees. **Out**: the source harbour path's land tiles;
  **space**: the memoised `WaterPathFinder` from the last land tile to the landing (its shore
  coercion takes the ship off the land tile as it always took it off the port tile); **in**: the
  destination's harbour path backwards, without the harbour, ending on the port tile, where
  `complete()` pays as before. A **coastal** destination's landing is its **port tile itself**
  with no land leg, and a coastal source has no land leg out, so coastal trade sails port tile to
  port tile and completes exactly as it always did; a port with no harbour at all, or a pair with
  no shared body of space, falls back to the same port-to-port sailing. On land the ship moves one tile every
  `Config.freighterLandTicksPerTile` ticks (**2**, half speed; a wait counter, the first step one
  tick after the leg begins), in space a tile a tick. `tilesTraveled` counts every tile, so the
  payout per tile is unchanged. Coastal ships are unchanged tick for tick: six of the nine trade
  scenario snapshots are untouched and the three multi-port ones moved by a ship (port pairing
  now reads the harbour water tile rather than the port's land tile).
- **Motion plans.** One grid plan per leg (`planId` 1, 2, 3; `ticksPerStep` 2 / 1 / 2), each
  recorded on the leg's first step with `startTick` the next tick and the leg's path — no change
  to `MotionPlans.ts` or the wire: the client keeps one plan per unit and takes any newer id.
- **Captures.** `WarshipExecution.findBestTarget` skips a trade ship standing on land, and "a
  port to bring the prize to" now means a port with a harbour on the warship's body of space. A
  captured ship's `retargetToCaptorsPort` picks the captor's nearest port with such a harbour
  (anchored on the ship's tile at sea, or on the leg's harbour if ever on land), sets the new
  harbour and land path, and sails on; taken while inland of the old port it backs out to space
  first.
- **Dark Star.** The harbour search never enters the disc (§6.17) and the space leg is water, so a
  freighter only ever touches the disc's rim for a tick where the half-resolution pathfinder
  coerces it onto a coast tile (the same slack §6.15 allows destroyers). The moat is water like
  any other.
- **Tests.** `tests/Freighters.test.ts` (6): inland ports pair through their harbours and a
  harbourless port pairs with nobody; the three legs with their timing (land every 2 ticks, space
  every tick), the delivery and the equal payout; a plan per leg with `ticksPerStep` 2/1/2 and the
  inbound path ending on the port; a coastal port sails as before; a freighter on land is never a
  destroyer's target and, captured at sea, sails to the captor's inland port and pays it; beside
  the Dark Star two inland ports trade around the moat without entering the disc. The mocked
  `tests/core/executions/TradeShipExecution.test.ts` still passes on the port-to-port fallback.
- **Not yet.** Lords still judge trade partners from their coastline (`SharedWaterCache`), so a
  landlocked Lord's inland port is placed by harbour reach but its partners are not weighed;
  fine for now. Freighters draw the naval sprite on land until the names and icons (steps 4, M6).

### 6.19 As built — straight trade lanes (2026-09-26)

Step 3 of the space economy (S7). Tom wants to see the look before committing to it and may drop
it if it is not an improvement; two calls made for him to judge: lanes are true **8-connected
straight lines** (diagonals, not staircases), and a station that snaps onto a lane gets **two
straight lanes** to it rather than the old lane's kinked halves.

- **Geometry.** `straightLane(game, from, to)` (`src/core/game/TradeLane.ts`): the Bresenham line
  between the two station tiles, inclusive, or nothing. Blocked by an impassable tile, by any tile
  of the Dark Star's disc, or by a water tile that is not shoreline water (the narrow-strait rule
  the rail pathfinder always applied: a strait a tile or two wide is bridged, open space is not).
  Water counts `WATER_COST` (6) toward the length budget (`railroadMaxSize`), land 1 — the old
  pathfinder's water penalty, now a budget rather than a steer. No bent fallback.
  `RailNetworkImpl`'s path service returns it in place of the rail A\* (`PathFinding.Rail` and
  `AStar.Rail` are now unused); the ghost preview and the real connection share it. Snapping
  (`connectToExistingRails`) asks for two straight lanes, from → station and station → to, and
  keeps the old halves only where a straight one is blocked. A train in transit on a lane that is
  split this way is dropped, as the engine already drops a train whose lane was rerouted under it
  (`TrainExecution.resolveSplitRailroad`) — rare, and worth a look in play.
- **Linking, tuned by eye.** [2026-09-26, after Tom's first look] The lanes looked right but the
  network grew as chains: a new station links only to stations not already within
  `maxConnectionDistance` hops of it through lanes laid so far, and at the engine's 4 the first
  lane made the rest of its network reachable. Tried at **2** (a station skips only
  stations one or two hops away, so chains web up densely — train income two to three times the
  old in the 20-minute Lord economy snapshot, a balance note for M4 since trains pay per stop):
  too dense for Tom's eye. Now **3** (`RailNetworkImpl`): shortcuts only to stations four or
  more hops off. Tom will settle between 2 and 3 after seeing it.
- **Trains** ride the same tile lists at two tiles a tick, so along a diagonal they cover √2 more
  ground per tick than along an axis; left as is for the first look.
- **Client.** `RailroadPass` now draws **one instanced quad per lane** (`trade-lane.vert.glsl` /
  `trade-lane.frag.glsl`): a straight segment with round caps, anti-aliased in screen space,
  coloured by the owner of the tile under each fragment as the tile rails were (palette, the local
  player's rail colour, the railroad cosmetic effect), a dark rim for legibility, the bridge tint
  where it crosses water, growing in from both ends while under construction, a ghost lane at half
  strength while placing, and green where a new station would snap on. Width is a fifth of a tile
  close up and never under ~2 px. `RailroadCache.packSegments` packs every railroad as
  `SEGMENT_FLOATS` (x0, y0, x1, y1, head, tail); `FrameData.railSegments` / `railSegmentCount`
  replace `railroadState` through `uploadRailSegments` (Upload → MapRenderer → Renderer). The
  per-tile orientation texture and its sprites are gone; the cache still tracks tiles for the
  construction dust and the overlap lookup. The cosmetics preview's rail loop is four lanes.
- **Tests.** `tests/TradeLanes.test.ts` (7): the line is straight (every tile within half a tile
  of the ideal segment, 8-connected, both ends, the reverse reversed); a two-tile strait is
  crossed and a wider river blocks; water costs six of the budget; void blocks; a factory and a
  city are joined by the straight lane the preview showed; a station two tiles off a lane snaps
  on with two straight lanes; no lane crosses the disc. The rail network, train, trade and preview
  suites pass unchanged in substance (the cosmetics preview test reads the loop's lanes; the Lord
  economy snapshot moved with the new geometry).
- **Seen in the browser.** `lanes.mjs` (run-openfront): a factory and two cities on Event
  Horizon; screenshots of the lanes close, mid and far, the ghost lane, and trains riding them.

### 6.20 As built — the names (2026-09-26)

Step 4 of the space economy (S7), the last. Tom kept the straight lanes (hop threshold settled at
3 after trying 2 and 4) and committed steps 1–3.

- **Display strings only**, through the existing `translateText` keys in `resources/lang/en.json`:
  no key renamed, no enum value touched (`UnitType.Port`, `Warship`, `TradeShip` and the
  wire stay as they are, per §5.4). 54 values changed: **Spaceport** for the port (unit type,
  build menu, lobby toggle, stats, keybinds), **Destroyer** for the warship (unit type, build
  menu, chat, cosmetics, keybinds, selection help, stats), **freighter** for the trade ship
  (events, help, stats tables), **trade lane** for the railroad (factory descriptions, cosmetics,
  the graphics settings' draw-distance and thickness). Trains keep their name (F14 still open on
  the rest). The tutorial's port and warship steps now say a spaceport goes anywhere in the
  territory and a destroyer is launched into deep space near it; the no-coast step explains that
  spaceports work inland but their freighters crawl until they reach deep space.
- **Not renamed.** The "Warship Warship" map title (a map, not the unit); Lord chat lines
  ("Please let me get a coastline"); the debug effect editor's labels. Icons stay naval until
  M6.
- **Tests.** `EnJsonSorted` (keys untouched), the client and tutorial suites unchanged: nothing
  pins the display strings.

### 6.21 As built — M4 first pass: the pool, the tax, the last stand (2026-09-27)

Tom's brief: the throne regenerated far too fast — an immense bully in the mid-game, striking at
will with nothing at risk — so cut its regeneration to about a tenth, raise the pool only somewhat,
build the last stand, and treat every number as a lever for later. His answers to the six
questions: a **flat** refill rather than the engine's curve (an anti-exploit: a curve that crawls near
empty lets a throne bled dry — by design or in collusion with an invader — be kept down by a
slow-rolled invasion; a flat refill should sit well below a half-map challenger's best regeneration
and well above an emptied one's, so a slow roll is the losing choice); ceiling **125%**; the last stand
as proposed, **no button** for a human Hegemon (recall and counter-attack already exist by hand); the
shadow tax in; the leveller's bar down to **75%** (it need not strike at full strength, but never
below three quarters — punitive strikes are how it engages the galaxy without spending its own
troops); and, a bonus, **Lords must stop nuking the Dark Star**.

- **The pool (H4).** `troopIncreaseRate` for a Hegemon is `hegemonTroopsPerTick()` = the ceiling ÷
  (`refillMinutes` × 600), the same every tick, capped at the ceiling; `regenPercent` is gone.
  `troopCeilingPercentOfWholeMapCap` 100 → **125** (Milky Way 4.99M → 6.23M, Event Horizon 5.03M →
  6.29M). At 20 minutes that is ~312k a minute on Milky Way, against ~3.5M a minute at the old
  half-full peak: a full strike is now a commitment for the rest of the round.
- **The shadow tax (H4).** `goldAdditionRate` is 0 for a Hegemon; `HegemonExecution.collectShadowTax`
  runs every tick, sums every other player's lifetime `goldEarned()` (`allPlayers`, so a challenger's
  death changes nothing), and pays the throne `hegemonShadowTax(delta)` = `shadowTaxPercent` (**3**)
  of what they all earned since the last tick — workers, trade, trains, piracy and conquest gold
  alike (conquest and donations are transfers, so the tax counts them twice; accepted). Recorded as
  `goldWork` for the leaderboard. The 100/tick-per-50k-tiles placeholder and `hegemonGoldPerTick` are
  gone. Tried at 10% first: the throne banked 50–60M by the end of a round and out-earned the richest
  challenger; at 3% it earns about a mid-table challenger's income — on Milky Way ~0.4M/min at
  minute 5, ~1M at 10, ~1–2.5M by 19, 12–18M banked over a round (the placeholder gave 0.53M/min
  flat, 10.6M a round). The AI throne spends none of it yet (destroyers and gifts are M5+ for the AI).
- **The last stand.** In `respondToInvasion`, AI Hegemon only: once the invader's `domainTilesHeld()`
  reaches `lastStandDomainLostPercent` (**40**) of the domain, `lastStand` latches until the invader
  is evicted; every second it sends everything above `lastStandReservePercent` (**5**) of the ceiling
  after the invader (`AttackExecution` merges it into the standing counter-attack), in place of the
  20% waves and H13's surplus routing, which it subsumes. The leveller strike needs no extra recall:
  `punish` already recalls it on any landing; punitive strikes cannot be recalled (H19). A human
  Hegemon gets nothing automatic beyond H13, as decided.
- **The leveller (H11).** `levellerFullPercent` 95 → **75**. In AI-only rounds it now fires 2–5
  leveller strikes a round beside 4–10 punitive ones.
- **No nukes at the Dark Star.** `NationNukeBehavior.findBestNukeTarget` passes over a Hegemon at
  every rule (the two-player rule, retaliation, the dense target, the crown, an ally's targets, the
  most hated, the FFA crown, the strongest team) and keeps searching, so a Lord under a strike still
  nukes its hostile neighbour. Human players may still waste a warhead on the disc (H7).
- **`HegemonSim`.** Prints the refill and tax share in its header, the throne's gold and income a
  minute and the challengers' combined income in the minute lines, and a `last stand @m.mm` line
  when the threshold is crossed. Fixed: `--loss/--slow/--ceiling` are applied only when given, so they
  no longer undo a `--set` of the same tunable (the first sweep's ceiling rows silently ran at the
  default).
- **Tests.** `HegemonStrength` (the flat rate at any fill, below a half-map challenger's peak and
  above an emptied one's; the shadow tax on a challenger's income, nothing deducted),
  `HegemonInvasion` "The last stand" (all in at 40%, a donation follows within a second; a smaller
  foothold gets the waves; a human throne is left alone), `NationNukeHegemon` (the two-player rule and
  retaliation/most-hated both pass over the throne and find the rival). `Stargate`'s enclave test
  fires 80k instead of 50k (the 25% stronger throne burned the smaller shot out inside two seconds).
  `ClientGameRunnerActions`' mock player gained `isHegemon` (a pre-existing failure since the
  punitive-strike click code). `UpdateRegister` / `UpdateFlagLatest` fail on this machine with or
  without these changes (shell-script tests).

**Measured (AI-only, 20 min, medium, 3 seeds × Milky Way + Event Horizon).** Baseline before the
change: **0 of 6** overthrown, the throne never below 1.7M troops, 10–15 strikes a round burning
11–20M troops. After: the AI throne spends its pool in the first two minutes of an invasion through
its 20% waves and the fight is then a grind against the fortress with the refill trickling in; the
last stand therefore triggers late (minute 12–19, the throne already at 130–600k) and matters mostly
when an invasion advances faster than the waves drain the pool. Lords that reach the last 1–7% of
the domain sometimes stall there and the throne wins on the timer (a Lord pushes only what is above
its 20% reserve; the fortress triples its losses).

| Setting (refill, ceiling)  | Overthrows | Milky Way | Event Horizon | Notes                                                 |
| -------------------------- | ---------- | --------- | ------------- | ----------------------------------------------------- |
| 10 min, 125% (~625k/min)   | 3 of 6     | 1 of 3    | 2 of 3        | The throne refills to full twice on Milky Way b and c |
| **20 min, 125% (default)** | 3 of 6     | 2 of 3    | 1 of 3        | The two holds end at 7% and 23% of the domain         |
| 40 min, 125% (~155k/min)   | 3 of 6     | 1 of 3    | 2 of 3        | Troops low 90–210k                                    |
| 20 min, 100% (~250k/min)   | 2 of 6     | 2 of 3    | 0 of 3        | Event Horizon holds end at 23–51% of the domain       |
| 20 min, 150% (~374k/min)   | 4 of 6     | 2 of 3    | 2 of 3        | Bigger waves and strikes burn more; not less fragile  |

Neither lever moves the AI-only outcome much at six rounds a setting (the waves, not the refill,
decide how much the throne has when it matters, and a bigger pool only feeds bigger waves), and all
five settings land in or beside the target band, so the choice is feel: **20 minutes / 125%** is the default and Tom's
"about a tenth"; **10 minutes** is the forgiving alternative (a throne that strikes at minute 5 is
full again by 15) and **40** the harsh one. To playtest from the throne: whether a strike now feels
like a commitment; whether the refill reads on the panel; whether 3% is the right gold for gifts and
destroyers; and whether an AI throne at 75% strikes too often. Untouched, for after: the AI's strike
thresholds beyond the 75% bar, the gate numbers (F15), the train-income note (§6.19).

### 6.22 As built — P0: the throne in a private lobby, and succession by hand (2026-09-27)

The first phase of `docs/DarkStar-Roadmap.md`. Before it, multiplayer had no human Hegemon at all:
the seat was set only by the singleplayer modal. Tom's decisions: the **lobby creator seats the
Hegemon**; a human Hegemon who leaves mid-round is simply absent (no AI or player swaps in — the
round goes on with H13 the disc's only defence; "tough for the Hegemon"); an **AI killing blow leaves
the seat unclaimed** next round (the creator may seat anyone, else the AI holds it), and an AI
Hegemon's timer win leaves it open again.

- **The seat on the wire.** `HegemonConfigSchema` gains `seat` (a clientID; absent = the AI, R6).
  `hegemon` joins `ConfigPatch`'s copied keys so `update_game_config` can set it. At `start()` the
  server flags `isHegemon` on the seated client and nobody else — FFA only, and a seat for a client
  no longer present is ignored (`tests/server/HegemonSeat.test.ts`). `GameImpl.seatHegemon` then
  seats that player exactly as the singleplayer path does; the throne's HUD, the opening and the
  spawn phase needed no change (verified in the browser with two clients).
- **The host view.** `HostLobbyModal`: a **Dark Star (Hegemon)** toggle in the options (FFA only;
  turning it on gives the lobby the default 20-minute round, as the singleplayer modal does; MIRV and
  SAM leave the unit menu; team mode turns it off), and on the roster a **crown on every player**
  that seats or unseats them, with a **(Hegemon)** badge on whoever holds it (`LobbyPlayerView`,
  `hegemonSeat` / `onSeatHegemon`). Joiners see the badge and a "Dark Star (Hegemon): name / AI
  Hegemon" card in the join view. The seat is the server's to change under the host: the modal
  adopts it from every lobby info.
- **Succession by hand.** "New Lobby" from the win screen (`create_game?previous=`) now makes a
  successor that **inherits the round's settings** (`SuccessorLobby.successorConfig`: everything but
  the old lobby's name reveals and seat) and carries the round's **winner as heir**
  (`GameServer.winnerPersistentID()` from the winner vote; a Lord's win — the AI Hegemon on the
  timer, or an AI slayer — names nobody). The heir is **seated as they arrive** (`seatHeir`, on
  join, unless the creator has already seated someone or the throne is off), and a seated player who
  leaves is **unseated** in the next lobby info (`reconcileHegemonSeat`; a returning heir is seated
  again). The host modal re-attaching to the successor (`?host`) **hydrates its form from the
  lobby's config** (`applyConfig`, the inverse of `putGameConfig`) instead of showing defaults that
  the first click would have pushed over the inherited settings.
- **Tests.** `HegemonSeat` (3), `SuccessorLobby` (7: the inherited config, the winner's identity, heir
  seating, no displacement, throne off, unseating and re-seating), `ConfigPatch` gains the key.
  Browser scripts `.claude/skills/run-openfront/throne-lobby.mjs` (host + joiner, seat, start: the
  joiner is the human Hegemon with the full pool) and `throne-successor.mjs` (a 1-minute round on
  Event Horizon won by the throne on the timer; New Lobby; the successor shows Event Horizon / 30
  Barons / throne / 1 min, and the winner hops over already seated).
- **After Tom's first lobby round (same day).** Three changes. (1) **The throne is always on** —
  it is the game, not a feature: the Dark Star toggle is gone from the host and singleplayer
  modals, `ConfigPatch` forces `hegemon.enabled` true whatever a patch says (only the seat is the
  host's), `GameManager` creates every private lobby with the throne and a 20-minute timer, and
  public FFA games get it too (`MapPlaylist`; the AI holds it until P6). The sim still honours the
  flag, so tests without a throne are unaffected. (2) **The seat control was invisible** because it
  hid behind that toggle; now the roster always shows, in FFA, a line reading "The AI holds the
  throne" or "name holds the throne" with, for the creator, "click a player's crown to seat them",
  and the crowns are larger and brighter. (3) **A random map stays "Random" for everyone until the
  game starts**: before, the host's client rolled the map at selection and sent the pick, so guests
  saw the map while the host saw "Random". Now `GameConfig.randomMap` travels with the lobby, the
  join view shows "Random" with the random-map card, the client skips the terrain preload, and
  `GameServer.prestart()` makes the pick and announces it in the prestart message (a successor lobby
  inherits the flag, not the old pick). `tests/server/ThroneAlwaysOn.test.ts` (4).
- **Seen, left for later.** OpenFront's tutorial popup talks to a Hegemon about picking a spawn
  spot (P8 rewrites the tutorial). The Dark Star panel's text is empty in the first seconds of a
  round. A seat change can flicker for up to a second if a stale lobby info lands between the
  host's click and the server's next broadcast.

### 6.23 As built — missiles on gates, shield arrays, the throne's warheads (2026-09-28)

Tom's direction: missiles were too oppressive with SAMs gone, gates too easy to ignore; fold the
silo into the gate so a warhead reaches only as far as a gate does, add a small defensive
structure that refuses missiles instead of shooting them down, and let the throne fire missiles at
the same price. Rules in C4 (revised), C5, H2 (revised), H19 (revised), S6; numbers open in F21.

- **The silo is off** under a Dark Star: `Config.isUnitDisabled(MissileSilo)` is true whenever the
  Hegemon round is on (the S6 pattern; the enum value stays). The lobby modals hide its row with
  the MIRV's and the SAM's. Outside Hegemon mode the engine is untouched: `nukeSpawn` still takes
  a silo.
- **A stargate launches missiles.** `MissileLaunchers` (`Game.ts`: silo and gate) names what a
  missile may fly from. `PlayerImpl.nukeSpawn` picks the nearest (Manhattan) ready launcher: a silo
  with a free tube, or a gate with an **empty timer queue** and the target within
  `stargateRange(level)` (a gate holds one charge whatever its level — `isInCooldown`'s tube count
  is silo semantics, so the queue is read directly). `NukeExecution`, `MIRVExecution`, the punitive
  lookups (`RazeExecution.flaggedSiloNear`, the flag clearing, `HegemonExecution.punishLaunches`)
  and `HegemonSim` walk the launcher group instead of silos, so the **flag lands on the gate** and
  the gate's `launch()` starts the 60 s reload `StargateExecution` already runs. `AiAttackBehavior`'s
  "nuked territory" check and the Lords' save-up logic (`NationStructureBehavior.
missileLaunchersEnabled`) count a gate as a launcher; `NationNukeBehavior.maybeSendNuke` asks
  for launchers and lets `canBuild` enforce the range; the tile score values a gate as it did a
  silo.
- **The shield array**: `UnitType.ShieldArray` (appended), in `Structures`; `SHIELD_ARRAY_DEFAULTS`
  in `Config.ts` (radius 35, 1M, 10 s, no `upgradable`); a passive structure (`ConstructionExecution`
  builds it, no execution). `PlayerImpl.missileShieldAt(tile)` finds another player's built array
  covering the tile through the unit grid; `nukeSpawn` refuses when one exists, **unless the player
  is the Hegemon**. Strikes never ask. [Superseded 2026-09-29, §6.24: the launch gate is gone; the
  shield is applied to the blast instead.]
- **The throne's missiles.** `canBuildUnitType` no longer refuses the Hegemon a warhead (still the
  MIRV); `nukeSpawn` returns the Dark Star's centre for the Hegemon before any shield or launcher
  check, so a captured gate's charge is never spent and no flag is raised (`NukeExecution` already
  skipped the Hegemon). `GameRunner.throneBuildables` merges the throne's own warhead rows into the
  host's gift list on a challenger's tile, so the radial's attack slot offers them where structures
  stay gifts (H18).
- **Client.** `UT_SHIELD_ARRAY` (structure set, atlas column 7, `ShieldArrayIconWhite.svg`, diamond
  SDF, a cyan point light); the build menu and hotbar row (the silo's slot and key 5 when silos are
  off, like the gate on the SAM's 6; `buildShieldArray` keybind); a ghost range ring of the radius;
  the SAM ring pass draws **shield perimeters** (one static spinning ring per array) whenever a
  missile, a gate or an array is being placed. The nuke arc preview mirrors the new `nukeSpawn`
  (gates in range, the centre for the throne); `readyMissileCount` counts a gate as one tube and
  the throne as unlimited; the reload bar and `UnitView.missileReadinesss` show a gate's 60 s;
  the badge hit-test walks launchers. The ghost's click on a challenger's tile sends a **gift only
  for a structure** (`isGiftUnit`); a warhead goes down the ordinary build path (found in Tom's
  first playtest: the hotbar's warhead was silently refused as a gift while the radial worked).
  Strings: `unit_type.shield_array`,
  `build_menu.desc.shield_array`, `help_modal.build_shield_array_desc`, `user_setting.
build_shield_array*`; the warhead help text and the gate's description say where a missile comes
  from and that a shield keeps it out.
- **Tests.** `tests/StargateMissiles.test.ts` (16): silos off; range, upgrades and nearest-ready
  choice; the shared charge and reload; the flag on the gate; the throne's centre launch, price,
  flight, intent path, build list and captured-gate rule. `tests/ShieldArray.test.ts` (11): cost,
  one level, the radius cap, no throne or Dark Star array; refusal inside and on the rim, a refused
  launch, the owner's exemption, the throne's missile and strike passing, capture, gate shots
  landing, no protection under construction. `PunitiveStrikes`, `HegemonToolkit` and `HegemonWin`
  build gates where they built silos.
- **Seen, left for later (F21).** Lords build no shield arrays; the AI Hegemon fires no missiles;
  the tutorial's silo steps are skipped (silos off) rather than rewritten (P8).

### 6.24 As built — shield arrays shelter the blast, not the launch (2026-09-29)

Tom's revision: rather than refusing a launch, an array should keep a missile's damage off the
zone it protects — the blast clears its circle as usual, the inside excepted — and the throne's
missiles should be kept out like anyone else's; the price rises to 5M. Rules in C5 (revised) and
H2 (revised); the price stays open in F21.

- **The engine already had the shape.** `NukeExecution.detonate` skipped Dark Star tiles (H7) in
  its destroy loop; the shield is the same `continue`. The blast set (`tilesToDestroy`) is
  unchanged — a full circle, computed as before — so the far side of an array is still hit; the
  skip happens per tile at impact. Because troop deaths are counted from the tiles actually taken,
  sheltered tiles cost no troops without further code; the water conversion and the crater
  (`queueNukeImpact`) are skipped with the tile, so the client's nukeable layer shows the hole.
  The structure sweep at the end of `detonate` skips sheltered units the same way — the array
  sits inside its own zone and survives its own blast. MIRV warheads run the same execution.
- **`missileShieldsNear(game, attackerSmallId, tile, outer)`** (`execution/Util.ts`) gathers once,
  through the unit grid, every other player's built array within `outer + radius` of the impact as
  a `ShieldZone` (centre and squared radius); `inMissileShield(gm, zones, tile)` is the per-tile
  test (the rim counts as inside, like the grid's own range test). Read at launch for the alliance
  check and again at impact, so an array raised or lost in flight counts as it stands when the
  blast lands. It takes `Game | GameView`, so the client's preview uses it too. `PlayerImpl.
missileShieldAt` and the gate in `nukeSpawn` are gone: a warhead may be aimed anywhere.
- **The throne.** `nukeSpawn` still returns the Dark Star's centre for the Hegemon; nothing else
  is special. The throne owns no array, so every array shelters against its warheads.
- **Alliances.** `listNukeBreakAlliance`, `wouldNukeBreakAlliance` and `computeNukeBlastCounts`
  take optional `shields`: sheltered tiles and structures count for nobody, so a blast kept wholly
  off an ally angers no one. `NukeExecution.maybeBreakAlliances` passes them; the client's SAM
  preview and the fresh-ally safety check (`BuildPreviewController`) pass the same, so what the
  preview flags is what the sim will do.
- **Lords.** `NationNukeBehavior.nukeTileScore` values a structure inside another player's array
  at nothing, so a Lord does not spend a warhead on a sheltered city. Lords still build no
  arrays (F21).
- **Cost.** `SHIELD_ARRAY_DEFAULTS.costGold` 1M → 5M.
- **Client.** Nothing structural: the ring and ghost preview are unchanged and the crater follows
  the sim. The explosion sprite still draws a full circle over the hole (cosmetic; F21 asks whether
  it reads). Strings reworded: `build_menu.desc.shield_array`, `help_modal.build_shield_array_desc`,
  and the two warhead help texts.
- **Tests.** `tests/ShieldArray.test.ts` (15, rewritten) runs under a `BlastConfig` with the game's
  real radii (TestConfig shrinks every blast to one tile) and a 60×120 western block so a circle
  has land outside the zone: cost 5M, one level, the radius cap, no throne or Dark Star array; a
  launch aimed inside is allowed; a hydrogen bomb on an array clears outside the rim and nothing
  inside, every tile within the inner radius but outside the zone gone; an atom bomb on the array
  does nothing (tiles, troops, array, a sheltered city); a sheltered city stands while an exposed
  one falls; the owner's own missile is not kept out; the throne's is; strikes pass; a captured
  array (the ground conquered under it) shelters its captor against its old owner; gate shots land;
  the alliance list ignores a sheltered player and not an exposed one; an array under construction
  protects nothing and a finished one shelters from the tick it stands.

### 6.25 As built — reinforcing the throne (2026-10-04)

Tom's call (2026-10-04): the H9 shelf item "challengers donating to the Hegemon" is opened. Any
player may donate troops to the Hegemon while its pool has room, and while someone holds the Dark
Star every troop donated goes straight into the counter-attack against them. Why: a round can
deadlock — an invader takes most of the domain and exhausts the throne, but loses its land beyond
the moat, so its troop cap collapses (H5) and neither side can move. Donations from the other
challengers break it, finish the failed invasion and free the slot; they are also how rivals compete
for the throne by proxy.

- **The rule (`PlayerImpl.canDonateTroops`).** A Hegemon recipient is open to every living player:
  no alliance needed, the lobby's `donateTroops` toggle ignored (it gates human recipients, and
  Hegemon rounds run with it off, so a human throne would otherwise be unreachable). Refused while
  the pool is at its ceiling (`maxTroops`), so the HUD's Troops button vanishes from the throne's
  panel while it is full; the order clamps to the room left, as the engine always has. The
  per-recipient cooldown (10 s) applies. Gold to or from the throne stays closed. Nothing changes
  between challengers (allies only, toggle on).
- **Routing (`DonateTroopsExecution`).** After the transfer, if the recipient is the Hegemon and
  `darkStarInvader()` is not null, the order adds an `AttackExecution` from the Hegemon against the
  invader for exactly the troops that landed. The attack starts — and takes the troops back out of
  the pool — at the end of the same tick, so H13's stall pin never sees them and nothing is sent
  twice (verified tick by tick: the pool runs identically with and without the donation, the
  standing attack gains the donation at the tick the attack starts). The engine merges it into the
  standing counter-attack. Stalled or not, AI or human throne: donated troops fight at once. With no
  invader they join the pool. `HegemonExecution` is untouched.
- **Not done.** The invader may donate to the throne (its troops would be thrown back at it;
  harmless, not worth a rule). No AI donor: Lords only donate to teammates in team games, and the
  throne is on no team. Donations to the invader stay shelved. An event line when a donation lands
  in the counter-attack, if the playtest wants it.
- **The control (same day, Tom's ask: the panel's Troops button was buried).** Right-clicking the
  Dark Star as a challenger, the radial menu's **ally slot** — useless there, the throne allies
  with nobody — is **Reinforce the throne** (`reinforceThroneElement`, `RadialMenuElements.ts`):
  the donate-troops icon in the ally green, sending troops sized by the attack-ratio slider exactly
  as the team-mode centre button does, clamped to the room on the throne. Its tooltip shows the
  amount, the room left ("The throne is full" when none), a wait line while `canDonateTroops` is
  false with room left (cooldown), and either "{invader} is invading: your troops join the
  counter-attack at once" or that they join the pool. Greyed out in the spawn phase, while the
  throne is full or on cooldown, or with nothing to send. The player panel's Troops button and the
  send-troops modal (which already caps at the recipient's room) remain the precise route. The
  help modal's radial list gained a line. Checked in the browser on Event Horizon
  (`.claude/skills/run-openfront/reinforce.mjs`): the slot, the icon, the greyed state and the
  tooltip against a full AI throne.
- **Tests.** `HegemonToolkit` "Anyone reinforces the throne (H9)" (4): open to any challenger while
  there is room, refused when full (the pool starts full); without an invader the troops join the
  pool up to the ceiling and the cooldown applies; with an invader the donation becomes an attack of
  exactly that size and the pool is untouched, and the invader is evicted; the deadlock — east
  holding the eastern half of the domain with no land outside and no troops, the throne at zero,
  nothing moving for 50 ticks, no `HegemonExecution` — is broken by a 150k donation from west inside
  600 ticks, the domain whole again and the slot free. `HegemonInvasion` H13: a donation to a
  stalled throne is sent once and the pool is not drained below its pin.

### 6.26 As built — hovering a gate or a shield shows its footprint (2026-10-09)

Tom's call (2026-10-09): resting the cursor on a stargate or a shield array draws the area it
covers, so a player can read a gate's reach and the ground a dome protects without opening the
build menu. Any owner's structure counts: an enemy shield shows where a warhead cannot hurt, an
enemy gate what it can hit; structures under construction show what they will cover.

- **The disc (`RangeCirclePass.setHoverRange`).** The same translucent disc with a one-tile rim as
  the placement and aim rings, in the aim ring's blue for a gate (`stargateRange(level)`) and a
  soft green for a shield (`shieldArrayRadius()`), drawn after both so it never hides them. Pushed
  through `MapRenderer.updateHoverRange`.
- **The controller (`StructureRangeHoverController`).** Listens to `MouseMoveEvent` like
  `HoverHighlightController`, hit-tests with `nearbyUnits` against the structure sprite's
  on-screen half size (`structureHitRadius` mirrors `structure.vert.glsl`, floor two tiles), takes
  the nearest active gate or shield, and pushes only on change. Its `tick` re-checks the hovered
  structure so an upgrade grows the disc and a destroyed one clears it. Checked in the browser on a
  solo game at three zooms, down to the dot-sized gate.
- **Tests.** `tests/client/controllers/StructureRangeHoverController.test.ts`: the hit radius at
  each zoom band; a gate hovered off-centre, held, and left; a shield in its colour; a city and an
  off-map tile ignored; an upgrade and a deletion caught by `tick`.

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
- **`proprietary/`: removed (2026-09-27, roadmap P1 step A).** OpenFront's logos, `OpenFront.ttf`,
  favicon and music are out of the repository and the build. Our own marks live in **`branding/`**
  (© January Games, All Rights Reserved, `branding/LICENSE`), which overrides `resources/` through
  the same build mechanism; a modified version must replace it. Holds the Dark Star favicon and,
  since 2026-10-04, the January Games studio wordmark (dark and light variants) shown in the
  footer; the game's own logo, title treatment and font are still open (roadmap P1 step E).
- **Stripped (P1 step A):** ads/analytics, the CrazyGames SDK, the Steam wishlist, OpenFront's
  Discord/wiki/reddit links, OpenFront's legal pages and press kit, `index.html` canonical/OpenGraph
  tags, PWA manifest and `package.json` name. The footer carries "Source", "Made by January Games"
  and "© OpenFront and Contributors". The closed-API UI (step B), the strings and server names (C) and the
  Steam/CrazyGames platform layer (D) went the same day — see `docs/DarkStar-Roadmap.md` P1 for
  what each removed and what stays on purpose.

## 9. Roadmap [Proposed]

Renumbered 2026-09-24 after Tom's design review. M1–M4 are built (M4 as a first pass). **From here the
road to release is `docs/DarkStar-Roadmap.md`** (2026-09-27, phases P0–P8: private-lobby succession,
the strip-down and rebrand, deep-space visuals, the map pool, audio, identity and the minimal backend,
public thrones, the store, release); M5–M9 below are kept as the earlier sketch it replaces.

| Milestone | Goal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Status                                                                                                                                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1**    | Hegemon core in the sim, with tests: role flag, central domain (H1–H3), map-scaled strength decoupled from tiles (H4–H5), single-invader rule (H6–H7), razing strikes with tyranny and the bubble (H8, H16, H17), no alliances (H9), win logic (R1–R5), the AI Hegemon (H11), Lords that go for the throne, playing the Hegemon in singleplayer.                                                                                                                                                                        | **Built** (§6.1–§6.7). Donations moved to M3, the last stand and calibration to M4, the private-lobby toggle to M5.                                                                                                                                                                 |
| **M1.5**  | Challenger systems: atlas tooling → the strike as a projectile → stargates (C4) → AI gates.                                                                                                                                                                                                                                                                                                                                                                                                                             | **Built** (§6.9–§6.11). Build-menu growth and raids dropped (C2, §6.8 stage 4); warships moved to M3.                                                                                                                                                                               |
| **M2**    | Event Horizon, the first galaxy map with its `info.json` Dark Star; the launch-from-the-core opening (C3); HUD: Hegemon marker, Dark Star panel, victory screens.                                                                                                                                                                                                                                                                                                                                                       | **Built** (§6.12, §6.3, §6.7). Awaiting Tom's playtest — the checks are F19.                                                                                                                                                                                                        |
| **M3**    | **The throne's toolkit and the 2026-09-24 rules review.** Nothing buildable on the Dark Star by anyone (H2); the invasion cooldown removed (H12); the Hegemon donates troops (H9); gifted structures on challengers' land (H18); destroyers spawning in the moat (H10); MIRVs off and the warhead renames (S6); the player table gains the Dark Star's fields for the throne and the separate Dark Star panel goes if the table carries it (F19). Small, mostly-sim pieces first (H2, H12, H9, S6), then H18, then H10. | **In progress** — chunk 1 (H2, H12, H9, S6) built 2026-09-25, §6.13; chunk 2 (H18 gifts) built 2026-09-25, §6.14; chunk 3 (H10 destroyers) built 2026-09-25, §6.15; the HUD merge tried and dropped the same day (F19: the panel stays, its board collapsed by default). **Built.** |
| **M3.5**  | **Punitive strikes (H19).** The silo flag written at launch, the galaxy's levy, the radius-capped strike with its halt-then-pop ending, the Hegemon's badge and click, the AI Hegemon's rule, no nukes from a captured silo; tests and a `HegemonSim` line per punitive strike.                                                                                                                                                                                                                                         | **Built** 2026-09-26 (§6.16) on `feat/hegemon-toolkit`; awaiting Tom's playtest. Before M4 because the levy moves the invasion curve (F20).                                                                                                                                         |
| **M3.6**  | **The space economy (S7, revised 2026-09-26).** Spaceports anywhere with harbours, destroyers launched from them; freighters overland at half speed on three legs; straight trade lanes in the sim; the freighter / spaceport / Destroyer names.                                                                                                                                                                                                                                                                        | **In progress** — step 1 (spaceports, harbours, destroyers) built 2026-09-26, §6.17.                                                                                                                                                                                                |
| **M4**    | **Balance (F1).** Regeneration cut, ceiling raised as needed, the shadow tax, the AI's last stand; `HegemonSim` sweep on Event Horizon and Milky Way, three candidates, Tom playtests; then retune the AI's strike thresholds (H11) and check the gate numbers (F15).                                                                                                                                                                                                                                                   | **First pass built** 2026-09-27 (§6.21): flat refill over 20 min, ceiling 125%, 3% shadow tax, the last stand, leveller at 75%, no AI nukes at the Dark Star; 3 of 6 AI-only rounds overthrown. Awaiting Tom's playtest; H11's other thresholds and F15 after.                      |
| **M5**    | **Succession.** Singleplayer throne persistence (beat the AI, defend the throne next round), then the private-lobby hand-off through the successor-lobby flow with config inheritance; the private-lobby Hegemon toggle. The first item that makes the round loop real (§1).                                                                                                                                                                                                                                            |                                                                                                                                                                                                                                                                                     |
| **M6**    | **Sci-fi re-theme and the economy's look.** Icons for the spaceport, freighter and Destroyer (their names and the straight lanes moved to M3.6); the remaining unit, structure and resource names (F14); palette/theme JSON; atlases and own art for the projectile and the gate.                                                                                                                                                                                                                                       |                                                                                                                                                                                                                                                                                     |
| **M7**    | **The map library (S9, F17).** 10–20 galaxy maps from the generator and by hand; remove the old maps map by map; per-map palette and thumbnails (§5.3 gap); decide the exclave question on galaxy maps (F18).                                                                                                                                                                                                                                                                                                           |                                                                                                                                                                                                                                                                                     |
| **M8**    | **Release hygiene.** §8 cleanup (proprietary assets, ads, links); the splash page and main menu rebuilt for DarkStar with attribution (S10); sound effects verified and a legal soundtrack (S8); remove or stub API-dependent features; local game archive.                                                                                                                                                                                                                                                             |                                                                                                                                                                                                                                                                                     |
| **M9**    | **Public lobbies** with a persistent Hegemon (own persistence + identity); Hegemon high scores (S5, F13).                                                                                                                                                                                                                                                                                                                                                                                                               |                                                                                                                                                                                                                                                                                     |

Considered and set aside, not scheduled: multiple invaders at once (F16), donations to the invader
(H9; donations _to the Hegemon_ were opened 2026-10-04, §6.25), gold donations from the throne (H9),
hydrogen-bomb removal (closed by S6).

## 10. Glossary

| Term                          | Meaning                                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hegemon**                   | The asymmetric ruler role: starts dominant, cannot expand. One per round. Human or AI.                                                                                                             |
| **Challenger**                | Any non-Hegemon player.                                                                                                                                                                            |
| **Dark Star / Domain**        | The central black-hole region: the Hegemon's territory, the only tiles it may ever own.                                                                                                            |
| **Invader**                   | The single challenger currently allowed to attack the domain.                                                                                                                                      |
| **Raze / Strike**             | The Hegemon's attack: land it takes returns to neutral instead of being claimed (challenger raids were dropped).                                                                                   |
| **Gift**                      | A structure the Hegemon builds on a challenger's land at its own cost; the host owns it and cannot refuse (H18).                                                                                   |
| **Shadow tax**                | The Hegemon's gold income: a share of the challengers' combined income, deducted from nobody (H4).                                                                                                 |
| **Destroyer**                 | The engine's warship, a deep-space unit; a challenger's is launched from a spaceport's harbour, the Hegemon's spawn in the moat, portless and purely defensive (H10, S7).                          |
| **Spaceport**                 | The engine's port, placed anywhere like a city; its **harbour** is the nearest deep space reachable over land, where freighters put to space and destroyers are launched and repaired (S7, §6.17). |
| **Freighter**                 | The engine's trade ship; travels overland to and from a harbour at half speed (S7).                                                                                                                |
| **Trade lane**                | A railroad drawn and ridden as a straight line between two stations (S7).                                                                                                                          |
| **Stargate**                  | A challenger structure that fires a troop-carrying projectile at any tile in range; it lands as a beachhead (C4).                                                                                  |
| **Shield Array**              | A challenger structure whose 35-tile perimeter no missile can harm the inside of, the throne's included; the blast clears the rest of its circle; strikes pass through (C5).                       |
| **Projectile**                | The shared flight — a unit on a nuke-style arc with a motion plan — used by strikes, gate shots and the opening.                                                                                   |
| **Tyranny**                   | The cost penalty on striking a small player; at the floor they cannot be struck at all.                                                                                                            |
| **Bubble**                    | The land a strike holds while it lasts; fought over by the struck player, pops to neutral.                                                                                                         |
| **Overthrow**                 | Eliminating the Hegemon (zero tiles).                                                                                                                                                              |
| **Killing blow**              | The conquest that eliminates the Hegemon; its owner wins the round.                                                                                                                                |
| **Round / Reign**             | One game / the consecutive rounds a player holds the throne.                                                                                                                                       |
| **Baron**                     | Player-facing name for a simple bot (`PlayerType.Bot`; "Tribe" in the code).                                                                                                                       |
| **Fleet**                     | Player-facing name for the transport ship (`UnitType.TransportShip`; the `boat` intent): troops crossing deep space without a gate.                                                                |
| **Lord**                      | Player-facing name for the smarter, map-defined AI (`PlayerType.Nation`; "Nation" in the code).                                                                                                    |
| **Intent / Turn / Execution** | Player action → server-bundled tick of intents → deterministic sim object that applies it.                                                                                                         |

## 11. Changelog

- **2026-10-09** — **The Hegemon's name stays home.** `placeName` pins the throne's name and troop
  count to the Dark Star's centre; a strike's bubble that outgrew the domain used to drag it out
  there, since the name follows the largest cluster by tile count. `tests/HegemonName.test.ts`.
- **2026-10-09** — **Fleets and the stargate menu.** Boats are **fleets** in all player-facing
  text, with a star-fighter icon (`FleetIconWhite.svg`); the radial menu's attack slot wears the
  stargate and the gate shot inside it the sword (the centre button keeps the sword for the ground
  attack). §1 and the glossary.
- **2026-10-09** — **Hover footprints.** Resting the cursor on a stargate or a shield array draws
  the area it covers, any owner's; §6.26.
- **2026-10-07** — **Nomenclature:** Nations are **Lords** and Tribes are **Barons** in all
  player-facing text and the docs (a feudal galaxy with the Hegemon at its head); code identifiers
  unchanged. §1, §5.1 and the glossary carry the mapping.
- **2026-09-20** — Document created from the initial design Q&A; roadmap proposed.
- **2026-09-26** — **Stargate range raised (C4/F15).** Tom judged the range slightly underperforming: base
  range +50% (120 → 180) and the per-upgrade step +25% (60 → 75), so levels 1–5 now reach
  180 / 255 / 330 / 405 / 480 tiles. `STARGATE_DEFAULTS` and `tests/Stargate.test.ts` updated.
- **2026-09-26** — **Stargate on the quick-build hotbar.** The gate was radial-menu only; it now sits on
  the bottom hotbar (`UnitDisplay`) in the SAM's slot with the SAM's key (**6**, rebindable as
  `buildStargate`), since SAMs are off under a Dark Star (S6). In a vanilla game the SAM keeps the key
  and the gate tile is click-only; a disabled unit never claims a build key.
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
- **2026-09-24** — **Design review with Tom; the doc cleaned up.** Stale items retired (§1's "rename
  only" line, F2/F5/F6/F8/F9/F11 closed, §6.8 stage 4 dropped, the M1 slice table folded into §9) and
  his ten points recorded. **Decided:** challenger raids dropped (C2, F6); **nothing is buildable on the
  Dark Star** by anyone (H2 — also closes F8: a Hegemon silo was a raze that skipped tyranny and the
  bubble); the Hegemon builds **gifts** — any structure type, on any challenger's land, owned by the
  host, who cannot refuse (H18); **destroyers** spawn portless in the moat, defensive only (H10);
  **regeneration to be cut severely**, ceiling raised as needed, gold as a **shadow tax** on the
  challengers' combined income (H4, F1 direction); the Hegemon **donates troops** to anyone, gold
  donations and donations to the throne shelved (H9, F9); the **5-minute invasion cooldown removed**
  (H12); H13 unchanged; the Dark Star's fields move into the top-left player table (F19); **MIRVs
  removed**, Atom Bomb → Nuclear Warhead, Hydrogen Bomb → Antimatter Warhead (S6); rails drawn straight,
  never over deep space, "Destroyer" kept, spaceport (S7); audio deferred to release with a note (S8);
  a 10–20 map library replacing most existing maps (S9, F17); splash page rebuilt before release (S10).
  **Open:** multiple invaders (F16), the map-by-map cull (F17), exclaves on galaxy maps (F18), the
  playtest checks (F19). Roadmap renumbered M1–M9 (§9): M3 toolkit → M4 balance → M5 succession → M6
  theme → M7 maps → M8 release → M9 public lobbies.
- **2026-09-25** — **M3 chunk 1 built** (§6.13, `feat/hegemon-toolkit`): nothing is buildable on
  the Dark Star by anyone and the Hegemon owns no structures at all (H2, F8 closed for good); the
  5-minute re-invasion cooldown is gone from the sim, the HUD and the messages (H12); the Hegemon
  donates troops to any challenger, the invader included, ignoring the lobby's donation toggle, with
  gold and donations to the throne refused outright (H9); MIRVs hard-off in core in Hegemon mode and
  hidden in the lobby, Atom Bomb → Nuclear Warhead, Hydrogen Bomb → Antimatter Warhead in `en.json`
  (S6). Decided in the chunk's sub-questions: the toggle bypass, donating to the invader, hard-off
  over a lobby default, and a greyed rather than hidden build menu on domain tiles.
- **2026-09-25** — **M3 chunk 2 built: gifts** (§6.14). The Hegemon places or upgrades any structure
  on any challenger's tile through the host's own placement rules with itself as payer (a `payer`
  on the Player build API); a new appended `gift_unit` intent and `GiftExecution`; the Gift takes
  the ally slot of the throne's radial menu on a challenger's tile, listing the host's buildables at
  the host's prices; the host is told. Decided: upgrades count as gifts, Tribes can receive, the
  ally slot, one event line.
- **2026-09-25** — **M3 chunk 3 built: destroyers** (§6.15). The Hegemon builds the engine's warship
  on any moat tile without a port; destroyers stay in the moat, repair there, engage only fleets
  bound for the Dark Star, the invader's trade ships and warships inside the moat, and sail along
  the ring to meet an inbound invasion fleet. Decided: no AI Hegemon destroyers yet, warships
  answered only inside the moat, the moat as harbour, intercept by sailing to meet. After the
  playtest: destroyers and gifts are also placed from the **bottom build bar** (the placement ghost
  asks for the host's list and sends a gift order on a challenger's tile).
- **2026-09-25** — **The HUD merge (F19) tried and dropped.** Built as "Dark Star" and "Throne" columns
  in the player table with the Dark Star panel cut to a one-line strip; Tom played it and discarded
  it: seen missing, the panel's fields justify a panel of their own. Decided: the **panel stays**,
  the throne's challenger board starts **collapsed** (the show/hide toggle unfolds it), clean-up
  later if needed. With that, **M3 is complete**; M4 (balance, F1) is next.
- **2026-09-26** — **Punitive strikes decided (H19, F20, M3.5).** Tom's proposal, assessed against
  the built strike: a missile launch flags the silo for 30 s (the severer warhead wins, the throne
  sees a red or white badge and clicks the silo, or declines); the strike's troops are a levy on
  every living challenger's troops at home (5% Nuclear, 15% Antimatter), the throne pays nothing;
  no tyranny multiplier but a radius cap (30, the Nuclear Warhead's blast) and the tyranny floor as
  a hard stop so H16 holds; when full it halts 5 s, resumes if the target retakes a bubble tile,
  otherwise pops and the leftover troops are burnt; no recall; one strike per target, flags cleared
  by a strike and none while under one (the salvo is a feature); the Hegemon cannot fire a captured
  silo; the AI Hegemon strikes every flag except against players below a land-share threshold.
  Scheduled as M3.5, ahead of the balance sweep, because the levy moves the invasion curve.
- **2026-09-26** — **M3.5 built: punitive strikes** (§6.16). Tom's answers: a radial Punish slot,
  the badge for the throne and the owner, one radius, everyone told of the levy. The silo flag
  in `UnitImpl` written by `NukeExecution`; `RazeExecution` in punitive mode (levy, no tyranny
  multiplier, radius cap, halt-then-pop, resume on a breach, no recall, leftovers burnt);
  `punitive_strike` intent; the AI rule; the captured-silo guard; the badge through the telegraph
  pass; HUD rows without Recall. 12 tests. The leveller's tunables renamed `leveller*`. First sim
  numbers recorded for F20: strong nations beat a fresh pocket more often than not.
- **2026-09-26** — **H19 revised after Tom's first look.** A plain **click on a flagged silo** orders
  the punitive strike (the radial's Punish slot stays as the other way in); the levy rises to
  **10% / 25%** and the pocket's area by a quarter (`punitiveRadius` 34); **SAM launchers are
  removed** under a Dark Star (S6) — the punishment is the deterrent, not an interceptor net; the
  **Nuclear Warhead costs 1M gold**; the inbound message is one line.
- **2026-09-26** — **The economy goes to space (S7 revised).** Tom's proposal and the review: rails
  become straight **trade lanes** (in the sim; no connection where the line is blocked); the port
  becomes a **spaceport** placed anywhere like a city, with a **harbour** — the nearest deep space
  over land — for its ships; **freighters** cross land at half speed on three legs (land, space,
  land), always via deep space, over any land but the disc, the moat included, ownership ignored;
  **destroyers** stay in deep space, launched from a harbour; the names freighter / spaceport /
  Destroyer; stargates purely offensive. Spawn odds, destination weighting and the throttle are
  unchanged. The client keeps one motion plan per unit and takes any newer plan id, so a plan per
  leg needs no wire change. Steps (M3.6): spaceports and harbours, freighters overland, straight
  lanes, names.
- **2026-09-26** — **M3.6 step 1 built: spaceports anywhere and their harbours** (§6.17).
  `Game.harbours`; ports placed like cities; a challenger's destroyer launched from the harbour
  nearest the click and repaired at one; landlocked nations try inland ports. 9 tests;
  `Warship.test.ts` and the trade scenarios adjusted.
- **2026-09-26** — **M3.6 step 2 built: freighters overland** (§6.18). Ports pair through their
  harbours; `TradeShipExecution` sails three legs with a motion plan each, land at half speed
  (`freighterLandTicksPerTile` 2); a freighter on land cannot be captured; a captured one sails
  to the captor's nearest port with a harbour on its body of space; coastal trade unchanged tick
  for tick. 6 tests.
- **2026-09-26** — **M3.6 step 3 built: straight trade lanes** (§6.19), for Tom to judge the look.
  `straightLane` replaces the rail A\* (Bresenham line; blocked by void, the disc or open water;
  water costs six of the budget; no fallback); snapping makes two straight lanes; the client draws
  each lane as one anti-aliased segment (`RailroadPass` rewritten on `FrameData.railSegments`).
  7 tests.
- **2026-09-26** — Tom kept the **straight lanes**; the linking hop threshold went 4 → 2 (too
  dense) → **3**. Steps 1–3 committed by Tom (`PortEconomyChanges1`, `OverlandFreighters`, the
  lanes). **M3.6 step 4 built: the names** (§6.20) — Spaceport, Destroyer, freighter, trade lane
  as display strings only, 54 values in `en.json`, tutorial steps reworded for inland spaceports.
  M3.6 complete; M4 balance next, with the train-income note from §6.19.
- **2026-09-27** — **M4 first pass built** (§6.21). Tom's brief: the throne regenerates far too fast;
  cut it to about a tenth, raise the pool somewhat, build the last stand. Decided: a **flat refill**
  (H4 — the ceiling over `refillMinutes` 20, not the engine's curve, so a bled-dry throne cannot be
  kept down by a slow-rolled invasion), ceiling **125%**, gold a **3% shadow tax** on everything
  the challengers earn, the **last stand** (an AI throne goes all in above a 5% reserve once an
  invader holds 40% of the domain; no button for humans), the leveller's bar **75%** (H11), and
  **nations never nuke the Dark Star**. Measured 3 of 6 AI-only overthrows (from 0 of 6) at refill
  10, 20 and 40 minutes alike; `HegemonSim` gained gold columns and a last-stand line, and its
  shorthands no longer override `--set`. Awaiting Tom's playtest from the throne.
- **2026-09-27** — **The road to release written** (`docs/DarkStar-Roadmap.md`) from Tom's seven
  non-gameplay points, checked against the repo: identity is the hinge for the persistent throne and
  the store, anti-abuse and the AGPL obligations are work items, matchmaking is smaller than feared
  and multiplayer has no human Hegemon yet (P0). Phases P0–P8 supersede §9's M5–M9.
- **2026-09-27** — **P0 built: the throne in a private lobby and succession by hand** (§6.22).
  Tom's answers: the creator seats the Hegemon; an absent Hegemon is nobody's problem but their own;
  an AI killing blow leaves the seat unclaimed. Built: `hegemon.seat` on the wire, the Dark Star
  toggle and the crown-per-player seat control in the host lobby, the badge and card for joiners,
  `isHegemon` resolved at start; "New Lobby" inherits the round's settings and seats the winner as
  they arrive (heir), unseating anyone who leaves; the host form hydrates from the successor's
  config. 10 server tests; two two-client browser scripts. Next: Tom plays rounds with friends.
- **2026-09-27** — After Tom's first lobby round: **the throne is always on** (no toggle anywhere;
  the server forces it; every private lobby starts timed at 20 min), the **seat control is visible**
  (a "holds the throne" line over the roster with the crown hint), and a **random map stays
  "Random" for host and guests alike** until the server picks it at prestart (`randomMap` on the
  wire). §6.22 amended; 4 more tests.
- **2026-09-27** — **P1 step A built: strip and rebrand, first pass.** `proprietary/` deleted and
  replaced by a `branding/` overlay (placeholder favicon; text wordmark and Overpass Bold as the
  placeholder display face until Tom's logo and font); silent placeholder music and alert; every
  ad, analytics and third-party script and module removed; footer rebuilt with Source, January
  Games and the OpenFront attribution; OpenFront's legal pages, press kit, `ads.txt` and Apple Pay
  file removed; `CREDITS.md`, `LICENSE-ASSETS`, `LICENSING.md`, `README.md` rewritten. §8 amended.
  Steps B–E and the P1 decisions are in the roadmap.
- **2026-09-27** — **P1 step B built: the closed-API UI removed** (store, inventory, leaderboard,
  clans, account, profile, history, ranked, news, rewards, creator codes, subscriptions, bans and
  the cosmetic card chain; 101 modules, 70 tests, 688 strings). Tom's answers: placeholder wordmark
  and Overpass stay until his logo and font, no upstream links, step D joins P1. **Step E part 1:**
  the Earth-and-hex-grid background replaced by a generated pixel starfield
  (`scripts/generateStarfield.ts`). Next: C (strings) and D (Steam/CrazyGames layer).
- **2026-09-27** — **P1 steps C and D built.** The Steam desktop shell and CrazyGames layer are
  gone (19 modules, 31 tests); `Auth.ts` is down to the JWT paths; multiplayer gates on backend
  reachability only; service names, metric names and the nginx upstream are ours; hostnames in
  comments are placeholders; the OpenFront tutorial video is out of the help page. The only
  "OpenFront" left in the shipped code is the attribution line and six comments crediting upstream
  code and issues. P1 is complete except the home-screen title treatment (E), which waits on Tom's
  logo and font.
- **2026-09-27** — **P3 step 1: the map cull.** 112 inherited maps removed; 14 remain (Event Horizon,
  Milky Way, Sol, Traders Dream, Passage, Branching Paths, Chopping Block, More Than Luck,
  Sierpinski, Warship Warship, Duel, Standoff, Corners, Royale — the last four are the renamed
  tourney maps). The picker is a single alphabetical grid. Tom's decisions: keep Milky Way and Sol,
  his own maps ship CC BY-SA, about 20 maps at launch. Next: the authoring kit and the first batch
  of new maps.
- **2026-09-28** — **P2 decided and built: deep space over a starfield.** Tom chose translucent
  grey space over the home page's starfield rather than plain black. Water tiles bake translucent
  over a map-resolution render of the starfield (`StarfieldPass`; Roadmap P2 "as built"); the
  graphics settings keep a "Starfield background" toggle and a "Deep space opacity" slider as
  player preferences. Void and the outside of the map are now near-black. **Land stays as it is:**
  the P2 "land as one colour" goal is dropped (Tom, same day) because elevation is gameplay (attack
  cost and speed) and the plains/highland/mountain colours convey it intuitively; a more
  space-flavoured land palette is a possible later palette swap, not a design goal. The moat's
  current look is fine, so the moat-and-disc styling is low priority.
- **2026-09-29** — **Shield arrays shelter the blast, not the launch (§6.24).** Tom's revision:
  an array no longer refuses a launch; a warhead lands anywhere and the blast clears its circle as
  usual except the tiles inside the perimeter (no land, troops, structures or crater there; the far
  side of the array is still hit). The Hegemon's missiles are kept out like anyone else's (H2, C5
  revised; strikes still pass through). The price rises to 5M (Tom's baseline; F21). A blast kept
  wholly off an ally angers nobody; nations value sheltered structures at nothing.
- **2026-09-29** — **Public lobbies and thrones designed (`docs/DarkStar-Lobbies.md`).** Tom's
  decisions for the public matchmaking system: a fixed pool of 15 named thrones of fixed type
  (FFA / team / special, all with a Hegemon); no account needed to hold a seat; the winner gets a
  30-second window to pick the map (and whitelisted modifiers on a special throne) and to keep or
  step down from the throne; open seats are first come, first served, the AI otherwise; two humans
  to fire with a hold below that; no reign cap; a restart opens every seat; team thrones give the
  seat to the slayer, not the team. §5.2 points at the new document; roadmap P6 now defers to it.
- **2026-09-28** — **Missiles on gates, shield arrays, the throne's warheads (§6.23).** Tom's
  decisions: the missile silo goes (S6, hard-off like the SAM); a warhead launches from the nearest
  ready stargate with the target in range and spends its charge (C4); a new **Shield Array** (C5:
  1M, one level, 35-tile perimeter, half a level-1 SAM) refuses other players' missiles while the
  throne's missiles and strikes pass through; the Hegemon may fire missiles from the Dark Star at
  everyone's price (H2 revised, H19's captured-gate rule reworded). Numbers and the AI's use of both
  are open in F21.
- **2026-09-30** — **Balance pass: cheaper arrays, cheaper and faster gates, no gate level cap
  (C4, C5, F15, F21).** Tom's numbers: the shield array costs 2M (was 5M); a stargate costs a flat
  500k, new or per upgrade (was 1M), reloads in 5 s (was 60) and has no upgrade limit (was level
  5), each level adding 75 range as before. `STARGATE_DEFAULTS.maxLevel` is gone and
  `stargateRange` no longer clamps; `UnitInfo.maxLevel` stays as an unused hook. Nations keep
  level 5 as their own limit when upgrading a gate towards the moat (`THRONE_GATE_MAX_LEVEL`), so
  the AI's gate building is unchanged. Not re-swept in `HegemonSim` (F1).
- **2026-10-01** — **Accounts at launch, store after it (roadmap P5, P7).** Tom's decisions: the
  public release has an authoritative account system with a leaderboard database, tracking
  performance only at first (reigns as Hegemon, longest consecutive streak); the launch is free and
  the store and cosmetics follow later. Login is Discord and Google, with email addable later;
  guests play and may hold a throne but their reigns are not recorded; every public throne round
  counts (two humans, L9); the board shows thrones taken, rounds held and longest reign. Details
  in the roadmap's P5.
- **2026-10-01** — **Accounts designed and the launch sequenced (`docs/DarkStar-Accounts.md`,
  `docs/DarkStar-Launch.md`).** The accounts document turns the decisions above into a plan
  (A1–A6 decided, A7–A20 proposed: a small API service in this repository on SQLite, the existing
  token format, guests accepted in production, results through the existing archive call, steps
  B1–B7). The launch document fixes the scope of the minimum public release and orders every
  remaining step in stages 0–8. Tom postponed the friends playtest of 2026-10-04: it now happens
  on the live release candidate and is the go/no-go gate for opening to the public. Tom's review
  the same day: hosting is one rented server behind Cloudflare; at least six new maps for launch;
  guests are given `Anon` names and cannot choose one, signed-in players may play under any name;
  the board shows reigns (every win) and longest reign (consecutive wins).
- **2026-10-01** — **Map authoring kit built (roadmap P3 step 2, launch stage 1).** `npm run map`
  turns an MS Paint drawing in a seven-colour palette into a playable map: terrain, nation spawns
  from red dots, the Dark Star from a yellow circle, a plain-language report. Guide:
  `docs/MapMaking.md`; as-built note in the roadmap.
- **2026-10-03** — **No Moon, the first sketched map (§5.3).** Tom's Paint sketch plus a sentence of
  intent (`MapImages/NoMoon.png`: the Dark Star bottom right, a beam of land to a moon shattering at
  the top left) was authored as a generated drawing (`src/scripts/drawings/NoMoon.ts` →
  `map-generator/drawings/No Moon.png`) and built with the kit: 19 nations, ~530k land, the beam as
  the direct road and the debris chains as the flank routes. Three `HegemonSim` seeds: 2 overthrows,
  1 to the timer. The working method for further maps: Tom sketches and describes, the drawing is
  generated from his description so it can be re-tuned by number.
- **2026-10-03** — **Nucleic Acid and Nucleus (§5.3).** Two more maps from Tom's sketches, on a shared
  drawing library (`src/scripts/drawings/Drawing.ts`). Both first builds seated nations near the
  throne (the outer middle-row base pairs at ~400 tiles; every other particle at 300 tiles) and in
  all six AI rounds one of those nations overthrew it, twice inside 15 minutes. Rebuilt with no
  nation nearer than 500 tiles: Nucleic Acid 1 overthrow in 3 seeds, Nucleus 2 in 3. **Rule of
  thumb for every map: no nation starts within about 500 tiles of the Dark Star's centre;** land
  nearer than that is Tribe land and staging ground.
- **2026-10-03** — **Jovian System, Bullseye and Cube (§5.3).** Three more maps from Tom's sketches
  by the same method, bringing the new maps to six (the launch minimum). Jovian System: Jupiter's
  zones with the Great Red Spot as the Dark Star, the Galilean moons on the diagonals, the ring as
  a road in from the edge; overthrown in 3 of 3 AI rounds, all after 18 minutes. Bullseye: three
  rings cracked into arcs, one nation per arc on the outer two; 2 of 3. Cube: an isometric cube
  as a grid of island cells, since solid faces would be three times the land budget; with nations
  on the outer rows only the throne held 3 of 3, so the third cell in on each face's diagonal
  (just past 500 tiles) seats a nation too (24): then overthrown in 3 of 3, once inside 15 minutes by one of those three. Tom has not yet played any of the six.
- **2026-10-03** — **Public thrones, step T1 built** (`docs/DarkStar-Lobbies.md` §10.1): the
  master runs a fixed pool of named throne lobbies back to back with the AI seated; no gameplay
  rule changed. The seat, the winner's pick and the client's throne views follow in T2 and T3.
- **2026-10-04** — **Reinforcing the throne (H9, §6.25).** Any player may donate troops to the Hegemon
  while its pool has room; while someone holds the Dark Star the troops go straight into the
  counter-attack against them, stalled or not. Opened by Tom to break deadlocked invasions (an
  exhausted invader with no land beyond the moat, an emptied throne) and to let rivals bid for the
  throne by proxy. Donations to the invader and gold from the throne stay shelved. Same day, at
  Tom's ask: a **Reinforce the throne** entry in the radial menu's ally slot when a challenger
  right-clicks the Dark Star, sized by the attack-ratio slider like the team-mode donation.
- **2026-10-04** — **Studio wordmark in the footer.** Tom supplied the January Games logo (pixel art,
  AI-generated, a placeholder mark he may replace). The dark- and light-background wordmarks are in
  `branding/images/` under the existing All Rights Reserved overlay; the footer shows the dark one
  at 1:1 in place of the "Made by January Games" text, which stays as its alt. Favicon unchanged
  (the Dark Star). The game's own logo, title and font remain P1 step E. §8 amended.
- **2026-10-04** — **First sound cues of our own: launch, landing, missile.** Tom recorded the
  three. `landing` plays when the player's own opening flight comes down and when a projectile they
  fired, or one aimed at their land, comes down — the throne's strike included, since it is an
  invasion (a first cut wrongly kept the atom cues for it). `launch` replaces the atom launch cue for
  the opening, strikes and gate shots, to the same audience. `missile` replaces the atom, hydrogen
  and MIRV launch cues, to the launcher, the target and always the Hegemon; detonations stay
  audible to all. Never to a third player or a spectator. The defender of a shot is remembered from
  the flight, since the aimed tile is the shooter's by the landing update. S8 revised with the
  audience principle and the per-cue workflow; §6.9 and §6.12 noted; `CREDITS.md` credits the files.
