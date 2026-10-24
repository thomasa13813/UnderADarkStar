import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { UpgradeStructureExecution } from "../src/core/execution/UpgradeStructureExecution";
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

// Fleet support (UNIT_SUPPORT_DEFAULTS, Tom 2026-10-23): each level of a
// finished spaceport supports one destroyer; losing support disbands nothing.

describe("Destroyers are capped by spaceport levels", () => {
  // 16×16: x < 8 is land, x >= 8 one body of water.
  let game: Game;
  let player: Player;
  const water = () => game.ref(12, 8);

  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true },
      [new PlayerInfo("port dude", PlayerType.Human, null, "player_1_id")],
    );
    player = game.player("player_1_id");
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 16; y++) {
        player.conquer(game.ref(x, y));
      }
    }
    executeTicks(game, 50);
    game.config().structureMinDist = () => 5;
  });

  function build(type: UnitType, tile: TileRef) {
    game.addExecution(new ConstructionExecution(player, type, tile));
    executeTicks(game, 3);
  }

  test("no spaceport, no destroyer", () => {
    expect(player.unitSupport(UnitType.Warship)).toEqual({ used: 0, cap: 0 });
    expect(player.canBuild(UnitType.Warship, water())).toBe(false);
  });

  test("one level-1 spaceport supports exactly one destroyer", () => {
    build(UnitType.Port, game.ref(7, 8));
    expect(player.canBuild(UnitType.Warship, water())).not.toBe(false);
    build(UnitType.Warship, water());
    expect(player.units(UnitType.Warship)).toHaveLength(1);
    expect(player.unitSupport(UnitType.Warship)).toEqual({ used: 1, cap: 1 });
    expect(player.canBuild(UnitType.Warship, water())).toBe(false);
    build(UnitType.Warship, water());
    expect(player.units(UnitType.Warship)).toHaveLength(1);
  });

  test("each spaceport level supports one more", () => {
    build(UnitType.Port, game.ref(7, 8));
    const port = player.units(UnitType.Port)[0];
    game.addExecution(new UpgradeStructureExecution(player, port.id(), 2));
    executeTicks(game, 3);
    expect(port.level()).toBe(3);
    expect(player.unitSupport(UnitType.Warship)?.cap).toBe(3);
  });

  test("losing the spaceport keeps the destroyer but stops new ones", () => {
    build(UnitType.Port, game.ref(7, 8));
    build(UnitType.Warship, water());
    player.units(UnitType.Port)[0].delete();
    executeTicks(game, 2);
    expect(player.units(UnitType.Warship)).toHaveLength(1);
    expect(player.unitSupport(UnitType.Warship)).toEqual({ used: 1, cap: 0 });
    expect(player.canBuild(UnitType.Warship, water())).toBe(false);
  });
});
