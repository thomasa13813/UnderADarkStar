import { Config, NukeMagnitude } from "../src/core/configuration/Config";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { HegemonExecution } from "../src/core/execution/HegemonExecution";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { RazeExecution } from "../src/core/execution/RazeExecution";
import {
  listNukeBreakAlliance,
  missileShieldsNear,
} from "../src/core/execution/Util";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { NukeType } from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

// Shield arrays (docs/DarkStar-Design.md C5, decided 2026-09-28, revised
// 2026-09-29): a challenger structure whose perimeter no missile can harm
// the inside of. A warhead may be aimed anywhere; when it lands, the blast
// is kept off the tiles inside the perimeter and clears the rest of its
// circle as usual. The throne's missiles are kept out like anyone else's;
// only its strikes pass through.
//
// big_plains is 200×200: the Dark Star's radius is 18 and the moat 15; a
// level-1 gate's 180 reaches everything, so range never gets in the way.

// TestConfig shrinks every blast to one tile; the shield is about geometry,
// so these tests use the game's real radii (atom 12/30, hydrogen 80/100).
class BlastConfig extends TestConfig {
  nukeMagnitudes(type: UnitType): NukeMagnitude {
    return Config.prototype.nukeMagnitudes.call(this, type);
  }
}

let game: Game;
let hegemon: Player;
let east: Player;
let west: Player;

// A block of land beyond the moat's outer shore, east (+1) or west (-1):
// `depth` tiles deep and `half` tiles either side of the Dark Star's row.
function settle(
  player: Player,
  side: 1 | -1,
  depth: number,
  troops: number,
  half = 20,
) {
  const g = game.darkStar()!;
  const outer = g.radius + g.moatWidth;
  game.forEachTile((tile) => {
    const dx = (game.x(tile) - g.cx) * side - outer;
    const dy = game.y(tile) - g.cy;
    if (dx >= 0 && dx < depth && Math.abs(dy) < half && game.isLand(tile)) {
      player.conquer(tile);
    }
  });
  player.setTroops(troops);
  player.addGold(50_000_000n);
}

// A tile `dx` tiles in from the moat's outer shore on the player's side.
function tileOf(player: Player, dx: number, dy = 0): TileRef {
  const g = game.darkStar()!;
  const side = player === east ? 1 : -1;
  return game.ref(g.cx + side * (g.radius + g.moatWidth + dx), g.cy + dy);
}

function centre(): TileRef {
  const g = game.darkStar()!;
  return game.ref(g.cx, g.cy);
}

async function start(instantBuild = true, wideWest = false) {
  const humans = [
    new PlayerInfo("east", PlayerType.Human, "client1", "east"),
    new PlayerInfo("west", PlayerType.Human, "client2", "west"),
    new PlayerInfo(
      "throne",
      PlayerType.Human,
      "client3",
      "throne",
      false,
      null,
      [],
      null,
      null,
      true,
    ),
  ];
  game = await setup(
    "big_plains",
    { hegemon: { enabled: true }, disableNavMesh: false, instantBuild },
    humans,
    undefined,
    BlastConfig,
  );
  hegemon = game.hegemon()!;
  east = game.player("east");
  west = game.player("west");
  settle(east, 1, 40, 300_000);
  // The wide block (60 deep, 120 tall) leaves west plenty of land outside
  // an array's 35-tile zone for a blast to clear.
  if (wideWest) settle(west, -1, 60, 300_000, 60);
  else settle(west, -1, 40, 300_000);
  hegemon.addGold(50_000_000n);
  game.addExecution(new HegemonExecution());
  game.addExecution(new PlayerExecution(east));
  game.addExecution(new PlayerExecution(west));
  while (game.inSpawnPhase()) game.executeNextTick();
}

function build(player: Player, type: UnitType, tile: TileRef): Unit {
  game.addExecution(new ConstructionExecution(player, type, tile));
  executeTicks(game, 2);
  const unit = player.units(type).find((u) => u.tile() === tile);
  if (unit === undefined) throw new Error(`${type} not built`);
  return unit;
}

function radius(): number {
  return game.config().shieldArrayRadius();
}

// Fire a warhead and run the game until it has landed.
function strike(player: Player, type: NukeType, target: TileRef) {
  game.addExecution(new NukeExecution(type, player, target));
  executeTicks(game, 2);
  expect(player.units(type)).toHaveLength(1);
  let ticks = 0;
  while (player.units(type).length > 0 && ticks++ < 500) {
    game.executeNextTick();
  }
  expect(player.units(type)).toHaveLength(0);
}

// The player's tiles inside and outside the zone around `site`.
function tilesAround(player: Player, site: TileRef) {
  const r2 = radius() * radius();
  let inside = 0;
  let outside = 0;
  for (const tile of player.tiles()) {
    if (game.euclideanDistSquared(site, tile) <= r2) inside++;
    else outside++;
  }
  return { inside, outside };
}

