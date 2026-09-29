import { Config } from "../src/core/configuration/Config";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { HegemonExecution } from "../src/core/execution/HegemonExecution";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { RazeExecution } from "../src/core/execution/RazeExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

// Shield arrays (docs/DarkStar-Design.md C5, decided 2026-09-28): a
// challenger structure whose perimeter no other player's missile may target.
// It intercepts nothing; the throne's missiles and strikes pass through.
//
// big_plains is 200×200: the Dark Star's radius is 18 and the moat 15; a
// level-1 gate's 180 reaches everything, so range never gets in the way.

let game: Game;
let hegemon: Player;
let east: Player;
let west: Player;

// A block of land beyond the moat's outer shore, east (+1) or west (-1).
function settle(player: Player, side: 1 | -1, depth: number, troops: number) {
  const g = game.darkStar()!;
  const outer = g.radius + g.moatWidth;
  game.forEachTile((tile) => {
    const dx = (game.x(tile) - g.cx) * side - outer;
    const dy = game.y(tile) - g.cy;
    if (dx >= 0 && dx < depth && Math.abs(dy) < 20 && game.isLand(tile)) {
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
    TestConfig,
  );
  hegemon = game.hegemon()!;
  east = game.player("east");
  west = game.player("west");
  settle(east, 1, 40, 300_000);
  settle(west, -1, 40, 300_000);
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

describe("Building a shield array", () => {
  beforeEach(() => start());

  test("costs 1M, stands anywhere in the territory, and is not upgradable", () => {
    const tile = tileOf(east, 20);
    const gold = east.gold();
    const array = build(east, UnitType.ShieldArray, tile);
    // Two ticks of income accrue while it is placed.
    expect(gold - east.gold()).toBeGreaterThan(990_000n);
    expect(gold - east.gold()).toBeLessThanOrEqual(1_000_000n);
    expect(array.level()).toBe(1);
    expect(east.canUpgradeUnit(array)).toBe(false);
    const row = east
      .buildableUnits(tile)
      .find((b) => b.type === UnitType.ShieldArray);
    expect(row?.cost).toBe(1_000_000n);
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
  beforeEach(() => start());

  test("another player's missile cannot be aimed inside the perimeter", () => {
    const gate = build(east, UnitType.Stargate, tileOf(east, 10));
    const site = tileOf(west, 20);
    build(west, UnitType.ShieldArray, site);
    // Inside, on the array itself, on the rim: no launcher offered.
    expect(east.canBuild(UnitType.AtomBomb, site)).toBe(false);
    expect(east.canBuild(UnitType.HydrogenBomb, site)).toBe(false);
    expect(east.canBuild(UnitType.AtomBomb, tileOf(west, 20, radius()))).toBe(
      false,
    );
    expect(
      east.canBuild(UnitType.AtomBomb, tileOf(west, 20 - radius() + 1)),
    ).toBe(false);
    // One tile past the rim: the gate fires as before.
    expect(
      east.canBuild(UnitType.AtomBomb, tileOf(west, 20, radius() + 1)),
    ).toBe(gate.tile());
  });

  test("a launch aimed inside is refused outright", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    build(west, UnitType.ShieldArray, tileOf(west, 20));
    const westTiles = west.numTilesOwned();
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, east, tileOf(west, 20)),
    );
    executeTicks(game, 3);
    expect(east.units(UnitType.AtomBomb)).toHaveLength(0);
    expect(west.numTilesOwned()).toBe(westTiles);
  });

  test("the owner's own missiles are not kept out", () => {
    const gate = build(east, UnitType.Stargate, tileOf(east, 10));
    // East's array near its far edge covers neutral land beyond the block.
    build(east, UnitType.ShieldArray, tileOf(east, 35));
    const neutral = tileOf(east, 50);
    expect(game.hasOwner(neutral)).toBe(false);
    expect(east.canBuild(UnitType.AtomBomb, neutral)).toBe(gate.tile());
    // West, with a gate of its own, is kept out of the same tile.
    build(west, UnitType.Stargate, tileOf(west, 10));
    expect(west.canBuild(UnitType.AtomBomb, neutral)).toBe(false);
  });

  test("the throne's missiles pass through it", () => {
    const site = tileOf(west, 20);
    build(west, UnitType.ShieldArray, site);
    expect(hegemon.canBuild(UnitType.AtomBomb, site)).toBe(centre());
    game.addExecution(new NukeExecution(UnitType.AtomBomb, hegemon, site));
    executeTicks(game, 2);
    expect(hegemon.units(UnitType.AtomBomb)).toHaveLength(1);
  });

  test("the throne's strikes pass through it", () => {
    const site = tileOf(west, 20);
    build(west, UnitType.ShieldArray, site);
    game.addExecution(new RazeExecution(hegemon, site, 20_000));
    executeTicks(game, 2);
    expect(game.strikesInFlight()).toHaveLength(1);
  });

  test("a captured array shields its new owner", () => {
    const site = tileOf(west, 20);
    const array = build(west, UnitType.ShieldArray, site);
    build(west, UnitType.Stargate, tileOf(west, 5));
    build(east, UnitType.Stargate, tileOf(east, 10));
    array.setOwner(east);
    // Now east's: west is kept out, east may aim inside.
    expect(west.canBuild(UnitType.AtomBomb, tileOf(west, 20, 5))).toBe(false);
    expect(east.canBuild(UnitType.AtomBomb, tileOf(west, 20, 5))).not.toBe(
      false,
    );
  });

  test("gate shots are not missiles: they land inside a shield", () => {
    build(east, UnitType.Stargate, tileOf(east, 10));
    build(west, UnitType.ShieldArray, tileOf(west, 20));
    expect(east.stargateFor(tileOf(west, 20))).not.toBeNull();
  });
});

describe("While it is being built", () => {
  beforeEach(() => start(false));

  test("an array under construction protects nothing", () => {
    const gate = build(east, UnitType.Stargate, tileOf(east, 10));
    executeTicks(
      game,
      game.config().stargateConfig().constructionSeconds * 10 + 5,
    );
    expect(gate.isUnderConstruction()).toBe(false);
    const site = tileOf(west, 20);
    const array = build(west, UnitType.ShieldArray, site);
    expect(array.isUnderConstruction()).toBe(true);
    expect(east.canBuild(UnitType.AtomBomb, site)).toBe(gate.tile());
    executeTicks(
      game,
      game.config().shieldArrayConfig().constructionSeconds * 10 + 5,
    );
    expect(array.isUnderConstruction()).toBe(false);
    expect(east.canBuild(UnitType.AtomBomb, site)).toBe(false);
  });
});
