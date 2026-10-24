---
title: Stargates, warheads and shields
description: Stargates fire troops and launch warheads in Under a Dark Star. Nuclear and Antimatter Warheads, Shield Arrays, and the punitive strike every launch risks.
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

| Warhead                | Price        | Blast radius |
| ---------------------- | ------------ | ------------ |
| **Nuclear Warhead**    | {{nukeCost}} | 30 tiles     |
| **Antimatter Warhead** | {{hCost}}    | 100 tiles    |

- **Launch.** A warhead launches from **the nearest ready Stargate whose range covers the
  target**, and spends that gate's charge. With none, there is no launch. A warhead reaches only
  as far as a gate does, so range upgrades buy reach for warheads too.
- **The blast** destroys territory, buildings, ships and fleets, the launcher's own included.
  Every building in the blast is destroyed outright, all levels.
- **The Dark Star** is immune: warheads do nothing to its tiles.
- **The Hegemon** fires warheads from the centre of the Dark Star, with no gate and no reload.
- Warheads cannot be recalled once launched.

### The price of firing: punitive strikes

Every launch flags its gate for {{flag}} seconds. In that window the Hegemon may answer with a
**punitive strike**: every living challenger, the launcher included, is levied {{levyN}}%
(Nuclear) or {{levyA}}% (Antimatter) of the troops they have at home, and the levy lands on the
gate as a strike that captures it and razes everything within {{pRadius}} tiles. When it pops, the
gate and every building it captured are destroyed. See [[hegemon#punitive-strikes]].

An AI Hegemon punishes every launch except from very small players.

## Shield Array

**No other player's warhead can harm anything within {{shieldR}} tiles of it.**

- **Price.** {{shieldCost}} gold, one level, no upgrades. {{shieldBuild}} seconds to build, and it
  protects nothing until it is finished.
- **What it stops.** When another player's warhead lands, the blast does nothing inside the
  perimeter: no nebula lost, no troops killed, no building destroyed. The ground outside is
  cleared as usual. A Nuclear Warhead aimed at the array itself does nothing; an Antimatter
  Warhead clears only the ring beyond the perimeter.
- **The Hegemon's warheads** are kept out like anyone's.
- **What gets through.** Troops, not missiles: the Hegemon's strikes and every Stargate shot land
  inside. Your own warheads are not kept out either.
- **Capture.** The array shelters itself, so only conquest or the Hegemon's strike removes it. A
  captured array shields its new owner.
