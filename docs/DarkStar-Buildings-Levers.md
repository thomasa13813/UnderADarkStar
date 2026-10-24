# Buildings — levers, audit notes, changelog

The maintainer's companion to `docs/DarkStar-Buildings.md` (the player-facing reference, kept
publishable: no code names, no internal notes). This file holds where every number lives, the
audit's findings and the changelog for both files. When a building's number or behaviour changes,
update both files in the same commit.

Troops: the sim stores troops ten times what the screen shows (`renderTroops` divides by 10). The
player page gives screen values; this table gives sim values where they differ.

## 1. Where each lever lives

All in `src/core/configuration/Config.ts` unless stated.

| Lever                                               | Where                                                                               | Value                                                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Population Center, Industrial Zone, Spaceport price | `unitInfo` (`City`, `Factory`, `Port`)                                              | `min(1M, 125k × 2^n)`; Port and Factory share `n`                                                                                |
| Defense Post price                                  | `unitInfo` (`DefensePost`)                                                          | `min(250k, 50k × (n+1))`                                                                                                         |
| Stargate                                            | `STARGATE_DEFAULTS`                                                                 | 500k, 10 s, range 180 +75/level, reload 5 s                                                                                      |
| Shield Array                                        | `SHIELD_ARRAY_DEFAULTS`                                                             | 2M, 10 s, radius 40                                                                                                              |
| Build times                                         | `unitInfo`                                                                          | City / Factory 20 ticks; Port / DefensePost 50; Stargate / ShieldArray 100                                                       |
| Price count                                         | `costWrapper`                                                                       | `Σ min(unitsOwned, unitsConstructed)`; levels count; gift = `costFn(0)`                                                          |
| Troops per center level                             | `cityTroopIncrease`                                                                 | 250,000 (25,000 shown)                                                                                                           |
| Max troops                                          | `maxTroops`                                                                         | `2 × (tiles^0.6 × 1000 + 50,000) + Σ City levels × 250k`; Lord ×0.5–1.25, Baron ÷3                                               |
| Defense Post                                        | `defensePostRange` / `defensePostDefenseBonus` / `defensePostSpeedBonus`            | 30 / ×5 / ×3, applied in `attackLogic`                                                                                           |
| Spacing, snap radius                                | `structureMinDist`; `PlayerImpl.validStructureSpawnTiles`                           | 15 / 15                                                                                                                          |
| Upgrade-instead-of-build radius                     | `PlayerImpl.findExistingUnitToUpgrade`                                              | 15                                                                                                                               |
| Bulk upgrade                                        | `MAX_UPGRADE_AMOUNT` (`Game.ts`)                                                    | 50                                                                                                                               |
| Delete cooldown, delete delay                       | `deleteUnitCooldown`, `deletionMarkDuration`                                        | 300 / 300 ticks                                                                                                                  |
| Trade lane range                                    | `trainStationMinRange` / `trainStationMaxRange` / `railroadMaxSize`                 | 15 / 110 / 155.6; space tile cost 6 (`TradeLane.ts`); 3-hop dedupe (`RailNetworkImpl.ts`)                                        |
| Supply delivery odds                                | `trainSpawnRate`, `trainSaturation`; 10-tick cooldown in `TrainStationExecution.ts` | `max(1, floor((F+10)×15 / saturation(U)))`, U = Train units galaxy-wide                                                          |
| Supply delivery gold                                | `trainGold`                                                                         | 10k self, 25k team/other, 35k ally; −5k per stop past 10, floor 5k                                                               |
| Freighter odds                                      | `tradeShipSpawnRate`, `tradeShipSaturation`; `PortExecution.ts`                     | `max(1, floor(100/(rejections+1) / saturation(N)))`, checked every 10 ticks                                                      |
| Freighter gold                                      | `tradeShipGold`, `tradeShipShortRangeDebuff`                                        | `75k / (1 + e^(−0.03(d−300))) + 50d`, to both ports' owners                                                                      |
| Harbour reach                                       | `harbourMaxRange`                                                                   | 250                                                                                                                              |
| Overland freighter speed                            | `freighterLandTicksPerTile`                                                         | 2                                                                                                                                |
| Destroyer repair                                    | `warshipPassiveHealing*`, `warshipPortHealingBonusPerLevel`                         | 1/tick within 150 of a harbour; docked: `level` berths, `5 × level`/tick shared                                                  |
| Warheads                                            | `unitInfo`, `nukeMagnitudes`                                                        | Nuclear 1M, radius 12/30; Antimatter 5M, radius 80/100                                                                           |
| Punitive strike                                     | `HEGEMON_DEFAULTS` `punitive*`                                                      | flag 30 s, levy 10% / 25%, radius 34, halt 5 s, AI skips under 5% of land                                                        |
| Units supported                                     | `UNIT_SUPPORT_DEFAULTS`; `PlayerImpl.unitSupport`                                   | 1 Destroyer per finished Port level, 1 Army per finished Factory level; Hegemon and corsair uncapped; nothing disbands           |
| Army                                                | `ARMY_DEFAULTS`; `ArmyExecution.ts`                                                 | patrol 40, 1 tick/tile, shot range 40, cooldown 10 s, shot speed 3, casualties 5%; cost `min(1M, 250k × (n+1))` on its own count |
| Lord armies                                         | `NationStructureBehavior.handleArmies`                                              | not on Easy; move armies to the largest land attack's front, deploy one if supported                                             |
| Lord build order and ratios                         | `src/core/execution/nation/NationStructureBehavior.ts`                              | see the player page §6                                                                                                           |

