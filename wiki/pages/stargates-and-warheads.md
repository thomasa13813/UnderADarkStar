---
title: Stargates, warheads and shields
description: Stargates fire troops and warheads in Under a Dark Star: the Gamma Ray Burst, the Antimatter Reaction, Shield Arrays and punitive strikes.
section: Challengers
order: 4
related: buildings, hegemon, overthrowing-the-hegemon, galaxy
---

## Stargates

**A Stargate fires your troops at any tile in range that is not yours.**

- **Price.** {{gateCost}} gold, new or per upgrade. The price never climbs and there is no level
  cap.
- **Range.** {{gateBase}} tiles at level 1, **+{{gatePer}} per level**. Levels buy range only.
- **Reload.** One charge, then a {{gateReload}}-second reload. A troop shot and a warhead launch
  spend the same charge.
- **The shot** takes your attack ratio's share of your troops. It flies an arc and lands like a
  fleet: it takes the tile and fights outward, and the nebula is kept. If the tile became yours or
  a friend's in flight, the troops simply join.
- **Nothing stops a shot.** No defence intercepts it, and Shield Arrays do not keep it out. A shot
  in flight can be recalled, troops home whole.
- **The Dark Star.** A shot may land on the Dark Star, under the single-invader rule (see
  [[overthrowing-the-hegemon]]). Gates are the late-game road to the throne: they skip the moat.

A gate is the way past a front you cannot break, onto a coast your fleets cannot reach, and onto
the Dark Star itself.

## Warheads

| Warhead                 | Price       | Radius              | What it does                                                   |
| ----------------------- | ----------- | ------------------- | -------------------------------------------------------------- |
| **Gamma Ray Burst**     | {{grbCost}} | {{grbRadius}} tiles | Clears the nebula, kills troops and buildings; shields stop it |
| **Antimatter Reaction** | {{arCost}}  | {{arRadius}} tiles  | **Erases** the nebula into deep space; shields stop it         |

- **Launch.** A warhead launches from **the nearest ready Stargate whose range covers the
  target**, and spends that gate's charge. With none, there is no launch. A warhead reaches only
  as far as a gate does, so range upgrades buy reach for warheads too.
- **The blast** destroys territory, buildings, ships and fleets, the launcher's own included.
  Every building in the blast is destroyed outright, all levels.
- **A Gamma Ray Burst** leaves the ground behind as neutral, irradiated nebula. **An Antimatter
  Reaction** leaves deep space: the ground is gone for good, and fleets can cross where it was.
  [[#shield-array|Shield Arrays]] keep both out.
- **The Dark Star** is immune: warheads do nothing to its tiles.
- **The Hegemon** fires warheads from the centre of the Dark Star, with no gate and no reload.
- Warheads cannot be recalled once launched.

### The price of firing: punitive strikes

Every launch flags its gate for {{flag}} seconds. In that window the Hegemon may answer with a
**punitive strike**: every living challenger, the launcher included, is levied {{levy}}% of the
troops they have at home, whichever warhead was fired, and the levy lands on the
gate as a strike that captures it and razes everything within {{pRadius}} tiles. When it pops, the
nebula it took is erased into deep space, and the gate and every building it captured are
destroyed. See [[hegemon#punitive-strikes]].

An AI Hegemon punishes every launch except from very small players.

## Shield Array

**It keeps every other player's warheads off everything within {{shieldR}} tiles per level, up to
{{shieldMaxR}} at level {{shieldMaxLevel}}.**

- **Stands on its own.** A Shield Array is a building of its own, placed like any other. It is
  not a Defense Post and gives no post's defence: pair it with a post if you want both.
- **Levels.** A new array shields {{shieldR}} tiles; each upgrade adds {{shieldR}}, up to
  {{shieldMaxR}} tiles at level {{shieldMaxLevel}}, the top.
- **Price.** Each level, a new array or an upgrade, costs by how many Shield Array levels you
  already own: {{shieldCost1}} for the first, {{shieldCost2}} for the second, {{shieldCost3}}
  for every one after. {{shieldBuild}} seconds to build, and a new array shields nothing until
  it is finished.
- **What it stops.** When another player's warhead lands, Gamma Ray Burst or Antimatter
  Reaction, the blast does nothing inside the shield: no nebula lost or erased, no troops killed,
  no building destroyed. The ground outside is hit as usual. A warhead aimed at the array itself
  still clears the ring between the shield's edge and its own blast's edge (Gamma Ray Burst
  {{grbRadius}} tiles, Antimatter Reaction {{arRadius}}): from level 2 an Antimatter Reaction
  aimed at the array does nothing at all, and at level {{shieldMaxLevel}} a Gamma Ray Burst does
  nothing either. The Hegemon's warheads are kept out like anyone's; your own are not.
- **What gets through.** Troops: the Hegemon's strikes and every Stargate shot land inside, and
  conquest takes the array. And the Hegemon's tithes.
- **Captured intact.** A Shield Array taken by conquest is captured, shield and all, and protects
  its new owner.
