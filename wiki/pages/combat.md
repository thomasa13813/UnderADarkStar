---
title: Combat
description: How fighting works in Under a Dark Star - troops, attacks, what each tile costs, fronts, retreats, encirclement, fleets, the Dark Star and the Hegemon's strikes.
section: Start here
order: 3
related: getting-started, armies-and-destroyers, stargates-and-warheads, overthrowing-the-hegemon, hegemon
---

Everything in a round is decided by troops taking nebula one tile at a time. This page explains
how that works, from a single attack to the fight over the Dark Star.

## Troops

- **One pool.** Your troops are your army, your garrison and your population at once. There are
  no separate defenders: whatever sits in your pool defends all of your territory.
- **The ceiling.** Your pool can only hold so much. The ceiling grows with your territory (more
  slowly than the territory itself) and by a flat amount for every level of
  [[buildings#3-1-population-center|Population Center]]. Barons have a third of a challenger's
  ceiling; Lords have more or less than you depending on the difficulty.
- **Regrowth.** Troops regrow on their own. Growth is fastest when your pool is a little under
  half full, and slows to nothing as it nears the ceiling. A full pool earns nothing, so troops
  sitting at the ceiling are troops wasted.
- **Sent troops are gone from home.** An attack takes its troops out of your pool the moment you
  launch it. While they are out they do not defend you, and they do not count towards your
  regrowth. Anything that comes home is added back to the pool.
- **Dark Star tiles count for nothing.** A challenger holding part of the Dark Star gains no
  ceiling from it.

## Defence is automatic

Nobody stands guard on a tile. When an enemy takes one of your tiles, you lose your **average
troops per tile**: your pool divided by the tiles you hold. So:

- Every tile you lose costs you the same, wherever the attack lands.
- A thinly spread empire loses little per tile, but each tile is also cheap to take.
- A dense pool makes every tile expensive for the attacker and every lost tile painful for you.
- Sending troops away (on attacks, fleets or Stargate shots) thins your pool, and with it the
  defence of every tile you own.

## Launching an attack

- Click enemy or unclaimed nebula next to your territory. The **attack ratio** slider sets what
  share of your pool goes.
- **Clicking again stacks.** A new attack over nebula on a player absorbs every attack you
  already have on them, landed fleets and shots included, into a single attack.
- **You can fight on many fronts at once,** one attack per target over nebula plus any number of
  fleets and shots.
- Barons send a twentieth of their troops at a time; players and Lords decide for themselves.

## How an attack advances

An attack has a **front**: every enemy tile touching your territory. Each moment it takes a
handful of front tiles, then the tiles behind them become the new front.

- **Pockets first.** Tiles you already touch on several sides are taken first, so attacks fill in
  dents and straighten lines. Flat ground is preferred over rough ground, with a little chance
  thrown in. That is why fronts look ragged rather than ruler-straight.
- **Speed grows with the front.** The longer the shared border, the more tiles fall each moment.
  A long border is overrun far faster than a narrow neck.
- **The attack ends** when its troops run out, when nothing it can reach is left to take (the
  survivors come home at no cost), or when you call it back.

## What each tile costs

Every tile taken costs the attacker some troops and some time, and costs the defender its
average troops per tile. Five things set the price.

### The odds

The odds are the **defender's whole pool against the troops in your attack**.

| Your attack against their pool | Troops lost per tile | Time per tile |
| ------------------------------ | -------------------- | ------------- |
| 5:3 or better                  | 0.6×                 | 0.82×         |
| 1:1                            | 1×                   | 1×            |
| 1:2                            | 2×                   | 2×            |
| 1:7.5                          | 2× (no worse)        | 7.5×          |
| 1:40                           | 2×                   | 15×           |

- Losses stop falling once you outnumber the defender about 5 to 3, and stop rising once you are
  outnumbered 2 to 1.
- Speed keeps falling the more you are outnumbered: a small attack against a big empire crawls.
- The defender's troops already out on attacks do not count. A neighbour who has just sent half
  their army at someone else is half as hard to hit.

### Their density

Part of the price is a flat base, and part grows with the defender's troops per tile. As shown on
screen, at even odds over open nebula an attacker loses about **4 troops per tile, plus a third of
a troop for every troop per tile the defender holds**; the defender loses its full troops per tile:

| Defender's troops per tile | Attacker loses per tile | Defender loses per tile |
| -------------------------- | ----------------------- | ----------------------- |
| 2                          | about 4                 | 2                       |
| 12                         | about 7                 | 12                      |
| 50                         | about 19                | 50                      |

Thinly held land costs the attacker more than the defender. Densely held land costs the defender
more than the attacker, but it is slow and the attacker needs a big stack to have good odds.

### The terrain

| Nebula        | Troops lost | Time |
| ------------- | ----------- | ---- |
| Open (plains) | 1×          | 1×   |
| Highland      | 1.25×       | 1.2× |
| Dense (peaks) | 1.5×        | 1.5× |

Deep space cannot be attacked over: crossing it takes a fleet or a Stargate.

### Where the tile is

- **Defense Posts.** Within 30 tiles of the defender's finished Defense Post, attackers lose
  **5×** the troops and advance **3×** slower. See [[buildings]].
- **Radioactive ground.** A tile hit by a warhead costs between 3× and 5× the troops and the time,
  more the less of the map is irradiated.
- **The Dark Star.** A tile of the Dark Star costs the invader {{domainLoss}}× the troops and takes
  {{domainSlow}}× as long. See [[combat#the-dark-star|below]].

### Who is fighting

- **Big empires** are cheaper and faster to attack _from_ and slightly cheaper to attack _into_.
  The effect is small below about a hundred thousand tiles and strongest for the largest empires
  on the biggest maps, so late rounds keep moving.
- **Traitors** (see [[alliances-and-diplomacy]]) defend at half strength and a little slower for
  30 seconds after breaking an alliance.
- **Barons** are easier prey: players and Lords lose 30% fewer troops taking their tiles.

## Unclaimed nebula

Neutral nebula has no defender. Each tile costs a small flat number of troops (more on rough
ground, half as much for Barons). Small stacks spread slowly; past a few hundred troops an attack
spreads as fast as it can, and only a longer border makes it faster.

## When two attacks meet

**Opposing attacks cancel out.** If you attack a player who is attacking you, your troops and
theirs cancel one for one the moment you launch. Whoever had more keeps going with the
difference; the other attack is gone.

So the border between two players only ever moves in one direction at a time, the way the larger
committed stack pushes. To turn a front around you must send more than is coming at you. A
Hegemon's strike is cancelled the same way, but cancelling it never wins land back: see
[[combat#fighting-a-strike|Fighting a strike]].

## Calling an attack back

- Retreat from the event panel. The troops pull out after two seconds.
- A retreat from a player's land **costs a quarter** of the attack's troops. A retreat from
  unclaimed nebula is free.
- An attack that simply runs out of tiles in reach comes home whole.
- If you ally with the player you are attacking, the attack comes home whole.

## Encirclement and elimination

- **Surrounded pockets fall.** A piece of your territory sealed in by enemies, touching neither
  deep space nor the edge of the map, is handed to the enemy around it without a fight. Your pool
  keeps its troops, but it has lost the land. Watch thin necks of nebula: cutting one can swallow
  everything behind it. A pocket founded by a Stargate shot stands for as long as its landing tile
  is held.
- **Under 100 tiles you are finished.** A player whose territory drops below 100 tiles is
  eliminated by the attack that put them there. The attacker takes what it touches and the
  neighbours take the rest.
- **The Hegemon is the exception.** It never falls to encirclement or the 100-tile rule; it falls
  only when its last Dark Star tile is taken. See [[overthrowing-the-hegemon]].

## Fleets and Stargate shots

- **A fleet** carries a share of your troops across deep space and lands on the coast you chose.
  It takes the tile it lands on, then fights outward from there like any attack.
- **A Stargate shot** does the same over any distance in range, nebula or deep space. See
  [[stargates-and-warheads]].
- A landing starts its own attack. It cancels against an attack coming the other way like any
  attack, and a later attack of yours over nebula on the same player absorbs it.
- Recalled at sea, a fleet sails home and loses a quarter of its troops on arrival. Enemy [[armies-and-destroyers|Destroyers]] can sink it on the way.

## Armies

An [[armies-and-destroyers|Army]] fires at the front of any land attack on you within
{{armyRange}} tiles, once every {{armyReload}} seconds. Each hit kills {{armyKill}}% of that
attack's troops. Armies thin attacks down; they never attack themselves. They fire on the
Hegemon's strikes too.

## The Dark Star

The Dark Star is a fortress, and fighting over it follows its own rules.

- **Getting in.** Only one challenger may invade at a time: the one whose fleet or Stargate shot
  lands first. Everyone else's attacks on the Dark Star are refused or turned back until the slot
  is free. See [[overthrowing-the-hegemon]].
- **Every tile is expensive.** A Dark Star tile costs the invader {{domainLoss}}× the troops and
  {{domainSlow}}× the time of an ordinary tile.
- **The Hegemon's defence never thins.** The throne is always costed as if it still held the whole
  Dark Star: every tile it loses bleeds the same small share of its pool, however much it has
  already lost.
- **Counter-attacks cancel** with the invader's attacks as usual: the front inside the Dark Star
  moves one way at a time.
- **A stalled invasion is thrown back.** If the invader gains no tile for {{stall}} seconds, every
  troop the throne regrows is sent against them until they are evicted. Troops donated to the
  throne while someone holds part of the Dark Star go straight into that counter-attack.
- **The killing blow.** Whoever takes the last Dark Star tile wins the round.

## Strikes

The Hegemon cannot attack over nebula: it borders nobody. Instead it **strikes**. A strike flies
from the Dark Star's centre to any challenger tile, lands there, and razes outward. See [[hegemon]]
for ordering one.

- **Expensive.** Each tile costs the strike {{raze}}× the troops of an ordinary conquest and takes
  {{razeSlow}}× as long, multiplied again by **tyranny** against small targets: no penalty
  against a player holding {{free}}% of the map's nebulae or more, a rising penalty below that,
  and no strike at all at {{floor}}% or below. The Hegemon can never eliminate anyone.
- **It drains your pool like any attack.** Each tile it takes costs you your average troops per
  tile, and the odds it fights at are your pool at home against its troops.
- **The bubble.** The nebula a strike holds is its **bubble**. It belongs to the Hegemon while
  the strike lasts and **cannot be taken back**, by you or anyone else. Buildings in it are
  captured.
- **The end.** A strike ends the moment it stops advancing: its troops are spent or cancelled,
  nothing is left in its reach, you are struck down to the tyranny floor, the Hegemon calls it off
  or the Hegemon falls. The bubble then **pops**: like an
  [[stargates-and-warheads#warheads|Antimatter Reaction]], it **erases** the nebula into deep
  space, gone for good, and every building in it is destroyed.
- **Its troops never come home.** Whatever a strike still has when it ends is lost, and so is a
  strike the Hegemon calls off, in flight or on the ground.
- Defense Posts and Armies work against strikes. Shield Arrays do not: a strike is troops, not a
  missile.

### Fighting a strike

Fight a landed strike with **Counter-attack** in the event panel, or by clicking the bubble. The
attack ratio slider sets how many troops you offer.

- **Your troops cancel the strike's**, the way opposing attacks cancel. Only what it takes to
  cancel the strike leaves your pool; the rest stay home.
- **One for one, unless the throne overreaches.** A strike no bigger than
  {{counterCeiling}}% of your troop ceiling is cancelled troop for troop. Against a bigger strike
  each of your troops cancels more: a strike four times your ceiling is cancelled four for one.
  You can always cancel a whole strike with {{counterCeiling}}% of your ceiling, whatever the
  Hegemon sends.
- **There is one front, and it only moves outward.** Countering does not win land back. It
  shrinks the strike, which slows it, and ends it the moment it is cancelled. What it has already
  taken is erased when it pops.
- **Answer fast.** A strike always destroys the nebula around where it lands; how much more it
  takes depends on how quickly, and how heavily, you commit troops against it.
- You cannot counter a strike still in flight: wait for it to land.

### Punitive strikes

A missile launch lets the Hegemon answer with a **punitive strike** on the launcher. It fights by
the same rules with two differences: its troops are a levy taken from every challenger, and it
pays no tyranny but razes only within {{pRadius}} tiles of the launcher. It cannot be called off.
See [[hegemon#punitive-strikes|Punitive strikes]].

## Situations

- **Two neighbours at war, one front.** Whoever commits more pushes; the other side's counter
  cancels against it. The winner is decided by the stacks, the terrain, Defense Posts and Armies.
- **Fighting on two fronts.** Each attack is separate, but both are measured against your one
  pool at home. Every troop you send to one front makes you cheaper to hit on the other.
- **Hitting a neighbour who is busy elsewhere.** Their troops out on attacks do not defend them.
  The moment after they launch a big attack is the moment they are weakest.
- **The narrow neck.** A front only a few tiles wide advances slowly whatever you send. Widen it,
  or go around it by fleet or Stargate.
- **Cutting off a pocket.** Seal in an inland part of an enemy and it is yours for free.
- **Sitting at the ceiling.** A full pool regrows nothing and makes you a dense, slow target, but
  an expensive one. Spending down to about half and letting it regrow earns more troops.
- **Being struck.** Counter the moment it lands. Every second it keeps advancing is nebula and
  buildings you will not get back; a heavy counter early beats a light one late.
- **Invading the Dark Star.** Land with a big stack and keep gaining tiles: stop for
  {{stall}} seconds and the throne throws everything it regrows at you.

## Quick reference

| Factor                       | Troops lost                 | Time per tile   |
| ---------------------------- | --------------------------- | --------------- |
| Outnumbering 5:3 or better   | 0.6×                        | 0.82×           |
| Outnumbered 2:1              | 2× (the maximum)            | 2×              |
| Highland / dense nebula      | 1.25× / 1.5×                | 1.2× / 1.5×     |
| Defense Post within 30 tiles | 5×                          | 3×              |
| Radioactive ground           | 3× to 5×                    | 3× to 5×        |
| Dark Star tile               | {{domainLoss}}×             | {{domainSlow}}× |
| Hegemon's strike             | {{raze}}× and tyranny       | {{razeSlow}}×   |
| Defender is a traitor        | 0.5×                        | 0.8×            |
| Defender is a Baron          | 0.7×                        | 1×              |
| Army hit                     | {{armyKill}}% of the attack | -               |
| Retreat from a player's land | a quarter                   | -               |
