import {
  AttackLogicInput,
  AttackLogicResult,
  Config,
  NukeMagnitude,
} from "../src/core/configuration/Config";
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { HegemonExecution } from "../src/core/execution/HegemonExecution";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { RazeExecution } from "../src/core/execution/RazeExecution";
import { UpgradeStructureExecution } from "../src/core/execution/UpgradeStructureExecution";
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

// Shield arrays (docs/DarkStar-Rework.md SH1-SH4, 2026-10-25, revised
// 2026-10-27; C5 before): a free-standing structure with five levels, each
// 1M, 2.5M, then 5M by the levels owned, and a shield of 25 tiles per level
// (125 at level 5) that no other player's warhead can harm the inside of, the Antimatter Reaction included (revised
// 2026-10-25); strikes and gate shots (troops) land inside it. It gives no
// post's defence. A post is destroyed when taken; an array is captured
// intact.
//
// big_plains is 200×200: the Dark Star's radius is 18 and the moat 15; a
// level-1 gate's 180 reaches everything, so range never gets in the way.

// TestConfig shrinks every blast to one tile; the shield is about geometry,
// so these tests use the game's real radii (Gamma Ray Burst 80/100,
// Antimatter Reaction 10). attackLogic records whether the defender was
// seen to have a post in range.
const postSeen: boolean[] = [];
class BlastConfig extends TestConfig {
  nukeMagnitudes(type: UnitType): NukeMagnitude {
    return Config.prototype.nukeMagnitudes.call(this, type);
  }
  attackLogic(input: AttackLogicInput): AttackLogicResult {
    postSeen.push(input.defenderHasDefensePost);
    return super.attackLogic(input);
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

async function start(instantBuild = true) {
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
  // West's block is 60 deep and 160 tall, so a shield in one corner leaves
  // land beyond a level-5 array's 125 tiles for a blast to clear.
  settle(west, -1, 60, 300_000, 80);
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

// A shield array, raised at once to `level` (the top, 125 tiles, unless
// a test needs a smaller one).
function shieldArray(player: Player, tile: TileRef, level = 5): Unit {
  const array = build(player, UnitType.ShieldArray, tile);
  if (level > 1) {
    game.addExecution(
      new UpgradeStructureExecution(player, array.id(), level - 1),
    );
    executeTicks(game, 1);
  }
  expect(array.level()).toBe(level);
  return array;
}

function radius(level = 5): number {
  return game.config().shieldArrayRadius(level);
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

// The player's tiles inside and outside the shield around `site`.
function tilesAround(player: Player, site: TileRef, r = radius()) {
  const r2 = r * r;
  let inside = 0;
  let outside = 0;
  for (const tile of player.tiles()) {
    if (game.euclideanDistSquared(site, tile) <= r2) inside++;
    else outside++;
  }
  return { inside, outside };
}

describe("Building a shield array (SH1, SH2, revised 2026-10-27)", () => {
  beforeEach(() => start());

  test("it stands on its own ground at level 1", () => {
    const tile = tileOf(east, 20);
    expect(east.canBuild(UnitType.ShieldArray, tile)).toBe(tile);
    const array = build(east, UnitType.ShieldArray, tile);
    expect(array.level()).toBe(1);
    expect(radius(1)).toBe(25);
  });

  test("each level, new or upgrade, costs 1M, then 2.5M, then 5M", () => {
    const cost = () =>
      game.config().unitInfo(UnitType.ShieldArray).cost(game, east);
    expect(cost()).toBe(1_000_000n);
    const array = build(east, UnitType.ShieldArray, tileOf(east, 20));
    expect(cost()).toBe(2_500_000n);
    game.addExecution(new UpgradeStructureExecution(east, array.id()));
    executeTicks(game, 1);
    expect(array.level()).toBe(2);
    expect(cost()).toBe(5_000_000n);
    // A second array counts the levels of the first.
    build(east, UnitType.ShieldArray, tileOf(east, 20, -18));
    expect(cost()).toBe(5_000_000n);
  });

  test("each level adds 25 tiles, up to level 5 and 125 tiles", () => {
    const array = build(east, UnitType.ShieldArray, tileOf(east, 20));
    for (let level = 1; level <= 5; level++) {
      expect(radius(level)).toBe(25 * level);
    }
    // A bulk order past the top stops at level 5.
    game.addExecution(new UpgradeStructureExecution(east, array.id(), 10));
    executeTicks(game, 1);
    expect(array.level()).toBe(5);
    expect(east.canUpgradeUnit(array)).toBe(false);
    expect(game.config().unitInfo(UnitType.ShieldArray).maxLevel).toBe(5);
    // Its zone is read at its level.
    const zones = missileShieldsNear(game, west.smallID(), array.tile(), 1);
    expect(zones).toHaveLength(1);
    expect(zones[0].r2).toBe(125 * 125);
  });

  test("it no longer upgrades a post: both stand", () => {
    const post = build(east, UnitType.DefensePost, tileOf(east, 5));
    const array = shieldArray(east, tileOf(east, 35));
    expect(post.isActive()).toBe(true);
    expect(array.isActive()).toBe(true);
    expect(array.tile()).not.toBe(post.tile());
  });

  test("not on another player's ground", () => {
    expect(east.canBuild(UnitType.ShieldArray, tileOf(west, 20))).toBe(false);
  });

  test("an array does not count as a post for the post's price", () => {
    const postCost = () =>
      game.config().unitInfo(UnitType.DefensePost).cost(game, east);
    expect(postCost()).toBe(50_000n);
    shieldArray(east, tileOf(east, 20));
    expect(postCost()).toBe(50_000n);
  });

  test("neither the Dark Star nor the throne may hold one (H2)", () => {
    expect(hegemon.canBuild(UnitType.ShieldArray, tileOf(east, 20))).toBe(
      false,
    );
    expect(east.canBuild(UnitType.ShieldArray, centre())).toBe(false);
  });
});

describe("While the array goes up", () => {
  beforeEach(() => start(false));

  test("an array under construction shields nothing", () => {
    const gate = build(east, UnitType.Stargate, tileOf(east, 10));
    executeTicks(
      game,
      game.config().stargateConfig().constructionSeconds * 10 + 5,
    );
    expect(gate.isUnderConstruction()).toBe(false);
    const site = tileOf(west, 30);
    game.addExecution(
      new ConstructionExecution(west, UnitType.ShieldArray, site),
    );
    executeTicks(game, 2);
    const tiles = west.numTilesOwned();
    strike(east, UnitType.HydrogenBomb, site);
    expect(west.numTilesOwned()).toBeLessThan(tiles);
  });
});

describe("What a shield array does (SH3, SH4)", () => {
  beforeEach(() => start());

  test("it gives no post's defence (revised 2026-10-27)", () => {
    // East takes a strip along the map's west edge, bordering west's block
    // (x 8 to 67), and attacks across it, near the post at x 12.
    for (let x = 0; x < 8; x++) {
      for (let y = 30; y < 170; y++) {
        const tile = game.ref(x, y);
        if (game.isLand(tile)) east.conquer(tile);
      }
    }
    const site = tileOf(west, 55);
    expect(game.x(site)).toBe(12);
    shieldArray(west, site);
    postSeen.length = 0;
    game.addExecution(new AttackExecution(10_000, east, west.id(), null));
    executeTicks(game, 20);
    expect(postSeen.length).toBeGreaterThan(0);
    expect(postSeen.some((seen) => seen)).toBe(false);
  });

  test("a missile may still be aimed anywhere inside the shield", () => {
    const gate = build(east, UnitType.Stargate, tileOf(east, 10));
    const site = tileOf(west, 30);
    shieldArray(west, site);
    expect(east.canBuild(UnitType.HydrogenBomb, site)).toBe(gate.tile());
    expect(east.canBuild(UnitType.AtomBomb, site)).toBe(gate.tile());
  });

  test("a Gamma Ray Burst clears its circle outside the shield and nothing inside", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    // The shield in the block's top corner; the burst aimed at the bottom.
    const site = tileOf(west, 5, -75);
    const array = shieldArray(west, site);
    const target = tileOf(west, 50, 70);
    expect(game.euclideanDistSquared(site, target)).toBeGreaterThan(
      radius() * radius(),
    );
    const before = tilesAround(west, site);
    expect(before.inside).toBeGreaterThan(0);
    expect(before.outside).toBeGreaterThan(0);
    strike(east, UnitType.HydrogenBomb, target);
    const after = tilesAround(west, site);
    expect(after.inside).toBe(before.inside);
    expect(after.outside).toBeLessThan(before.outside);
    expect(array.isActive()).toBe(true);
  });

  test("a Gamma Ray Burst aimed at a smaller array clears the ring beyond its shield", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    // Level 3, 75 tiles, in the block's top corner: west owns land 75 to
    // 100 tiles away.
    const site = tileOf(west, 5, -75);
    const array = shieldArray(west, site, 3);
    const city = build(west, UnitType.City, tileOf(west, 30, -40));
    const before = tilesAround(west, site, radius(3));
    strike(east, UnitType.HydrogenBomb, site);
    const after = tilesAround(west, site, radius(3));
    expect(after.inside).toBe(before.inside);
    expect(after.outside).toBeLessThan(before.outside);
    expect(array.isActive()).toBe(true);
    expect(city.isActive()).toBe(true);
  });

  test("a Gamma Ray Burst aimed at a level-5 array does nothing at all", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    // 125 tiles: wider than the burst's 100.
    const site = tileOf(west, 30);
    const array = shieldArray(west, site);
    const tiles = west.numTilesOwned();
    const troops = west.troops();
    strike(east, UnitType.HydrogenBomb, site);
    expect(west.numTilesOwned()).toBe(tiles);
    // Troops only grow over the flight: none died.
    expect(west.troops()).toBeGreaterThanOrEqual(troops);
    expect(array.isActive()).toBe(true);
  });

  test("the throne's Gamma Ray Burst is kept out like anyone else's", () => {
    const site = tileOf(west, 30);
    const array = shieldArray(west, site);
    expect(hegemon.canBuild(UnitType.HydrogenBomb, site)).toBe(centre());
    const tiles = west.numTilesOwned();
    strike(hegemon, UnitType.HydrogenBomb, site);
    expect(west.numTilesOwned()).toBe(tiles);
    expect(array.isActive()).toBe(true);
  });

  test("the owner's own Gamma Ray Burst is not kept out", () => {
    build(west, UnitType.Stargate, tileOf(west, 5));
    const site = tileOf(west, 30);
    const array = shieldArray(west, site);
    const tiles = west.numTilesOwned();
    strike(west, UnitType.HydrogenBomb, site);
    expect(west.numTilesOwned()).toBeLessThan(tiles);
    expect(array.isActive()).toBe(false);
  });

  test("an Antimatter Reaction is kept out too (revised 2026-10-25)", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    const site = tileOf(west, 30);
    const array = shieldArray(west, site);
    const tiles = west.numTilesOwned();
    strike(east, UnitType.AtomBomb, site);
    expect(array.isActive()).toBe(true);
    expect(west.numTilesOwned()).toBe(tiles);
    expect(game.isLand(site)).toBe(true);
  });

  test("strikes are troops: they land inside a shield", () => {
    const site = tileOf(west, 30);
    shieldArray(west, site);
    game.addExecution(new RazeExecution(hegemon, site, 20_000));
    executeTicks(game, 2);
    expect(game.strikesInFlight()).toHaveLength(1);
  });

  test("gate shots are not missiles: they land inside a shield", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    shieldArray(west, tileOf(west, 30));
    expect(east.stargateFor(tileOf(west, 30))).not.toBeNull();
  });

