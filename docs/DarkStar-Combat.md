# Under a Dark Star — Combat mechanics (reference and strike-front review)

> The code-level companion to the player wiki's [Combat](../wiki/pages/combat.md) page: where every
> combat number lives, how the pieces interact, and (§4) why a Hegemon strike fights differently
> from every other front, with options for reworking it. Written 2026-10-24 from the code at
> `7e8c139c` plus the uncommitted leveller-threat change of the same day. Troop figures below are
> **engine units** (the screen shows a tenth, `renderTroops`).

## 1. The pieces

| Piece                | Code                                                      | Role                                                                                    |
| -------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Land attack          | `src/core/execution/AttackExecution.ts`                   | Every attack over nebula, and the ground phase of a fleet, gate shot or Dark Star fight |
| Per-tile price       | `Config.attackLogic` (`src/core/configuration/Config.ts`) | Pure function: attacker loss, defender loss, tick fraction for one tile                 |
| Strike               | `src/core/execution/RazeExecution.ts`                     | Hegemon strike and punitive strike: flight, bubble, pop                                 |
| Retreat order        | `src/core/execution/RetreatExecution.ts`                  | Orders a retreat, executes it 20 ticks (2 s) later                                      |
| Fleet                | `src/core/execution/TransportShipExecution.ts`            | Carries troops, lands, hands over to an `AttackExecution` with `sourceTile` set         |
| Gate shot            | `src/core/execution/GateShotExecution.ts`                 | Same hand-over, marks the landing tile as a beachhead                                   |
| Enclosure            | `PlayerExecution.removeClusters` / `removeCluster`        | Sealed-in pockets go to the enclosing enemy every 20 ticks                              |
| Armies               | `src/core/execution/ArmyExecution.ts`                     | Shots that remove `ARMY_DEFAULTS.casualtyPercent` (10%) of an incoming attack           |
| The throne's defence | `src/core/execution/HegemonExecution.ts`                  | Stall counter-wave (H13), last stand, leveller strikes                                  |
| Troop pool           | `Config.maxTroops`, `Config.troopIncreaseRate`            | Ceiling and regrowth                                                                    |

## 2. Rules of the ordinary fight

### 2.1 Troops

- **Ceiling** `2·(tiles^0.6·1000 + 50 000) + cityLevels·250 000`, Dark Star tiles excluded for a
  challenger (H5). Barons ÷3; Lords ×0.5/0.75/1/1.25 by difficulty. The Hegemon's is fixed
  (`hegemonMaxTroops`, H4).
- **Regrowth** per tick `(10 + troops^0.73 / 4) · (1 − troops/ceiling)`, halved for Barons, scaled
  by difficulty for Lords. Peaks at `0.73/1.73` ≈ **42%** of the ceiling. The Hegemon's is flat
  (`hegemonTroopsPerTick`).
- Troops in an attack have left the pool (`removeTroops` at launch); retreats and exhausted
  attacks `addTroops` the survivors back.

### 2.2 Launching (`AttackExecution.init`)

1. Refusals: self, friendly, `canAttackPlayer`, and the bubble rule (a land attack on the Hegemon
   from a player holding no domain tile and not struck by it).
2. Troops: `startTroops ?? attackAmount` (troops/5; Barons /20), capped by the pool, removed.
3. **Cancel loop.** For every incoming attack from the target that is **not a strike**: the smaller
   side is deleted and the larger loses that many troops. Two players therefore never have
   opposing live attacks on each other, so a front only moves one way.
4. **Merge loop.** A new land attack (no `sourceTile`) absorbs every outgoing attack on the same
   target, landed fleets included; a Hegemon never absorbs its strike into a domain defence.
5. Embargo, alliance-request rejection and the relation drop.

### 2.3 Advancing (`AttackExecution.tick`)

- **Frontier.** A priority heap of target tiles bordering the attacker. Priority
  `(rand(0..6)+10)·(1 − 0.5·ownedNeighbours + terrainMag/2) + tick` (plains 1, highland 1.5,
  mountain 2): pockets first, flat ground first, noise for shape. Seeded from all border tiles
  at launch and extended from each tile taken. **The moment it runs dry the attack ends** and its
  troops come home with no malus (`refreshToConquer(); retreat()` — unconditional), even if the
  target has since exposed new tiles elsewhere.
- **Budget.** Each tick spends a budget of 1; each tile consumes `tickFraction`. With
  `borderSize = front tiles + rand(0..4)`, tiles per tick scale with the length of the front.
- **Death.** Under 1 troop the attack is deleted. Under 100 tiles the defender is eliminated
  (`handleDeadDefender`): the attacker takes what it touches, hostile neighbours the rest. Never for
  the Hegemon, which dies only at 0 tiles.

### 2.4 The price of a tile (`Config.attackLogic`)

