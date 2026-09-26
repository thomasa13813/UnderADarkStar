import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { WarshipExecution } from "../src/core/execution/WarshipExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// Spaceports anywhere and their harbours (S7, docs/DarkStar-Design.md §6.17):
// a port is placed like a city; its harbour is the nearest deep space
// reachable over land, where its destroyers are launched and repaired.

describe("Spaceports on half_land_half_ocean", () => {
  // 16×16: x < 8 is land, x >= 8 one body of water.
  let game: Game;
  let player: Player;

  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("port dude", PlayerType.Human, null, "player_1_id"),
        new PlayerInfo("other dude", PlayerType.Human, null, "player_2_id"),
      ],
    );
    player = game.player("player_1_id");
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 16; y++) {
        player.conquer(game.ref(x, y));
      }
    }
    executeTicks(game, 50);
    // Two ports fit on the 8-tile-wide land.
    game.config().structureMinDist = () => 5;
  });

  function buildPort(tile: TileRef) {
    game.addExecution(new ConstructionExecution(player, UnitType.Port, tile));
    executeTicks(game, 3);
    const port = player.units(UnitType.Port).find((p) => p.tile() === tile);
    expect(port).toBeDefined();
    return port!;
  }

  test("a spaceport is built inland, exactly where it is placed", () => {
    const tile = game.ref(2, 8);
    expect(game.isShore(tile)).toBe(false);
    expect(player.canBuild(UnitType.Port, tile)).toBe(tile);
    const offer = player
      .buildableUnits(tile, [UnitType.Port])
      .find((u) => u.type === UnitType.Port)!;
    expect(offer.canBuild).toBe(tile);
    buildPort(tile);
  });

  test("a coastal port's harbour is its adjacent deep space", () => {
    const tile = game.ref(7, 10);
    expect(game.isShore(tile)).toBe(true);
    const harbours = game.harbours(tile);
    expect(harbours).toHaveLength(1);
    expect(harbours[0].tile).toBe(game.ref(8, 10));
    expect(harbours[0].path).toEqual([game.ref(8, 10)]);
  });

  test("an inland port's harbour is the nearest deep space, reached over land", () => {
    const tile = game.ref(2, 10);
    const harbours = game.harbours(tile);
    expect(harbours).toHaveLength(1);
    const { tile: harbour, path } = harbours[0];
    expect(harbour).toBe(game.ref(8, 10));
    expect(path).toHaveLength(6);
    expect(path[path.length - 1]).toBe(harbour);
    expect(game.manhattanDist(tile, path[0])).toBe(1);
    for (let i = 0; i + 1 < path.length; i++) {
      expect(game.isLand(path[i])).toBe(true);
      expect(game.manhattanDist(path[i], path[i + 1])).toBe(1);
    }
  });

  test("no harbour when deep space lies out of range", () => {
    game.config().harbourMaxRange = () => 3;
    expect(game.harbours(game.ref(1, 5))).toHaveLength(0);
    expect(game.harbours(game.ref(6, 5))).toHaveLength(1);
  });

  test("a destroyer is launched from the nearest spaceport's harbour", () => {
    expect(player.canBuild(UnitType.Warship, game.ref(12, 3))).toBe(false);
    buildPort(game.ref(2, 10)); // harbour (8, 10)
    buildPort(game.ref(7, 2)); // harbour (8, 2)
    const click = game.ref(12, 3);
    expect(player.canBuild(UnitType.Warship, click)).toBe(game.ref(8, 2));
    expect(player.canBuild(UnitType.Warship, game.ref(12, 12))).toBe(
      game.ref(8, 10),
    );
    // Land is no place for one.
    expect(player.canBuild(UnitType.Warship, game.ref(4, 4))).toBe(false);

    game.addExecution(
      new ConstructionExecution(player, UnitType.Warship, click),
    );
    // The ship appears at the harbour and sails at once.
    let ship = player.units(UnitType.Warship)[0];
    for (let i = 0; i < 5 && ship === undefined; i++) {
      game.executeNextTick();
      ship = player.units(UnitType.Warship)[0];
    }
    expect(ship).toBeDefined();
    expect(ship.tile()).toBe(game.ref(8, 2));
    // It patrols around the click, in deep space, from then on.
    expect(ship.warshipState().patrolTile).toBe(click);
    executeTicks(game, 10);
    expect(ship.isActive()).toBe(true);
    expect(game.isWater(ship.tile())).toBe(true);
  });

  test("a destroyer retreats to an inland port's harbour, docks and repairs", () => {
    game.config().warshipRetreatHealthPercent = () => 60;
    const port = buildPort(game.ref(2, 10));
    const harbour = game.harbours(port.tile())[0].tile;
    const start = game.ref(13, 12);
    const ship = player.buildUnit(UnitType.Warship, start, {
      patrolTile: start,
    });
    game.addExecution(new WarshipExecution(ship));
    game.executeNextTick();
    const maxHealth = ship.maxHealth();
    ship.modifyHealth(-Math.floor(maxHealth * 0.7));
    const low = ship.health();

    let docked = false;
    for (let i = 0; i < 40 && !docked; i++) {
      game.executeNextTick();
      docked = ship.warshipState().state === "docked";
    }
    expect(docked).toBe(true);
    expect(ship.warshipState().retreatPort).toBe(harbour);
    expect(game.euclideanDistSquared(ship.tile(), harbour)).toBeLessThanOrEqual(
      game.config().warshipDockingRange() ** 2,
    );
    expect(ship.health()).toBeGreaterThan(low);
  });
});