describe("Building a shield array", () => {
  beforeEach(() => start());

  test("costs 5M, stands anywhere in the territory, and is not upgradable", () => {
    const tile = tileOf(east, 20);
    const gold = east.gold();
    const array = build(east, UnitType.ShieldArray, tile);
    // Two ticks of income accrue while it is placed.
    expect(gold - east.gold()).toBeGreaterThan(4_990_000n);
    expect(gold - east.gold()).toBeLessThanOrEqual(5_000_000n);
    expect(array.level()).toBe(1);
    expect(east.canUpgradeUnit(array)).toBe(false);
    const row = east
      .buildableUnits(tile)
      .find((b) => b.type === UnitType.ShieldArray);
    expect(row?.cost).toBe(5_000_000n);
    expect(row?.canUpgrade).toBe(false);
    expect(game.config().unitInfo(UnitType.ShieldArray).upgradable).toBeFalsy();
  });

  test("its perimeter is at most half a level-1 SAM's range", () => {
    // The engine's formula (TestConfig shortens SAM ranges): 150 - 480/6 = 70.
    const samLevel1 = Config.prototype.samRange.call(game.config(), 1);
    expect(samLevel1).toBe(70);
    expect(radius()).toBeLessThanOrEqual(samLevel1 / 2);
    expect(radius()).toBeGreaterThan(0);
  });

  test("neither the Dark Star nor the throne may hold one (H2)", () => {
    expect(hegemon.canBuild(UnitType.ShieldArray, tileOf(east, 20))).toBe(
      false,
    );
    expect(east.canBuild(UnitType.ShieldArray, centre())).toBe(false);
  });
});

