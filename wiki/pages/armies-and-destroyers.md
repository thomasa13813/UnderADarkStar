---
title: Armies and Destroyers
description: Units in Under a Dark Star - Armies that defend your nebula against land attacks, Destroyers that patrol deep space, and how many of each you can field.
section: Challengers
order: 3
related: buildings, trade, overthrowing-the-hegemon, controls
---

Challengers field two kinds of unit, each supported by a building. Fleets (troops crossing deep
space) and Stargate shots are attacks, not units: see [[getting-started]] and
[[stargates-and-warheads]].

## Support: how many you may field

- Each level of a finished **Industrial Zone** supports {{armiesPerLevel}} **Army**.
- Each level of a finished **Spaceport** supports {{destroyersPerLevel}} **Destroyer**.
- With no support to spare, nothing new deploys.
- Losing support disbands nothing: the units you have stay, and no new one comes until you are
  back under the limit.
- Armies and Destroyers each cost 250k, rising with every one you own (500k, 750k, then 1M at the
  cap), counted separately.

The Hegemon's Destroyers and a pirate's corsair are not limited this way.

## Armies

**A defensive land unit that patrols your nebula and thins out attacks on you.**

- **Deploying.** Click your own nebula. The Army sets out from your nearest finished Industrial
  Zone, walks there through your territory and patrols within {{armyPatrol}} tiles of the spot.
- **Moving.** Click an Army to select it (Shift-drag to select several, Destroyers included),
  then click your own nebula to send it there. Armies never leave your territory and never cross
  deep space.
- **Firing.** When the front of an attack on you comes within {{armyRange}} tiles, an Army fires a
  shot over the nebula, at most once every {{armyReload}} seconds. If the attack is still going
  when the shot lands, **{{armyKill}}% of its troops die**. Several Armies each fire their own
  shots.
- **What counts.** Every land attack on you: players, Lords, Barons, fleets and Stargate shots
  once they have landed, and the Hegemon's strikes.
- **Only defence.** Armies never attack and never help an attack of yours.
- **Losing one.** An Army has no health. It is lost when the tile under it is taken (nobody
  captures it) or a warhead hits it.
- **Reports.** Every hit appears in both players' event panels: you see how many attacking troops
  your Army killed, the attacker how many they lost.
- On the map an Army is a pixel star in your colours; in the build bar it shows three rank
  chevrons. Hotkey <kbd>0</kbd>.

Lords (except on Easy) send their Armies to the front of a land attack and deploy new ones there.

## Destroyers

**A deep-space warship that patrols, raids and defends.**

- **Launching.** You need a Spaceport with a harbour on the body of space you click. The
  Destroyer launches from your harbour nearest the click and patrols the area.
- **What it does.** It captures enemy freighters in open deep space and destroys enemy fleets and
  Destroyers.
- **Experience.** Destroyers level up (up to level 3) by capturing freighters and destroying
  fleets and Destroyers. Each level adds damage and health.
- **Repair.** A Destroyer within 150 tiles of one of your harbours repairs over time; below 75%
  health it heads home. A spaceport docks as many Destroyers as its level and repairs them faster.
- **Control.** Attack-click a Destroyer to select it, then attack-click where it should go.
  <kbd>F</kbd> selects all of your Destroyers; Shift-drag selects several.

The Hegemon's Destroyers need no spaceport: it places them anywhere in deep space and moves them
like anyone's. They only defend: they sink fleets bound for the Dark Star, Destroyers that enter
the moat, and pirate corsairs anywhere, and they never take freighters. Only the moat repairs
them. One posted in the moat patrols it and sails to meet invasion fleets.

The Hegemon may also **donate an Army** to a challenger whose Industrial Zones have support to
spare, for a flat 250k: it becomes that player's own Army.