describe("Spaceports beside the Dark Star", () => {
  let game: Game;
  let east: Player;

  function settleOuterShore(player: Player) {
    const g = game.darkStar()!;
    const outer = g.radius + g.moatWidth;
    game.forEachTile((tile) => {
      const dx = game.x(tile) - g.cx - outer;
      const dy = game.y(tile) - g.cy;
      if (dx >= 0 && dx < 30 && Math.abs(dy) < 6 && game.isLand(tile)) {
        player.conquer(tile);
      }
    });
    player.setTroops(200_000);
  }

  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { hegemon: { enabled: true }, instantBuild: true },
      [new PlayerInfo("east", PlayerType.Human, "client1", "east")],
    );
    east = game.player("east");
    settleOuterShore(east);
    east.addGold(1_000_000_000n);
  });

  test("a port on the outer shore harbours in the moat", () => {
    const g = game.darkStar()!;
    const tile = game.ref(g.cx + g.radius + g.moatWidth + 1, g.cy);
    expect(game.isLand(tile)).toBe(true);
    const harbours = game.harbours(tile);
    expect(harbours).toHaveLength(1);
    expect(game.isInMoat(harbours[0].tile)).toBe(true);
  });

  test("an inland port's path to the moat never enters the disc", () => {
    const g = game.darkStar()!;
    const tile = game.ref(g.cx + g.radius + g.moatWidth + 12, g.cy + 3);
    const harbours = game.harbours(tile);
    expect(harbours).toHaveLength(1);
    const { tile: harbour, path } = harbours[0];
    expect(game.isInMoat(harbour)).toBe(true);
    for (const t of path) {
      expect(game.isInDarkStar(t)).toBe(false);
    }
  });

  test("a challenger's destroyer is launched into the moat from an inland port", () => {
    const g = game.darkStar()!;
    const portTile = game.ref(g.cx + g.radius + g.moatWidth + 12, g.cy + 3);
    game.addExecution(new ConstructionExecution(east, UnitType.Port, portTile));
    executeTicks(game, 3);
    expect(east.units(UnitType.Port)).toHaveLength(1);
    const harbour = game.harbours(portTile)[0].tile;
    const click = game.ref(
      g.cx + g.radius + Math.floor(g.moatWidth / 2),
      g.cy - 4,
    );
    expect(game.isInMoat(click)).toBe(true);
    expect(east.canBuild(UnitType.Warship, click)).toBe(harbour);
  });
});