Base by terrain: plains `mag 80 / tileCost 16.5`, highland `100 / 20`, mountain `120 / 25`.
Multipliers on both, in order: Defense Post within 30 tiles (`mag ×5`, `tileCost ×3`), fallout
(`×(5 − 2·irradiatedShare)`, so 5 down to 3, also on neutral land; the comment's "2.5" is wrong),
Dark Star tile with a defender (`domainAttackerLossPercent` / `domainConquestSlowPercent`, 300/300).

**Neutral land:** attacker loss `mag/5` (Barons `/10`), no defender loss, tick fraction
`clamp(2000·tileCost/troops, 5, 100) / (2·borderSize)`; the floor is reached at 6 600 troops on
plains, so above that size only the border sets the pace.

**A player:** with `r = defenderTroops / attackTroops` (troops at home, not in the defender's own
attacks):

```
defenderLoss = defenderTroops / defenderTiles                         (its average density)
attackerLoss = mag · traitor(0.5) · clamp(r, 0.6, 2)
             · (0.463 · bigAttacker · bigDefender + 0.0039 · defenderLoss)
tickFraction = clamp(r, 0.82, 7.5) · clamp(r/20, 1, 50) / 8.55
             · tileCost · bigAttackerSpeed · bigDefender · traitor(0.8) / borderSize
```

`big*` are logistic discounts in `log(tiles)` around 300k tiles (attacker to 0.3× loss / 0.27×
speed, defender to 0.7×); negligible below ~100k tiles. Barons as defenders take `mag ×0.7` from
players and Lords. A disconnected teammate costs nothing.

### 2.5 Ending

- **Retreat** (`RetreatExecution`): the attack freezes on order, executes 20 ticks later, 25% malus
  against a player, none against neutral land. Fleets recalled at sea lose 25% on arrival unless
  turned back by the invasion slot (H12).
- **Alliance** formed mid-attack: full refund.
- **Enclosure** (`removeCluster`): a cluster sealed in, touching neither shore nor map edge, goes
  to the enclosing player with no troop exchange; gate beachheads exempt (C4); the Hegemon exempt
  (H7); an invader's last homeland cluster ends it (H20).

## 3. The Dark Star and strikes as built

- **Domain fight.** Tiles cost 3×/3×; the Hegemon is costed as holding its whole domain, so each
  lost tile bleeds `troops / domainTileCount`. The throne's counter-attacks are ordinary
  `AttackExecution`s and **do** cancel with the invader's. H13: no gain for `invasionStallSeconds`
  → every regrown or donated troop goes into the counter-attack.
- **Strike** (`RazeExecution.tick`): an `Attack` marked `isStrike`, its own frontier (target tiles
  next to Hegemon tiles beyond the moat), `attackLogic` with the Hegemon costed as its domain size,
  attacker loss `× razeAttackerLossPercent × tyranny`, tick fraction `× razeSlowPercent`. The
  defender loss is the **target's home density**, taken from the target's home pool. Each tile
  becomes Hegemon land (the bubble).
- **Counter** (since 2026-10-24, §4.4): the `counter_strike` intent → `CounterStrikeExecution` →
  `RazeExecution.counter(troops)`. Each committed troop removes `counterRate` strike troops, where
  `counterRate = max(1, strikeTroops / (maxTroops(target) × strikeCounterCeilingPercent / 100))`
  is fixed at launch; only `ceil(strike / counterRate)` is ever taken from the target. A landed
  strike only; one in flight cannot be countered.
- **The bubble is out of bounds.** `AttackExecution.init` refuses any land attack on the Hegemon
  from a player holding no domain tile, and its tile loop skips Hegemon tiles beyond the moat;
  `Player.canAttack`, `TransportShipExecution` and `GateShotExecution` refuse the bubble too.
- **End:** troops < 1 (spent or countered), tyranny floor, frontier empty after a refresh,
  recall, tile lost in flight, target or throne dead → `end()`: `pop()` (bubble to neutral,
  structures destroyed) and **no troops return**, for punitive strikes and ordinary ones alike.
- **AI.** `AiAttackBehavior.counterStrike()` runs first in `maybeAttack` and
  `attackRandomTarget`: a struck Lord or Baron offers `STRIKE_COUNTER_SHARE` (half) of its troops.
  The AI throne no longer recalls on invasion (nothing would come back); its runner-up recall
  stays.

## 4. Why the strike front looked different (resolved 2026-10-24, §4.4)

§4.1–4.3 describe the rules before the rework, kept as the record of why it was made.

### 4.1 What happens

The strike is exempted from the cancel loop (§2.2 step 3; H17, so that a 25%-of-the-pool strike
could not simply erase a challenger's army troop for troop, §6.6). Nothing replaced the cancel, so
it is **the only place in the game where two opposing attacks live on the same border at once**.
Each runs its own frontier every tick:

- the strike takes target tiles next to the bubble, paying at odds `targetHome / strike`;
- the counter-attack takes bubble tiles next to the target, paying at odds `strike / counter`.

Both frontiers are the same line, each chooses tiles by its own noisy priority, so in one tick the
line moves out in some places and in at others: the organic, two-way front Tom saw.

Three side effects follow from the same accounting:

1. **Commitment does not set the direction.** The strike's pace depends on the target's home
   troops, not on the counter. The counter's pace depends on the strike's troops. Neither stack
   holds the other back; they simply trade tiles at two independent rates.
2. **Countering speeds the strike up.** Troops sent into the counter leave the home pool, which
   lowers `targetHome / strike` — cheaper and faster razing everywhere else on the bubble's edge.
3. **Winning refunds the throne.** Retaking the whole bubble empties the strike's frontier, so it
   "comes home" with every surviving troop and no malus.

### 4.2 Measured

Headless, real `attackLogic`, `big_plains`, a challenger of ~4.8k tiles with 1M troops at home, a
1.5M strike given 10 s to grow a bubble (~1 000 tiles), then a counter-attack. Tiles per second:

| Counter | s1 strike / counter | s3         | s5         | Ticks with both gaining | Outcome                                                                                                                   |
| ------- | ------------------- | ---------- | ---------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 300k    | +199 / +74          | +230 / +34 | +189 / +32 | 10 of 10 every second   | Counter's frontier ran dry at ~10 s (119k went home) with the bubble still growing (1 267 → 2 601 tiles); strike razes on |
| 900k    | +163 / +270         | +69 / +501 | +4 / +75   | 9–10 of 10              | Bubble wiped at ~5 s; target home pool fell to ~85k meanwhile; strike went home with 25k                                  |

With a small, young bubble (300k strike, 2 s old, 100k counter) the line churned exactly one tile
each way per tick for 13 s while both stacks bled, then the counter ran dry and the strike resumed.
In an ordinary fight the same commitments would have cancelled at launch and one side would have
pushed.

### 4.3 Options

| Option                                        | Change                                                                                                                                                                                                                                                                  | Front behaves like                                   | Cost / risk                                                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Weighted cancel**                        | Put strikes back in the cancel loop at an exchange rate: each counter troop cancels `razeAttackerLossPercent/100` (3) strike troops. A counter bigger than a third of the strike erases it and pushes on into the bubble; a smaller one is erased and dents the strike. | Ordinary combat exactly                              | Brings back the instant cancel Tom rejected in §6.6, only cheaper; the bubble fight vanishes for any counter above a third of the strike.         |
| **B. The stronger side pushes** (recommended) | While the struck player's counter-attack is live, compare `counter × 3` with the strike's troops each tick. The larger side advances; the smaller **holds** (its frontier does not move) and only bleeds. Costs stay as built (H17: the strike defends its own bubble). | One line, one direction, decided by committed troops | Small change in `RazeExecution.tick` and `AttackExecution.tick`; the exchange factor is a new lever (`strikeHoldRatioPercent`); tests to rewrite. |
| **C. Home-pool odds for the counter only**    | Keep both fronts, but cost the strike's tiles against the target's home pool **plus** its live counter, so countering no longer makes the strike cheaper.                                                                                                               | Still two-way, without the perverse incentive        | Fixes side effect 2 only; the visual oddity remains.                                                                                              |
| **D. No refund on a wiped bubble**            | A strike whose bubble is entirely retaken counts as defeated: survivors pay the 25% retreat malus (or are lost).                                                                                                                                                        | —                                                    | Independent of A–C; fixes side effect 3.                                                                                                          |

**Recommendation: B, with C's odds folded in and D.** B keeps the bubble and every H17 cost, so
the strike still bleeds per tile retaken and a fresh compact bubble is still hard to breach, but the
front reads like every other front in the game: whoever commits more pushes. The factor 3 mirrors
the strike's own 3× price, so "a third of the strike holds it" is a rule players can learn, and
it is a single tunable. This is Tom's call (F23 in the design doc); nothing has been changed.

### 4.4 Decided and built (Tom, 2026-10-24)

None of A–D as drawn. Tom's design: strikes are fought **like any other attack, by cancelling**,
but cancelling never wins land back.

- **One front, outward only.** The bubble is never retaken; a strike pops the moment it stops
  advancing, so it always destroys the land around its landing and the defender's choice is how
  much to commit to limit the rest.
- **Weighted cancel.** One for one up to a strike the size of the target's ceiling
  (`strikeCounterCeilingPercent`, 100); beyond that each defending troop cancels proportionally
  more, so a disproportionate strike on a weaker player wastes the throne's troops. Tom asked for
  "at least some semblance of penalty" for disproportion; the share is the lever to tune.
- **No refunds.** Strike troops never come home: recall, pop or a lost aim tile.
- **Punitive strikes** lose the halt: they pop when nothing in reach is left, and can be cancelled.

Effects on the side effects above: (1) only the strike advances, at a pace set by its shrinking
troops; (2) committed troops leave the home pool but cancel the strike outright, so countering
always reduces the damage; (3) gone. Balance (the throne's pool now drains for good on every
strike) is still to be measured in `HegemonSim` (F1).

## 5. Changelog

- **2026-10-24, later** — The strike rework built (§3, §4.4): weighted cancel, the bubble out of
  bounds, no refunds, no punitive halt, AI counters. Wiki updated to match.

- **2026-10-24** — Written: the combat reference, the strike-front measurement and options (F23).
  The player wiki gains [Combat](../wiki/pages/combat.md); Getting started's two combat claims
  corrected (regrowth peaks below half the ceiling, not at empty; the attack discount stops at
  about 5:3, not 2:1).
