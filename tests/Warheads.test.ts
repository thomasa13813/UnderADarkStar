import { Config, NukeMagnitude } from "../src/core/configuration/Config";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { HegemonExecution } from "../src/core/execution/HegemonExecution";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { NationNukeBehavior } from "../src/core/execution/nation/NationNukeBehavior";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { RazeExecution } from "../src/core/execution/RazeExecution";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { NukeType } from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

// The warheads after the rework (docs/DarkStar-Rework.md §3, WH1-WH6): the
// Gamma Ray Burst (the engine's hydrogen bomb) clears a 100-tile circle and
// is kept out by shields; the Antimatter Reaction (the atom bomb) erases a
// 10-tile circle into deep space and goes through shields. Both cost 5M and
// draw the same 25% levy. Whether a warhead erases is its nature: the Void
// missiles option is ignored under a Dark Star. Lords spend the Antimatter
// Reaction on shields.
//
// big_plains is 200×200: the Dark Star's radius is 18 and the moat 15.

class BlastConfig extends TestConfig {
  nukeMagnitudes(type: UnitType): NukeMagnitude {
    return Config.prototype.nukeMagnitudes.call(this, type);
  }
}

let game: Game;
let hegemon: Player;
let east: Player;
let west: Player;

function settle(player: Player, side: 1 | -1, depth: number, half = 40) {
  const g = game.darkStar()!;
  const outer = g.radius + g.moatWidth;
  game.forEachTile((tile) => {
    const dx = (game.x(tile) - g.cx) * side - outer;
    const dy = game.y(tile) - g.cy;
    if (dx >= 0 && dx < depth && Math.abs(dy) < half && game.isLand(tile)) {
      player.conquer(tile);
    }
  });
  player.setTroops(300_000);
  player.addGold(50_000_000n);
}

function tileOf(player: Player, dx: number, dy = 0): TileRef {
  const g = game.darkStar()!;
  const side = player === east ? 1 : -1;
  return game.ref(g.cx + side * (g.radius + g.moatWidth + dx), g.cy + dy);
}

async function start(waterNukes = false, eastType = PlayerType.Human) {
  const humans = [
    new PlayerInfo("east", eastType, null, "east"),
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
    {
      hegemon: { enabled: true },
      disableNavMesh: false,
      instantBuild: true,
      waterNukes,
    },
    humans,
    undefined,
    BlastConfig,
  );
  hegemon = game.hegemon()!;
  east = game.player("east");
  west = game.player("west");
  settle(east, 1, 50);
  settle(west, -1, 60);
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

// Fire a warhead, run the game until it has landed, then a few ticks more
// for the batched terrain conversion.
function strike(player: Player, type: NukeType, target: TileRef) {
  game.addExecution(new NukeExecution(type, player, target));
  executeTicks(game, 2);
  expect(player.units(type)).toHaveLength(1);
  let ticks = 0;
  while (player.units(type).length > 0 && ticks++ < 500) {
    game.executeNextTick();
  }
  expect(player.units(type)).toHaveLength(0);
  executeTicks(game, 5);
}

function landWithin(target: TileRef, r: number): number {
  let land = 0;
  game.circleSearch(target, r, (tile) => {
    if (game.isLand(tile)) land++;
    return true;
  });
  return land;
}

describe("Prices and sizes (WH1)", () => {
  beforeEach(() => start());

  test("both warheads cost 5M; the Antimatter Reaction is a 10-tile circle", () => {
    const cfg = game.config();
    expect(cfg.unitInfo(UnitType.AtomBomb).cost(game, east)).toBe(5_000_000n);
    expect(cfg.unitInfo(UnitType.HydrogenBomb).cost(game, east)).toBe(
      5_000_000n,
    );
    expect(cfg.nukeMagnitudes(UnitType.AtomBomb)).toEqual({
      inner: 10,
      outer: 10,
    });
    expect(cfg.nukeMagnitudes(UnitType.HydrogenBomb)).toEqual({
      inner: 80,
      outer: 100,
    });
  });

  test("both draw the same 25% levy (WH4)", () => {
    expect(RazeExecution.levyPercent(game, UnitType.AtomBomb)).toBe(25);
    expect(RazeExecution.levyPercent(game, UnitType.HydrogenBomb)).toBe(25);
  });
});

describe("The Antimatter Reaction erases (WH2, WH3)", () => {
  beforeEach(() => start());

  test("every nebula tile in its circle becomes deep space, owner and all", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    const target = tileOf(west, 30);
    expect(landWithin(target, 10)).toBeGreaterThan(300);
    const outside = landWithin(target, 14) - landWithin(target, 10);
    const tiles = west.numTilesOwned();
    strike(east, UnitType.AtomBomb, target);
    expect(landWithin(target, 10)).toBe(0);
    // Nothing beyond the circle.
    expect(landWithin(target, 14)).toBe(outside);
    expect(west.numTilesOwned()).toBeLessThan(tiles);
    expect(game.owner(target).isPlayer()).toBe(false);
  });

  test("structures on it go with it", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    const city = build(west, UnitType.City, tileOf(west, 30));
    strike(east, UnitType.AtomBomb, tileOf(west, 30));
    expect(city.isActive()).toBe(false);
  });

  test("the Dark Star is untouched", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    const g = game.darkStar()!;
    const target = game.ref(g.cx, g.cy);
    const domainTiles = hegemon.numTilesOwned();
    const land = landWithin(target, 10);
    strike(east, UnitType.AtomBomb, target);
    expect(hegemon.numTilesOwned()).toBe(domainTiles);
    expect(landWithin(target, 10)).toBe(land);
  });

  test("on deep space it does nothing", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    // The middle of the moat on the west side. The moat is 15 wide, so the
    // circle reaches the Dark Star's rim on one side (untouched) and two
    // tiles of west's nebula on the other (erased); the deep space between
    // stays deep space.
    const g = game.darkStar()!;
    const target = game.ref(
      g.cx - g.radius - Math.floor(g.moatWidth / 2),
      g.cy,
    );
    expect(game.isLand(target)).toBe(false);
    const water = [...game.circleSearch(target, 10, (t) => !game.isLand(t))];
    expect(water.length).toBeGreaterThan(100);
    const domainTiles = hegemon.numTilesOwned();
    strike(east, UnitType.AtomBomb, target);
    for (const t of water) expect(game.isLand(t)).toBe(false);
    expect(hegemon.numTilesOwned()).toBe(domainTiles);
  });

  test("the throne erases freely, even beside its own moat (WH6)", () => {
    const target = tileOf(west, 2);
    expect(hegemon.canBuild(UnitType.AtomBomb, target)).not.toBe(false);
    strike(hegemon, UnitType.AtomBomb, target);
    expect(landWithin(target, 10)).toBe(0);
  });
});

