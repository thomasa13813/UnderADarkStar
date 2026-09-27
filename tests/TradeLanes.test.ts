import { CityExecution } from "../src/core/execution/CityExecution";
import { FactoryExecution } from "../src/core/execution/FactoryExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { bresenham, straightLane } from "../src/core/game/TradeLane";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// Trade lanes (S7, docs/DarkStar-Design.md §6.19): a railroad is the straight
// line between its two stations, or no railroad at all when that line is
// blocked by void, the Dark Star's disc or open water.

// Every tile of the line lies within a tile of the ideal segment, and
// consecutive tiles touch (8-connected).
function expectStraight(game: Game, tiles: TileRef[], a: TileRef, b: TileRef) {
  expect(tiles[0]).toBe(a);
  expect(tiles[tiles.length - 1]).toBe(b);
  const ax = game.x(a);
  const ay = game.y(a);
  const dx = game.x(b) - ax;
  const dy = game.y(b) - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  expect(tiles).toHaveLength(Math.max(Math.abs(dx), Math.abs(dy)) + 1);
  for (let i = 0; i < tiles.length; i++) {
    const px = game.x(tiles[i]) - ax;
    const py = game.y(tiles[i]) - ay;
    const off = Math.abs(px * dy - py * dx) / len;
    expect(off).toBeLessThanOrEqual(0.5 + 1e-9);
    if (i > 0) {
      expect(
        Math.max(
          Math.abs(game.x(tiles[i]) - game.x(tiles[i - 1])),
          Math.abs(game.y(tiles[i]) - game.y(tiles[i - 1])),
        ),
      ).toBe(1);
    }
  }
}

// A river: water tiles that are shoreline water when `shore` is set.
function river(game: Game, x0: number, x1: number, shore: boolean) {
  const map = game.map();
  for (let x = x0; x <= x1; x++) {
    for (let y = 0; y < map.height(); y++) {
      const t = game.ref(x, y);
      map.setWater(t);
      if (shore) map.setShorelineBit(t);
    }
  }
}

