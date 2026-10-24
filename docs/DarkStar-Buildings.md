<!--
  Maintainers: this page is written for players and is meant to be publishable as-is (site / wiki).
  Keep code names, internal notes and attribution out of it. The levers behind every number, the
  audit notes and the changelog are in docs/DarkStar-Buildings-Levers.md. When a building's number
  or behaviour changes in Config.ts, update both files in the same commit.
-->

# Under a Dark Star — Buildings

Buildings turn territory into power. This page covers every building a challenger can raise in
Under a Dark Star: what it does, what it costs, what each level adds, and how it is lost.

Troop numbers are as shown in game. One second of game time is ten ticks.

## 1. At a glance

| Building              | Cost                                                            | Build time | Upgrades    | What one level gives                                                                                                          |
| --------------------- | --------------------------------------------------------------- | ---------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Population Center** | 125k → 250k → 500k → 1M (cap)                                   | 2 s        | Yes, no cap | +25,000 max troops; a paying stop for supply deliveries                                                                       |
| **Industrial Zone**   | 125k → 250k → 500k → 1M (cap), **count shared with Spaceports** | 2 s        | Yes, no cap | Starts a trade network; each level is one more chance to send a supply delivery and supports one Army                         |
| **Spaceport**         | as the Industrial Zone, **same shared count**                   | 5 s        | Yes, no cap | Sends freighters; each level is one more chance to send one, one more docking berth and +5 repair, and supports one Destroyer |
| **Defense Post**      | 50k → 100k → 150k → 200k → 250k (cap)                           | 5 s        | No          | Within 30 tiles, attackers lose 5× the troops and advance 3× slower                                                           |
| **Stargate**          | 500k flat, new or per upgrade                                   | 10 s       | Yes, no cap | Range 180 at level 1, +75 per level; fires troops or warheads, 5 s reload                                                     |
| **Shield Array**      | 2M flat                                                         | 10 s       | No          | No other player's warhead harms anything within 40 tiles                                                                      |

## 2. Rules every building follows

### 2.1 Placing

- You build on **your own nebula**. The building snaps to the free tile nearest your click, up to
  15 tiles away through your own territory.
- **Spacing:** no building may stand within 15 tiles of **any** other building, yours or anyone
  else's, finished or not.
- **Nothing is ever built on the Dark Star**, not even by an invader holding its tiles. The
  Hegemon builds nothing of its own anywhere; it can only gift (§2.7).
- **Clicking near one of your own buildings of the same type upgrades it** instead of placing a
  second one. "Near" means within 15 tiles.
- You cannot build during the spawn phase.
- There is no limit on how many of any building you may own.

### 2.2 Prices climb

Population Centers, Industrial Zones, Spaceports and Defense Posts get dearer the more you have.
Stargates and Shield Arrays never do.

- **The count is levels, not buildings.** A level-3 Population Center counts three, so upgrading
  costs the same as building new at that count. The first upgrade of your only Population Center
  costs 250k.
- **Spaceports and Industrial Zones share one count.** With one of each, the next of either
  costs 500k.
- **A building still under construction counts one.**
- **Captured buildings do not raise your prices.** Only what you built or upgraded yourself
  counts.
- **Losing buildings lowers your prices again**, whether they were destroyed, captured or deleted.
- Prices stop climbing at the cap: 1M for the three economic buildings, 250k for Defense Posts.

### 2.3 Building and upgrading

- **Gold is paid up front.** The building appears at once, under construction.
- **A building under construction does nothing.** It adds no troops, gives no defence bonus,
  sends nothing, launches nothing, shields nothing, and cannot be upgraded. It still blocks the
  15-tile spacing.
- **Upgrades are instant.** There is no construction time for a new level.
- You can buy up to 50 levels in one order. Each step is priced at the climbing count, and the
  order stops at the first step you cannot afford.
- There is **no level cap** on any upgradable building.
- There is **no cancel and no refund**.

### 2.4 Deleting your own building

