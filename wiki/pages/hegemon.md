---
title: The Hegemon
description: The Hegemon rules the Dark Star - a huge troop pool and a shadow tax, but no expansion. Strikes, tyranny, punitive strikes, gifts and the AI Hegemon explained.
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
- **Warheads,** fired from the centre of the Dark Star at the normal price, with no launcher and
  no reload. They are kept out by [[stargates-and-warheads#shield-array|Shield Arrays]] like
  anyone else's.
- **Destroyers** in the moat around the Dark Star, which defend it.
- **Gifts:** the Hegemon may build or upgrade any challenger building on any challenger's
  nebula, paying from its own gold. The building belongs to the host from the moment it is
  placed and cannot be refused. Gifts let the throne pick favourites, and a gift counts as the
  host's own build, so their next building costs them more.
- **Troop donations** to any challenger.

## Strikes

The strike is the Hegemon's attack. It picks any challenger tile and sends a share of its pool.
The strike flies visibly from the centre of the Dark Star on a warhead's arc, taking longer the
further it goes. On landing it takes the tile and fights outward like a landing.

- **Razing is expensive.** Each tile costs the strike {{raze}} times the troops, and takes
  {{raze}} times as long, as an ordinary conquest. One live strike per target at a time, any
  number of targets.
- **The bubble.** The nebula a strike holds is its bubble. Only the struck player may attack it:
  use Counter-attack, or click the bubble. It is defended by the strike's own troops, never the
  Dark Star's, so every tile retaken costs the strike. Buildings the bubble rolls over are
  captured, and destroyed when it pops unless their tile is retaken first.
- **The end.** A strike ends when its troops are spent, nothing is left in reach, the target is at
  the tyranny floor, it is recalled, or the Hegemon falls. Its bubble then pops and the nebula
  becomes neutral, free for anyone to take. A recall in flight brings the troops home whole; a
  recall on the ground pays the usual retreat loss.

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

Launching a warhead flags the launching Stargate for {{flag}} seconds. The Hegemon may answer by
clicking the gate:

- **The levy.** Every living challenger, the launcher included, is levied {{levyN}}% (Nuclear) or
  {{levyA}}% (Antimatter) of the troops they have at home.
- **The strike.** The levy lands on the gate as a strike that captures it and razes everything
  within {{pRadius}} tiles. There is no tyranny penalty and no recall.
- **The pop.** When nothing in reach is left the strike halts for {{halt}} seconds, then pops: the
  gate and every captured building are destroyed and the troops left over are burnt.

A player already under a punitive strike cannot be flagged again until it ends. Every warhead a
challenger fires is a gamble that the whole galaxy pays for.

## The AI Hegemon

When no human holds the throne, an AI plays it. The AI Hegemon:

- defends the disc;
- strikes the challenger with the largest troop capacity, once its own pool has sat at
  {{leveller}}% or more for a minute and that challenger's capacity is at least {{threat}}% of the
  Hegemon's ceiling. It aims at that challenger's highest-level Population Center;
- punishes every flagged Stargate launch, except from very small players;
- once an invader holds {{laststand}}% of the disc, sends everything above a {{reserve}}% reserve
  after them until they are evicted.

## Playing the Hegemon

- Your pool refills whatever you do, so troops sitting at full are troops wasted. Use strikes to
  keep the biggest challengers from snowballing.
- Strikes against small players are ruinous because of tyranny. Aim at the strong.
- The invasion slot admits one challenger at a time. A stalled invader is hit by your whole
  troop income automatically (see [[overthrowing-the-hegemon]]), and anyone may donate troops to
  the throne, so the challengers who are not invading may well help you.
- Gifts can build up a weak challenger as a rival to a strong one.
- Answer warhead launches. A punitive strike costs every challenger troops and wipes out the gate.