  test("an array is captured intact and shields its new owner", () => {
    const site = tileOf(west, 30);
    const array = shieldArray(west, site);
    build(west, UnitType.Stargate, tileOf(west, 5));
    east.conquer(site);
    executeTicks(game, 1);
    expect(array.owner()).toBe(east);
    expect(array.isActive()).toBe(true);
    // Now east's: west's own burst is kept out of its former zone.
    const before = tilesAround(east, site);
    strike(west, UnitType.HydrogenBomb, site);
    expect(tilesAround(east, site).inside).toBe(before.inside);
    expect(array.isActive()).toBe(true);
  });

  test("a post is still destroyed when taken", () => {
    const site = tileOf(west, 30);
    const post = build(west, UnitType.DefensePost, site);
    east.conquer(site);
    executeTicks(game, 1);
    expect(post.isActive()).toBe(false);
    expect(east.units(UnitType.DefensePost)).toHaveLength(0);
  });

  test("a burst kept off a sheltered player angers nobody", () => {
    // NukeExecution.maybeBreakAlliances asks listNukeBreakAlliance with the
    // shields around the target; a player whose every tile and structure in
    // the circle is sheltered is not on the list.
    const site = tileOf(west, 30);
    shieldArray(west, site);
    build(west, UnitType.City, tileOf(west, 30, 20));
    const magnitude = game.config().nukeMagnitudes(UnitType.HydrogenBomb);
    const threshold = game.config().nukeAllianceBreakThreshold();
    const listFor = (target: TileRef, shooter: Player) =>
      listNukeBreakAlliance({
        game,
        targetTile: target,
        magnitude,
        threshold,
        shields: missileShieldsNear(
          game,
          shooter.smallID(),
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
    expect(listFor(site, east).has(west.smallID())).toBe(false);
    // The owner's own blast is not kept off.
    expect(listFor(site, west).has(west.smallID())).toBe(true);
  });
});