- You may delete one of your buildings **once every 30 seconds**. It is marked, and it disappears
  30 seconds later with all its levels. There is **no refund**.
- A marked building cannot be upgraded, and a marked Spaceport no longer trades or serves
  Destroyers.
- If an enemy captures the tile first, the deletion is cancelled and they keep the building.

### 2.5 Losing a building

- **Conquest:** when an enemy takes the tile, they **capture** the building with every level
  intact. A half-built building keeps building, for them. **A Defense Post is the exception: it is
  destroyed, not captured.**
- **Neutral ground:** a building on a tile that becomes nobody's is destroyed.
- **Elimination:** all your buildings are destroyed.
- **Warheads:** everything within the blast's outer radius is destroyed outright, all levels,
  whoever owns it, the launcher's own included (Nuclear 30 tiles, Antimatter 100). The only
  exception is a building inside another player's Shield Array (§3.6).
- **The Hegemon's strike:** a strike's bubble captures the buildings it rolls over (posts are
  destroyed). Retake the tile while the bubble lasts and you get the building back, levels
  intact. When the bubble pops, whatever buildings it still holds are destroyed.
- Buildings have no health. Nothing else damages them.

### 2.6 Lords and Barons

Lords build with the same rules and prices as you (§6). Barons do not build.

### 2.7 Gifts from the Hegemon

The Hegemon may place any building a challenger could build on any challenger's territory (Barons
included), or upgrade one already there. It pays from its own gold, and the host cannot refuse.

- **The Hegemon always pays the first-building price**, for every level: 125k for a Population
  Center, Industrial Zone or Spaceport, 50k for a Defense Post, 500k for a Stargate, 2M for a
  Shield Array.
- **The gift counts as the host's own build**, so the host's next one costs them more.
- A gift follows every placement rule of §2.1 and is under construction like any build.

## 3. The buildings

### 3.1 Population Center

**Raises your troop ceiling.**

- Each level adds **+25,000 max troops**. Levels add up: a level-4 center is +100,000.
- **Your ceiling without centers** is about `200 × tiles^0.6 + 10,000`. A few points:
  - 1,000 tiles gives about 22,600.
  - 10,000 tiles gives about 60,200.
  - 50,000 tiles gives about 135,000.
- **For a small or blocked player, one center is a very large share of the ceiling.** At 1,000
  tiles a single level more than doubles it.
- A center adds no troops per second directly. Troops regrow faster the further you are below
  your ceiling, so a higher ceiling keeps regrowth up for longer.
