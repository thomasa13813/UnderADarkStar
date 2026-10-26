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
// is kept out by shields; the Antimatter Reaction (the atom bomb) erases the
// old Nuclear Warhead's blast (12/30) into deep space and is kept out too
// (revised 2026-10-25). Both cost 5M and draw the same 25% levy. Whether a
// warhead erases is its nature: the Void missiles option is ignored under a
// Dark Star. Lords try a Gamma Ray Burst, then a Reaction.
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

  test("both warheads cost 5M; the Antimatter Reaction keeps the Nuclear Warhead's blast", () => {
    const cfg = game.config();
    expect(cfg.unitInfo(UnitType.AtomBomb).cost(game, east)).toBe(5_000_000n);
    expect(cfg.unitInfo(UnitType.HydrogenBomb).cost(game, east)).toBe(
      5_000_000n,
    );
    expect(cfg.nukeMagnitudes(UnitType.AtomBomb)).toEqual({
      inner: 12,
      outer: 30,
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

describe("The Antimatter Reaction erases (WH3)", () => {
  beforeEach(() => start());

  test("the nebula in its blast becomes deep space, owner and all", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    const target = tileOf(west, 30);
    expect(landWithin(target, 12)).toBeGreaterThan(400);
    // The ring past the blast's outer radius.
    const ring = () => landWithin(target, 36) - landWithin(target, 31);
    const before = ring();
    const tiles = west.numTilesOwned();
    strike(east, UnitType.AtomBomb, target);
    // Everything inside the inner radius is gone; the edge undulates
    // between the inner and outer radii, as the Void missiles' did.
    expect(landWithin(target, 12)).toBe(0);
    expect(ring()).toBe(before);
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
    const land = landWithin(target, 12);
    strike(east, UnitType.AtomBomb, target);
    expect(hegemon.numTilesOwned()).toBe(domainTiles);
    expect(landWithin(target, 12)).toBe(land);
  });

  test("deep space stays deep space", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    // The middle of the moat on the west side: the blast reaches the Dark
    // Star's rim on one side (untouched) and west's nebula on the other.
    const g = game.darkStar()!;
    const target = game.ref(
      g.cx - g.radius - Math.floor(g.moatWidth / 2),
      g.cy,
    );
    expect(game.isLand(target)).toBe(false);
    const water = [...game.circleSearch(target, 30, (t) => !game.isLand(t))];
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
    expect(landWithin(target, 12)).toBe(0);
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

describe("Lords' warheads under a Dark Star", () => {
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

  beforeEach(async () => {
    await start(false, PlayerType.Nation);
    // West a little deeper, so a 30-tile blast fits wholly on its nebula.
    settle(west, -1, 66);
  });

  test("a Gamma Ray Burst may hit bystanders and neutral ground", () => {
    // West's 100-tile circle spills over the moat and the map's edge: no
    // matter, only the Lord's own and its friends' ground is spared.
    build(east, UnitType.Stargate, tileOf(east, 10));
    build(west, UnitType.City, tileOf(west, 33));
    lord().maybeSendNuke();
    executeTicks(game, 2);
    expect(east.units(UnitType.HydrogenBomb)).toHaveLength(1);
    expect(east.units(UnitType.AtomBomb)).toHaveLength(0);
  });

  test("never on a friend's ground: then an Antimatter Reaction, if one fits", () => {
    // An ally of the Lord's holds a strip along the map's west edge, within
    // a Gamma Ray Burst's reach of every tile of west's but outside an
    // Antimatter Reaction's from the middle of west's block.
    const ally = game.addPlayer(
      new PlayerInfo("ally", PlayerType.Human, "c9", "ally"),
    );
    for (let x = 0; x < 3; x++) {
      for (let y = 20; y < 180; y++) {
        const t = game.ref(x, y);
        if (game.isLand(t) && !game.hasOwner(t)) ally.conquer(t);
      }
    }
    east.createAllianceRequest(ally)?.accept();
    expect(east.isFriendly(ally)).toBe(true);
    build(east, UnitType.Stargate, tileOf(east, 10));
    build(west, UnitType.City, tileOf(west, 33));
    lord().maybeSendNuke();
    executeTicks(game, 2);
    expect(east.units(UnitType.HydrogenBomb)).toHaveLength(0);
    expect(east.units(UnitType.AtomBomb)).toHaveLength(1);
  });

  test("nothing without 5M", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    build(west, UnitType.City, tileOf(west, 33));
    east.removeGold(east.gold());
    east.addGold(4_000_000n);
    lord().maybeSendNuke();
    executeTicks(game, 2);
    expect(east.units(UnitType.AtomBomb)).toHaveLength(0);
  });
});