describe("What a shield array keeps out (C5)", () => {
  beforeEach(() => start(true, true));

  test("a missile may still be aimed anywhere inside the perimeter", () => {
    const gate = build(east, UnitType.Stargate, tileOf(east, 10));
    const site = tileOf(west, 40);
    build(west, UnitType.ShieldArray, site);
    expect(east.canBuild(UnitType.AtomBomb, site)).toBe(gate.tile());
    expect(east.canBuild(UnitType.HydrogenBomb, site)).toBe(gate.tile());
    expect(east.canBuild(UnitType.AtomBomb, tileOf(west, 40, radius()))).toBe(
      gate.tile(),
    );
  });

  test("a blast clears its circle outside the perimeter and nothing inside", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    const site = tileOf(west, 40);
    const array = build(west, UnitType.ShieldArray, site);
    const before = tilesAround(west, site);
    expect(before.inside).toBeGreaterThan(0);
    expect(before.outside).toBeGreaterThan(0);
    // The hydrogen bomb's 100-tile circle covers the whole block.
    strike(east, UnitType.HydrogenBomb, site);
    const after = tilesAround(west, site);
    expect(after.inside).toBe(before.inside);
    expect(after.outside).toBeLessThan(before.outside);
    // Every tile within the bomb's inner radius but outside the zone is gone.
    const inner = game.config().nukeMagnitudes(UnitType.HydrogenBomb).inner;
    for (const tile of west.tiles()) {
      const d2 = game.euclideanDistSquared(site, tile);
      expect(d2 <= radius() * radius() || d2 > inner * inner).toBe(true);
    }
    expect(array.isActive()).toBe(true);
  });

  test("a blast wholly inside the perimeter does nothing at all", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    const site = tileOf(west, 40);
    const array = build(west, UnitType.ShieldArray, site);
    const city = build(west, UnitType.City, tileOf(west, 40, 20));
    const tiles = west.numTilesOwned();
    const troops = west.troops();
    // The atom bomb's 30-tile circle lies within the 35-tile zone.
    strike(east, UnitType.AtomBomb, site);
    expect(west.numTilesOwned()).toBe(tiles);
    // Troops only grow over the flight: none died.
    expect(west.troops()).toBeGreaterThanOrEqual(troops);
    expect(array.isActive()).toBe(true);
    expect(city.isActive()).toBe(true);
    expect(west.units(UnitType.City)).toHaveLength(1);
  });

  test("structures inside the perimeter stand while those outside fall", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    const site = tileOf(west, 40);
    const array = build(west, UnitType.ShieldArray, site);
    const sheltered = build(west, UnitType.City, tileOf(west, 40, 20));
    // 61 tiles from the array: outside its zone, inside the bomb's circle.
    const exposed = build(west, UnitType.City, tileOf(west, 5, 50));
    strike(east, UnitType.HydrogenBomb, site);
    expect(array.isActive()).toBe(true);
    expect(sheltered.isActive()).toBe(true);
    expect(exposed.isActive()).toBe(false);
  });

  test("the owner's own missiles are not kept out", () => {
    build(west, UnitType.Stargate, tileOf(west, 5));
    const site = tileOf(west, 40);
    const array = build(west, UnitType.ShieldArray, site);
    const tiles = west.numTilesOwned();
    strike(west, UnitType.AtomBomb, site);
    expect(west.numTilesOwned()).toBeLessThan(tiles);
    expect(array.isActive()).toBe(false);
  });

  test("the throne's missiles are kept out like anyone else's", () => {
    const site = tileOf(west, 40);
    const array = build(west, UnitType.ShieldArray, site);
    expect(hegemon.canBuild(UnitType.AtomBomb, site)).toBe(centre());
    const tiles = west.numTilesOwned();
    const troops = west.troops();
    strike(hegemon, UnitType.AtomBomb, site);
    expect(west.numTilesOwned()).toBe(tiles);
    expect(west.troops()).toBeGreaterThanOrEqual(troops);
    expect(array.isActive()).toBe(true);
  });

  test("the throne's strikes pass through it", () => {
    const site = tileOf(west, 40);
    build(west, UnitType.ShieldArray, site);
    game.addExecution(new RazeExecution(hegemon, site, 20_000));
    executeTicks(game, 2);
    expect(game.strikesInFlight()).toHaveLength(1);
  });

  test("a captured array shields its new owner", () => {
    const site = tileOf(west, 40);
    const array = build(west, UnitType.ShieldArray, site);
    build(west, UnitType.Stargate, tileOf(west, 5));
    // East takes the ground under it, and the array with it.
    east.conquer(site);
    executeTicks(game, 1);
    expect(array.owner()).toBe(east);
    expect(array.isActive()).toBe(true);
    // Now east's: west's own missile is kept out of its former zone.
    const tiles = west.numTilesOwned();
    strike(west, UnitType.AtomBomb, site);
    expect(west.numTilesOwned()).toBe(tiles);
    expect(array.isActive()).toBe(true);
  });

  test("gate shots are not missiles: they land inside a shield", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    build(west, UnitType.ShieldArray, tileOf(west, 40));
    expect(east.stargateFor(tileOf(west, 40))).not.toBeNull();
  });

  test("a blast kept off a sheltered player angers nobody", () => {
    // NukeExecution.maybeBreakAlliances asks listNukeBreakAlliance with the
    // shields around the target; a player whose every tile and structure in
    // the circle is sheltered is not on the list.
    const site = tileOf(west, 40);
    build(west, UnitType.ShieldArray, site);
    build(west, UnitType.City, tileOf(west, 40, 20));
    const magnitude = game.config().nukeMagnitudes(UnitType.AtomBomb);
    const threshold = game.config().nukeAllianceBreakThreshold();
    const listFor = (target: TileRef) =>
      listNukeBreakAlliance({
        game,
        targetTile: target,
        magnitude,
        threshold,
        shields: missileShieldsNear(
          game,
          east.smallID(),
          target,
          magnitude.outer,
        ),
      });
    // Without the shields the same blast would anger west.
    expect(
      listNukeBreakAlliance({
        game,
        targetTile: site,
        magnitude,
        threshold,
      }).has(west.smallID()),
    ).toBe(true);
    expect(listFor(site).has(west.smallID())).toBe(false);
    // Aimed past the rim, the blast reaches west's land again.
    expect(listFor(tileOf(west, 40, radius() + 20)).has(west.smallID())).toBe(
      true,
    );
    // The owner's own blast is not kept off.
    expect(
      listNukeBreakAlliance({
        game,
        targetTile: site,
        magnitude,
        threshold,
        shields: missileShieldsNear(
          game,
          west.smallID(),
          site,
          magnitude.outer,
        ),
      }).has(west.smallID()),
    ).toBe(true);
  });
});

describe("While it is being built", () => {
  beforeEach(() => start(false, true));

  test("an array under construction protects nothing", () => {
    const gate = build(east, UnitType.Stargate, tileOf(east, 10));
    executeTicks(
      game,
      game.config().stargateConfig().constructionSeconds * 10 + 5,
    );
    expect(gate.isUnderConstruction()).toBe(false);
    const site = tileOf(west, 40);
    const array = build(west, UnitType.ShieldArray, site);
    expect(array.isUnderConstruction()).toBe(true);
    // Landed while the array is still going up: the zone is not yet there.
    const tiles = west.numTilesOwned();
    strike(east, UnitType.AtomBomb, site);
    expect(west.numTilesOwned()).toBeLessThan(tiles);
    expect(array.isActive()).toBe(false);
  });

  test("a finished array shields from the tick it stands", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    executeTicks(
      game,
      game.config().stargateConfig().constructionSeconds * 10 + 5,
    );
    const site = tileOf(west, 40);
    const array = build(west, UnitType.ShieldArray, site);
    executeTicks(
      game,
      game.config().shieldArrayConfig().constructionSeconds * 10 + 5,
    );
    expect(array.isUnderConstruction()).toBe(false);
    const tiles = west.numTilesOwned();
    strike(east, UnitType.AtomBomb, site);
    expect(west.numTilesOwned()).toBe(tiles);
    expect(array.isActive()).toBe(true);
  });
});