- **A trade stop.** A center within 110 tiles of an Industrial Zone (anyone's) joins the trade
  network, and every supply delivery passing through it pays gold (§3.2). Its level does not
  change the payment.
- **A target.** The Hegemon weighs challengers by their troop ceiling. An AI Hegemon's levelling
  strike aims at the strongest challenger's **highest-level** Population Center.
- **Lords:** the ceiling is scaled by difficulty (Easy ×0.5, Medium ×0.75, Hard ×1,
  Impossible ×1.25). **Barons:** ÷3. **The Hegemon:** centers do not apply; its ceiling is fixed
  for the round.

### 3.2 Industrial Zone

**Builds a trade network and sends supply deliveries along it.**

- **The network.** When finished, the zone links by straight trade lanes to Population Centers,
  Spaceports and other Industrial Zones within 110 tiles (but more than 15), anyone's.
  - **A lane is a straight line.** It fails if it crosses void, the Dark Star's disc, or open
    deep space. Only a narrow strait of shoreline space can be crossed, and each space tile on it
    counts as six toward the ~155-tile length limit.
  - **No duplicate links.** A station does not link to one it can already reach in three hops or
    fewer.
  - **Snapping.** A building placed on an existing lane (within 3 tiles) splits it and joins.
  - **Late joiners.** A Population Center joins only if an Industrial Zone is within 110 tiles
    when it is finished, or one is built near it later. A Spaceport keeps checking until it joins.
- **Supply deliveries.** Only Industrial Zones send them.
  - **Odds.** Each zone gets one chance a second **per level** (§5.1 has the odds).
  - **Needs a paying stop.** A zone with no Population Center or Spaceport on its network, or none
    it may trade with, sends nothing.
  - **Route.** A delivery picks a random Population Center or Spaceport on its network and travels
    there by the fewest stops.
- **Gold is paid at every Population Center and Spaceport the delivery passes**, the destination
  included. Industrial Zones on the route pay nothing.

  | Stop belongs to                | The delivery's owner gets | The stop's owner gets |
  | ------------------------------ | ------------------------- | --------------------- |
  | You                            | 10,000                    | —                     |
  | A teammate or a neutral player | 25,000                    | 25,000                |
  | An ally                        | 35,000                    | 35,000                |
  - **Long routes still pay.** From the 11th paying stop on a route, each pays 5,000 less than
    the last, down to a floor of 5,000.
  - **No embargoes.** A delivery never pays at, or travels to, a player either side has stopped
    trading with. It ends where the next stop is barred.

- **Armies.** Each level of a finished zone supports one Army (§3.8).
- **Level** means more deliveries (not more gold per delivery) and one more Army.
- **More zones, each a little slower.** Each extra zone you own makes every one of your zones
  slightly less likely to send. Total output still grows, but less than proportionally (§5.1).

### 3.3 Spaceport

**Sends freighters to other players' spaceports, and launches and repairs Destroyers.**

- **Placed anywhere in your territory**, like a Population Center. Its **harbour** is the nearest
  deep space reachable over nebula, within 250 tiles, never across the Dark Star's disc. It keeps
  one harbour per body of space at that distance. A spaceport with no deep space within 250 tiles
  has no harbour: it cannot trade or serve Destroyers, but it is still a paying stop on a trade
  network.
- **Freighters.**
  - **Odds.** Every second each finished spaceport gets one chance **per level** to send a
    freighter. The odds rise after every miss (§5.2).
  - **Where they go.** A freighter sails to another player's spaceport that shares a body of
    space. **You never trade with yourself**, and never with a player either of you has stopped
    trading with. Destinations are weighted (§5.2): further than 300 tiles, among the nearest
    third, and friendly (ally or teammate) each add weight.
  - **The voyage.** It crawls overland at half speed to its harbour, crosses space at full speed,
    and crawls in at the far end.
- **Gold.** On arrival **both spaceports' owners receive the full payment**, set by the tiles
  travelled (nebula and space alike):

  | Tiles             | ~100  | ~200   | 300    | ~500   | ~1,000  |
  | ----------------- | ----- | ------ | ------ | ------ | ------- |
  | Gold to each side | 5,200 | 13,600 | 52,500 | 99,800 | 125,000 |

  Short hauls pay very little: the payment rises steeply around 300 tiles, then grows by 50 a
  tile.

- **Raiders.** A Destroyer can capture a freighter only in open deep space, never while it is on
  nebula or has touched shoreline space in the last 2 seconds. A captured freighter pays only its
  captor, at the captor's nearest spaceport. A freighter caught by the Hegemon's Destroyers is
  simply lost. A pirate corsair scuttles it.
- **Destroyers.** You need a spaceport with a harbour on the body of space you click. A Destroyer
  launches from your harbour nearest the click and costs 250k → 500k → 750k → 1M (cap).
  - **One per level:** each level of a finished spaceport supports one Destroyer. With none to
    spare you cannot launch another. Losing a spaceport sinks nothing: the Destroyers you have
    stay, and you launch no more until you are back under your limit.
  - **Repair:** a Destroyer within 150 tiles of one of your harbours repairs 1 health a tick. Below
    75% health it heads home.
  - **Docking:** a spaceport docks as many Destroyers as its level, sharing an extra 5 health a
    tick per level.
- **Level** means more freighters, more berths, faster repair, and one more Destroyer.
- **Shared price count with Industrial Zones** (§2.2).

### 3.4 Defense Post

**Makes the ground around it expensive to take.**

- When an enemy conquers a tile within **30 tiles** of your finished post, the attacker loses
  **5× the troops** on that tile and the attack spends **3× its effort** there, so the front moves
  about a third as fast.
- **On or off.** A tile is covered or it is not: **several posts do not stack**, and posts
  cannot be upgraded.
- **Your posts defend your nebula only.** An ally's post does not cover your tiles, and a post
  does nothing for unclaimed nebula.
- The post works against **the Hegemon's strikes** too.
- **Fragile.** A post is **destroyed the moment its own tile falls**; nobody captures it.
- A post does not shoot.

### 3.5 Stargate

**Fires troops or warheads at any tile in range.**

- **Range:** 180 tiles at level 1, **+75 per level** (255, 330, 405 …). No level cap. **Level
  buys range only**; the reload and the charge never change.
- **One charge, then a 5-second reload.** A troop shot and a warhead launch spend the same
  charge.
- **Troop shots.**
  - **Size and target.** The shot takes your attack ratio's share of your troops at launch, and
    may target any tile that is not yours, neutral nebula included.
  - **Landing.** It flies an arc and lands like a fleet: it takes the tile and fights outward, and
    the nebula is kept. If the tile became yours or a friend's in flight, the troops simply join.
  - **Recall.** A shot in flight can be recalled, troops home whole.
  - **The Dark Star.** A shot may land on the Dark Star, under the single-invader rule. It is
    refused at launch while another challenger holds the slot, and it turns back if the slot is
    taken in flight.
  - **Nothing stops a shot.** No defence intercepts it, and Shield Arrays do not keep it out.
- **Warheads.** A Nuclear (1M) or Antimatter (5M) Warhead launches from **the nearest ready
  Stargate whose range covers the target**. With none, there is no launch. Every launch flags the
  gate for a **punitive strike** for 30 seconds (§3.7).
- **Price** never climbs: 500k for a new gate, 500k per level.

### 3.6 Shield Array

**Keeps warheads off everything within 40 tiles.**

- **What it stops.** When **another player's** warhead lands, the blast does nothing inside the
  40-tile perimeter: no nebula lost, no troops killed, no building destroyed. The ground outside
  the perimeter is cleared as usual.
  - **Small warheads.** A Nuclear Warhead (radius 30) aimed at the array itself does nothing.
  - **Large warheads.** An Antimatter Warhead (radius 100) clears only the ring from 40 to 100.
- **The array shelters itself**, so short of conquest or the Hegemon's strike nothing removes it.
- **What gets through.** The Hegemon's warheads are kept out like anyone's. The Hegemon's strikes
  and every Stargate shot (troops, not missiles) pass through and land inside. **Your own**
  warheads are not kept out.
- **Construction and capture.** Nothing is protected while it is under construction. A captured
  array shields its new owner.
- **Price.** One level, 2M flat, no upgrades.

### 3.7 The cost of firing: punitive strikes

A warhead launch flags its Stargate for 30 seconds. In that window the Hegemon may answer:

- **The levy.** Every living challenger, the launcher included, pays a share of the troops they
  have at home: 10% for a Nuclear, 25% for an Antimatter.
- **The strike.** The levy lands on the gate as a strike that captures it and razes everything
  within 34 tiles.
- **The pop.** When the strike pops, the gate and every building it captured are destroyed.

An AI Hegemon punishes every flagged launch except from very small players (under 5% of the
nebula).

### 3.8 Armies

Not a building, but every one is supported by an Industrial Zone.

**A defensive unit that patrols your nebula and thins out attacks on you.**

- **Supported by Industrial Zones:** each level of a finished zone supports one Army. With none
  to spare you cannot deploy another. Losing a zone disbands nothing; you deploy no more until you
  are back under your limit.
- **Cost:** 250k → 500k → 750k → 1M (cap), counted separately from Destroyers.
- **Deploying:** click your own nebula. The Army sets out from your nearest finished Industrial
  Zone, walks there through your territory and patrols within 40 tiles of the spot, resting
  between moves.
- **Moving:** click an Army to select it (Shift-drag to select several, Destroyers included), then
  click your own nebula to send it there. Armies never leave your territory and never cross deep
  space.
- **Firing:** when the front of an attack on you comes within 40 tiles, an Army fires a shot over
  the nebula, at most once every 10 seconds. If the attack is still going when the shot lands,
  **5% of its troops die**. Several Armies each fire their own shots. Every land attack counts:
  players, Lords, Barons, fleets and Stargate shots once they have landed, and the Hegemon's
  strikes.
- **Only defence:** Armies never attack and never help an attack of yours.
- **Losing one:** an Army has no health. It is lost when the tile under it is taken (nobody
  captures it) or a warhead hits it.
- **Hotkey:** 0.

## 4. Income compared

Working numbers at the default gold rate:

- **Base income:** every challenger earns **6,000 gold a second** (60,000 a minute); Barons half
  that. The Hegemon earns no base income.
- **The shadow tax:** the Hegemon receives 3% of all gold every challenger gains, on top. Nothing
  is taken from the challengers.
- **One delivery** on your own network with three of your own Population Centers on the route
  pays 30,000. The same route through a neighbour's three centers pays 75,000 to you and 75,000
  to them; through an ally's, 105,000 each.
- **One freighter** on a 300-tile route pays 52,500 to each side.

## 5. Odds in detail

### 5.1 Supply deliveries

Each finished Industrial Zone, at most once a second, rolls once per level with a chance of
`1 / rate`:

- `rate = (zones you own + 10) × 15 ÷ crowding`.
- **Crowding** depends on how many supply deliveries are under way in the whole galaxy. It
  favours the first deliveries (up to 1.5×), then damps the odds once the galaxy is busy, down to
  a quarter at most.

In an empty galaxy:

- **One level-1 zone** sends about one delivery every 11 s.
- **Five level-1 zones** send about one every 15 s each, one every 3 s in total.

### 5.2 Freighters

Every second each finished Spaceport rolls once per level with a chance of `1 / rate`:

- `rate = 100 ÷ (misses since its last freighter + 1) ÷ crowding`.
- **Crowding** depends on how many freighters are at sea in the whole galaxy. It favours the
  first few hundred (up to 1.45×), then damps the odds once space is busy.
- **Destination weighting.** Every eligible spaceport is entered once per level of the sending
  port. It is entered as many times again if it is at least 300 tiles away and among the nearest
  third, and as many again if it is at least 300 tiles away and belongs to an ally or teammate.
  One entry is drawn at random.

## 6. How Lords build

Lords run through these checks in order:

1. **Under land attack** (not on Easy): they send their Armies to the front of the largest
   attack and deploy a new one there if a zone supports it.
2. **Under heavy land attack** (incoming at least 35% of their troops): Defense Posts near the
   front, and nothing else. Easy Lords never build them; Medium ones half the time, one post; Hard
   and Impossible ones several.
3. **On a crowded map, first building:** a Spaceport, or an Industrial Zone without a coast.
4. **Ready for the throne:** they upgrade the Stargate that falls least short of the moat (up to
   level 5), or build one towards the Dark Star.
5. **By ratio to their Population Centers:**
   - Spaceports 0.75 per center.
   - Industrial Zones 0.75 per center, or about 0.25 per center with a coast.
   - Stargates: the first at 0.4 per center, then 0.1–0.25 per center by difficulty, **at most
     three**.
6. **Otherwise a Population Center.**

Other habits:

- **Upgrades.** Past one building per 1,500 tiles they upgrade rather than build.
- **Saving up.** They save towards warheads, and every building they own makes the next one look
  dearer to them.
- **Destroyers.** They build Destroyers occasionally once they have a spaceport, within the same
  one-per-level limit.
- **Never built:** Lords never build Shield Arrays.