## 2. Audit, 2026-10-23

Notes for Tom, not decisions.

### 2.1 Player-facing text that is wrong or missing (`resources/lang/en.json`)

- **`build_factory_desc` is wrong in two places.**
  - It says a delivery gives gold "for each building they visit". Industrial Zones pay nothing;
    only Population Centers and Spaceports do.
  - It says the network "can also link up with friendly neighbors". It links with **any**
    neighbour's stations; only embargoes stop the pay.
- **`build_city_desc` ("Increases your max population") gives no number** (+25,000 a level) and
  does not say a center is a paying trade stop.
- **`build_defense_desc` gives no numbers.** It does not say that posts do not stack, cannot be
  upgraded, and are destroyed (not captured) when their tile falls.
- **What a level does is told nowhere, for any building.**
  - A Population Center level is +25k troops.
  - An Industrial Zone level is more deliveries.
  - A Spaceport level is more freighters, berths and repair.
  - The Stargate is the one building whose description gives this.
- **Shared price count and gift pricing are never told.** Nothing tells players that Spaceports
  and Industrial Zones share a price count, that upgrades count as builds, or that losing
  buildings lowers prices. Nor do players learn that a Hegemon gift raises their own next price.
- **`build_port_desc` says trade gives "gold to both sides"**, which is right, but does not say
  that you never trade with yourself or that short routes pay almost nothing.

### 2.2 Behaviour worth a look (possible balance levers)

- **Upgrades are instant; new buildings take 2–10 s.** Stacking levels on one building is faster
  and safer than spreading out, and the upgrade-on-click radius pushes players that way.
- **Defense Posts do not stack and die on capture.** At 50k–250k a post is the cheapest building,
  but its value is all-or-nothing per tile.
- **Supply deliveries pay per stop, for up to ten full-price stops.**
  - **Dense networks.** A dense, neighbour-rich network multiplies income per delivery.
  - **Neighbours pay more than yourself.** Linking with neighbours pays 2.5× (3.5× allied) what
    your own stops pay, and pays them the same.
- **The Population Center is the leveller's target.** It is the one building an AI Hegemon aims
  at, so building one tall center invites the strike there.
- **A Spaceport with no harbour still earns** as a trade-network stop.
- **Lords never build Shield Arrays** (open item F21), so the 2M array is a human-only defence.

### 2.3 Stale documents and comments

- **Design doc §6.10** still says a Stargate's level cap is 5. There is no cap since 2026-09-30
  (C4 is right).
- **Design doc §6.19** says a delivery on a lane that gets split is dropped. The code re-routes
  it when the new lane follows the same tiles, and drops it only otherwise.
- **`HEGEMON_DEFAULTS.punitiveRadius` (34)** sits under a comment calling it "the Nuclear
  Warhead's outer blast radius", which is 30.
- **The shadow-tax comment** in `HEGEMON_DEFAULTS` lists only earned gold. Gold **donated**
  between challengers is taxed too, because the donation goes through `addGold`.
- **`DefensePostExecution.ts`** keeps its ship-targeting code commented out, and
  `defensePostTargettingRange` / `defensePostShellAttackRate` are unused.

## 3. Changelog

- **2026-10-23** — Army look and newsfeed (Tom).
  - **Map sprite:** a pixel star in the destroyer's banding: territory-colour rim, border-colour
    body, centre accent. It is 11 px like the destroyer, with its bounding box centred so it sits
    in the middle of the selection box.
  - **Icon:** the hotbar, menu and help icon is three rank chevrons (`ArmyIconWhite.svg`).
  - **Newsfeed:** each hit messages the owner (`events_display.army_hit`) and the attacker
    (`army_hit_taken`).
  - **Fixed:** a duplicate `UT_ARMY` in `UnitPass.UNIT_ORDER` (and a stray entry in
    `MISSILE_TYPES`) made the shader split the atlas into 15 columns instead of 14. Every unit
    sprite was sampled off by a fraction of a cell: armies drew as the projectile glyph, and
    destroyers sat beside their selection box. `tests/client/render/gl/UnitAtlasOrder.test.ts` now
    pins the column count to the atlas.
- **2026-10-23** — Armies and fleet support (Tom).
  - Each spaceport level supports one Destroyer, and each Industrial Zone level one Army. Losing
    support disbands nothing.
  - The Army is a new defensive land unit, `UnitType.Army` (appended). It is moved by the
    destroyer's `move_warship` order. Its shot reuses the `Shell` sprite.
  - It has a pixel-star sprite (`resources/sprites/gl/army.png`), an icon (`ArmyIconWhite.svg`) and
    hotkey 0.
  - The MIRV quick-chat phrases were removed the same day.
- **2026-10-23** — Both files created from a code audit of every structure.
- **2026-10-23** — Split into a player page and this maintainer file.
  - The player page drops code names and internal framing, so it can be published (site, wiki).
  - Buildings that cannot be built are no longer listed.
  - Fixed elsewhere the same day:
    - The punitive-strike and ambience strings in `en.json` named a silo; they now name the
      Stargate, or drop it.
    - Design doc H18's gift list named the SAM and silo; it now names the stargate and shield
      array.
