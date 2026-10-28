---
title: The Hegemon
description: The Hegemon rules the Dark Star - a huge troop pool and a shadow tax, but no expansion. Strikes, tithes, punitive strikes, gifts and the AI Hegemon.
section: The throne
order: 1
related: overthrowing-the-hegemon, stargates-and-warheads, the-round, thrones
---

The Hegemon is the one asymmetric role in Under a Dark Star. It begins every round in a position
of extreme strength, holding the Dark Star at the centre of the map, but it **cannot grow**. Its
job is to survive the timer. Everyone else's job is to bring it down.

## Strength without growth

- **The troop pool.** The Hegemon starts with a full pool of troops sized from the map:
  {{ceiling}}% of what one player owning every nebula tile could field. The pool refills at a flat
  rate, empty to full in {{refill}} minutes, whatever its territory.
- **The shadow tax.** The Hegemon has no base income. Instead, every tick it earns {{tax}}% of
  everything the challengers earned that tick. Nothing is taken from anyone: the richer the
  galaxy, the richer the throne.
- **No expansion.** Nebula the Hegemon takes beyond the Dark Star is razed, not kept. The Dark
  Star is the only nebula it can ever own. It retakes lost Dark Star tiles by ordinary attack.
- **No buildings.** Nothing can be built on the Dark Star, and the Hegemon owns no structures
  anywhere.
- **No allies.** The Hegemon cannot ally with anyone, and it can only be eliminated by invasion.

## The Hegemon's tools