describe("The Gamma Ray Burst never erases (WH5)", () => {
  test("its circle stays nebula, with fallout", async () => {
    await start();
    build(east, UnitType.Stargate, tileOf(east, 10));
    const target = tileOf(west, 30);
    const land = landWithin(target, 30);
    strike(east, UnitType.HydrogenBomb, target);
    expect(landWithin(target, 30)).toBe(land);
    expect(game.hasFallout(target)).toBe(true);
  });

  test("not even with the lobby's Void missiles option on", async () => {
    await start(true);
    build(east, UnitType.Stargate, tileOf(east, 10));
    const target = tileOf(west, 30);
    const land = landWithin(target, 30);
    strike(east, UnitType.HydrogenBomb, target);
    expect(landWithin(target, 30)).toBe(land);
  });
});

describe("Lords crack shields with the Antimatter Reaction (§3.2)", () => {
  // The Lord (east) is a Nation; its nuke behaviour is driven directly with
  // stubbed attack and emoji behaviours that point it at west.
  function lord(): NationNukeBehavior {
    const attack = {
      findIncomingAttackPlayer: () => west,
      shouldAttack: () => true,
    } as unknown as AiAttackBehavior;
    const emoji = {
      maybeSendEmoji: () => {},
    } as unknown as NationEmojiBehavior;
    return new NationNukeBehavior(
      new PseudoRandom(1),
      game,
      east,
      attack,
      emoji,
    );
  }

  function shieldedPost(tile: TileRef): Unit {
    build(west, UnitType.DefensePost, tile);
    return build(west, UnitType.ShieldArray, tile);
  }

  beforeEach(() => start(false, PlayerType.Nation));

  test("it aims an Antimatter Reaction at a shielded post sheltering a target", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    const site = tileOf(west, 30);
    shieldedPost(site);
    build(west, UnitType.City, tileOf(west, 30, 20));
    lord().maybeSendNuke();
    executeTicks(game, 2);
    const reactions = east.units(UnitType.AtomBomb);
    expect(reactions).toHaveLength(1);
    expect(reactions[0].targetTile()).toBe(site);
    expect(east.units(UnitType.HydrogenBomb)).toHaveLength(0);
  });

  test("with no shield it never fires a reaction", () => {
    // (Nor, here, a Gamma Ray Burst: on Easy and Medium a Lord wants the
    // whole 100-tile circle on its target's ground, and this map is small.)
    build(east, UnitType.Stargate, tileOf(east, 10));
    build(west, UnitType.City, tileOf(west, 30, 20));
    lord().maybeSendNuke();
    executeTicks(game, 2);
    expect(east.units(UnitType.AtomBomb)).toHaveLength(0);
  });

  test("a shield sheltering nothing is not worth a reaction", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    shieldedPost(tileOf(west, 30));
    lord().maybeSendNuke();
    executeTicks(game, 2);
    expect(east.units(UnitType.AtomBomb)).toHaveLength(0);
  });

  test("never on its own ground", () => {
    // West holds a pocket past east's block (which ends at x 182), its post
    // 7 tiles from east's land and a city beside it.
    const g = game.darkStar()!;
    for (let x = 183; x < 200; x++) {
      for (let y = g.cy - 20; y <= g.cy + 20; y++) {
        const t = game.ref(x, y);
        if (game.isLand(t)) west.conquer(t);
      }
    }
    const post = game.ref(189, g.cy);
    build(east, UnitType.Stargate, tileOf(east, 10));
    shieldedPost(post);
    build(west, UnitType.City, game.ref(197, g.cy - 14));
    expect(game.x(tileOf(east, 49))).toBe(182);
    lord().maybeSendNuke();
    executeTicks(game, 2);
    expect(east.units(UnitType.AtomBomb)).toHaveLength(0);
  });
});