describe("Trade lanes on plains", () => {
  let game: Game;
  let player: Player;

  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: true, instantBuild: true }, [
      new PlayerInfo("rail dude", PlayerType.Human, null, "p1"),
    ]);
    player = game.player("p1");
    game.forEachTile((t) => {
      if (game.isLand(t)) player.conquer(t);
    });
    executeTicks(game, 50);
  });

  test("a lane is the straight line between its ends", () => {
    const a = game.ref(10, 10);
    const b = game.ref(60, 40);
    const lane = straightLane(game, a, b);
    expectStraight(game, lane, a, b);
    expect(lane).toEqual(bresenham(game, a, b));
    // The other way round: the same tiles, reversed.
    expect(straightLane(game, b, a)).toEqual([...lane].reverse());
    // Axis-aligned and diagonal lines too.
    expectStraight(
      game,
      straightLane(game, a, game.ref(10, 50)),
      a,
      game.ref(10, 50),
    );
    expectStraight(
      game,
      straightLane(game, a, game.ref(40, 40)),
      a,
      game.ref(40, 40),
    );
  });

  test("a narrow strait is crossed, open water is not", () => {
    const a = game.ref(20, 20);
    const b = game.ref(40, 20);
    river(game, 30, 31, true);
    const lane = straightLane(game, a, b);
    expectStraight(game, lane, a, b);
    expect(lane.filter((t) => game.isWater(t))).toHaveLength(2);
    // Deep water in the middle of a wider river blocks the line.
    river(game, 32, 34, false);
    expect(straightLane(game, a, b)).toEqual([]);
  });

  test("water counts six toward the length budget", () => {
    game.config().railroadMaxSize = () => 40;
    const a = game.ref(20, 20);
    // 37 tiles of land: within budget.
    expect(straightLane(game, a, game.ref(56, 20))).toHaveLength(37);
    // The same line with one strait tile costs 42: over.
    river(game, 30, 30, true);
    expect(straightLane(game, a, game.ref(56, 20))).toEqual([]);
    // Shorter, it fits again.
    expect(straightLane(game, a, game.ref(50, 20))).toHaveLength(31);
  });

  test("void blocks the line", () => {
    const map = game.map();
    map.setMagnitude(game.ref(30, 20), 31); // impassable
    expect(game.isImpassable(game.ref(30, 20))).toBe(true);
    expect(straightLane(game, game.ref(20, 20), game.ref(40, 20))).toEqual([]);
    expect(straightLane(game, game.ref(20, 21), game.ref(40, 21))).toHaveLength(
      21,
    );
  });

  function station(type: UnitType, tile: TileRef): Unit {
    const unit = player.buildUnit(type, tile, {});
    game.addExecution(
      type === UnitType.Factory
        ? new FactoryExecution(unit)
        : new CityExecution(unit),
    );
    executeTicks(game, 5);
    return unit;
  }

  function railroadBetween(a: Unit, b: Unit) {
    const manager = game.railNetwork().stationManager();
    const sa = manager.findStation(a);
    const sb = manager.findStation(b);
    expect(sa).not.toBeNull();
    expect(sb).not.toBeNull();
    return sa!.getRailroadTo(sb!);
  }

  test("stations are joined by a straight lane, and the preview agrees", () => {
    const factoryTile = game.ref(20, 20);
    const cityTile = game.ref(70, 45);
    const city = station(UnitType.City, cityTile);
    const preview = game
      .railNetwork()
      .computeGhostRailPaths(UnitType.Factory, factoryTile)[0];
    // The preview runs from the city, as the real connection will.
    expect(preview).toEqual(straightLane(game, cityTile, factoryTile));
    const factory = station(UnitType.Factory, factoryTile);
    const railroad = railroadBetween(city, factory);
    expect(railroad).not.toBeNull();
    const tiles = railroad!.tiles;
    if (tiles[0] === cityTile) {
      expectStraight(game, tiles, cityTile, factoryTile);
    } else {
      expectStraight(game, tiles, factoryTile, cityTile);
    }
  });

  test("a station beside a lane snaps onto it with two straight lanes", () => {
    const factory = station(UnitType.Factory, game.ref(20, 30));
    const city = station(UnitType.City, game.ref(80, 30));
    expect(railroadBetween(factory, city)).not.toBeNull();
    // Two tiles off the line, near its middle.
    const midTile = game.ref(50, 32);
    const mid = station(UnitType.City, midTile);
    expect(railroadBetween(factory, city)).toBeNull();
    const left = railroadBetween(factory, mid)!;
    const right = railroadBetween(mid, city)!;
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    const ends = (r: { tiles: TileRef[] }) => [
      r.tiles[0],
      r.tiles[r.tiles.length - 1],
    ];
    expect(ends(left)).toContain(midTile);
    expect(ends(right)).toContain(midTile);
    for (const r of [left, right]) {
      const [a, b] = ends(r);
      expectStraight(game, r.tiles, a, b);
    }
  });
});

describe("Trade lanes beside the Dark Star", () => {
  test("no lane crosses the disc", async () => {
    const game = await setup(
      "big_plains",
      { hegemon: { enabled: true }, instantBuild: true },
      [new PlayerInfo("east", PlayerType.Human, "client1", "east")],
    );
    const g = game.darkStar()!;
    const outer = g.radius + g.moatWidth + 2;
    // Across the disc: blocked. Along its edge, over land: fine.
    expect(
      straightLane(
        game,
        game.ref(g.cx - outer, g.cy),
        game.ref(g.cx + outer, g.cy),
      ),
    ).toEqual([]);
    const a = game.ref(g.cx + outer, g.cy - 20);
    const b = game.ref(g.cx + outer + 10, g.cy + 20);
    expect(straightLane(game, a, b).length).toBeGreaterThan(0);
  });
});