- **Strikes:** its attack on challenger territory (below).
- **Punitive strikes:** its answer to a warhead launch (below).
- **Tithes:** gold taken from everyone under an aimed ring (below).
- **Warheads,** fired from the centre of the Dark Star at the normal price, with no launcher and
  no reload. They are kept out by [[stargates-and-warheads#shield-array|Shield Arrays]] like
  anyone else's.
- **Destroyers** anywhere in deep space, which defend the Dark Star and hunt pirates (see
  [[armies-and-destroyers]]).
- **Gifts:** the Hegemon may build or upgrade any challenger building on any challenger's
  nebula, paying from its own gold. The building belongs to the host from the moment it is
  placed and cannot be refused. Gifts let the throne pick favourites, and a gift counts as the
  host's own build, so their next building costs them more.
- **Donations** of troops or gold to any challenger, reachable from anywhere, and **Armies** to
  any challenger whose Industrial Zones have support to spare (a flat 250k). Its handshake (the
  ally slot) holds **Gift**, **Donate army**, **Donate troops** and **Donate gold**.

## Strikes

The strike is the Hegemon's attack. It picks any challenger tile and sends a share of its pool.
The strike flies visibly from the centre of the Dark Star on a warhead's arc, taking longer the
further it goes. On landing it takes the tile and fights outward like a landing.

- **Razing is expensive.** Each tile costs the strike {{raze}} times the troops, and takes
  {{raze}} times as long, as an ordinary conquest. One live strike per target at a time, any
  number of targets.
- **The bubble.** The nebula a strike holds is its bubble. Nobody can take it back. Buildings
  the bubble rolls over are captured, and destroyed when it pops.
- **Counter-attack.** The struck player fights a landed strike by committing troops against it
  (Counter-attack, or a click on the bubble): they cancel the strike's troops one for one, or
  more than one for one when the strike is bigger than {{counterCeiling}}% of the target's troop
  ceiling. See [[combat#fighting-a-strike|Fighting a strike]].
- **The end.** A strike ends the moment it stops advancing: its troops are spent or cancelled,
  nothing is left in reach, the target is at the tyranny floor, it is called off, or the Hegemon
  falls. Its bubble then pops and, like an Antimatter Reaction, **erases** the nebula into deep
  space for good.
- **No troops come home.** A strike's troops are spent the moment it is launched. Calling it off,
  in flight or on the ground, stops the razing but returns nothing to the Dark Star.

Defense Posts and [[armies-and-destroyers|Armies]] work against strikes too. Shield Arrays do
not: a strike is troops, not a missile.

### Tyranny

The troop cost of a strike is multiplied by a penalty that depends only on the target's share of
the map's nebulae (Dark Star tiles excluded):

- No penalty against a player holding {{free}}% or more.
- Below that, the multiplier rises without limit.
- At {{floor}}% and below a player cannot be struck at all, and a strike that razes its target
  down to that floor ends.

The Hegemon can therefore never eliminate anyone. It can only cut the strong down to size.

## Punitive strikes

Launching a warhead flags the launching Stargate for {{flag}} seconds. The Hegemon is told in its
events feed and may answer with the line's **Strike** button, or by clicking the gate:

- **The levy.** Every living challenger, the launcher included, is levied {{levy}}% of the troops
  they have at home, whichever warhead was fired.
- **The strike.** The levy lands on the gate as a strike that captures it and razes everything
  within {{pRadius}} tiles. There is no tyranny penalty and no recall.
- **The pop.** When nothing in reach is left, or the gate's owner has cancelled it, the strike
  pops: the nebula it took is erased into deep space, the gate and every captured building are
  destroyed and the troops left over are burnt.

A player already under a punitive strike cannot be flagged again until it ends. Every warhead a
challenger fires is a gamble that the whole galaxy pays for.

## Tithes

The Hegemon may aim a **tithe** at any tile outside the Dark Star, from its Stargate menu (the
attack slot of the radial menu).

- **The flight.** The tithe flies from the centre of the Dark Star on a strike's arc, with a
  **ring of {{titheRadius}} tiles** drawn on the aim tile the whole way, so everyone can see where
  it will land. The throne hears its launch, and so does every player the ring touches.
- **The bill.** When it lands, every challenger (players, Lords and Barons alike) who owns **at
  least one tile within {{titheRadius}} tiles** of the landing pays the Hegemon **{{titheShare}}% of
  its gold above {{titheReserve}}**: a player holding 1M pays 250k. A player at or below
  {{titheReserve}} pays nothing.
- **Reckoned at landing.** What you hold when it comes down is what counts. See the ring and spend
  your gold, or give it away to anyone your Stargates reach, and you pay nothing. That is the
  point: gold is for spending, not hoarding.
- **Shields do not stop it.** A Shield Array's dome keeps out Gamma Ray Bursts, not tithes.
- **One at a time.** Only one tithe may be in flight; the next may be launched {{titheCooldown}}
  seconds after the last one lands. The menu shows the wait, who the ring would take from right
  now, and how much.
- **On top of the shadow tax.** Tithes are extra income; the {{tax}}% shadow tax still runs.

The limit is meant to be low: a player who hoards for a Shield Array or a warhead under the
throne's eye risks losing half of it.

## The AI Hegemon

When no human holds the throne, an AI plays it. The AI Hegemon:

- defends the disc;
- strikes the most threatening challenger, once its own pool has sat at {{leveller}}% or more for
  a minute and that challenger's troop capacity is at least {{threat}}% of the Hegemon's ceiling.
  Threat counts both the nebulae a challenger holds and its troop capacity; in team games a team's
  members count together, and the team's strongest member is struck. It aims at that challenger's
  highest-level Population Center;
- punishes every flagged Stargate launch, except from very small players;
- tithes once a minute from the round's second minute ({{titheAiFirst}} seconds in), whenever
  some challenger holds more than {{titheReserve}}, aimed at the one who would pay the most;
- once an invader holds {{laststand}}% of the disc, sends everything above a {{reserve}}% reserve
  after them until they are evicted.

## Playing the Hegemon

- Your pool refills whatever you do, so troops sitting at full are troops wasted. Use strikes to
  keep the biggest challengers from snowballing.
- Strikes against small players are ruinous because of tyranny. Aim at the strong.
- The invasion slot admits one challenger at a time. A stalled invader is hit by your whole
  troop income automatically (see [[overthrowing-the-hegemon]]), and anyone whose Stargate reaches
  the Dark Star may donate troops to the throne, so the challengers who are not invading may
  well help you. They may feed the invader through their gates too.
- Gifts can build up a weak challenger as a rival to a strong one.
- Answer warhead launches. A punitive strike costs every challenger troops and wipes out the gate.
- Tithe the hoarders. Aim where the rich crowd together, and watch them scramble to spend.
