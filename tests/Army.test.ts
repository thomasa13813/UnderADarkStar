import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { MoveWarshipExecution } from "../src/core/execution/MoveWarshipExecution";
import { NationStructureBehavior } from "../src/core/execution/nation/NationStructureBehavior";
import { UpgradeStructureExecution } from "../src/core/execution/UpgradeStructureExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// Armies (Tom, 2026-10-23; ARMY_DEFAULTS in Config.ts): a defensive land unit,
// one per industrial-zone level, that patrols its owner's nebula and shoots
// at the front of an attack on its owner, killing a share of its troops.

describe("Armies on big_plains", () => {
  // 200×200, all land. The defender holds x < 100, the attacker x >= 100.
  let game: Game;
  let defender: Player;
  let attacker: Player;

  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("defender", PlayerType.Human, null, "defender_id"),
        new PlayerInfo("attacker", PlayerType.Human, null, "attacker_id"),
      ],
    );
    defender = game.player("defender_id");
    attacker = game.player("attacker_id");
    for (let x = 0; x < 200; x++) {
      for (let y = 0; y < 60; y++) {
        (x < 100 ? defender : attacker).conquer(game.ref(x, y));
      }
    }
    executeTicks(game, 50);
  });

  function build(owner: Player, type: UnitType, tile: TileRef) {
    game.addExecution(new ConstructionExecution(owner, type, tile));
    executeTicks(game, 3);
  }

  function deployArmy(at: TileRef) {
    build(defender, UnitType.Army, at);
    const armies = defender.units(UnitType.Army);
    return armies[armies.length - 1];
  }

  test("no industrial zone, no army; each zone level supports one", () => {
    const tile = game.ref(50, 30);
    expect(defender.canBuild(UnitType.Army, tile)).toBe(false);
    build(defender, UnitType.Factory, game.ref(20, 30));
    expect(defender.unitSupport(UnitType.Army)).toEqual({ used: 0, cap: 1 });
    deployArmy(tile);
    expect(defender.units(UnitType.Army)).toHaveLength(1);
    expect(defender.canBuild(UnitType.Army, tile)).toBe(false);

    const zone = defender.units(UnitType.Factory)[0];
    game.addExecution(new UpgradeStructureExecution(defender, zone.id(), 1));
    executeTicks(game, 3);
    expect(defender.unitSupport(UnitType.Army)).toEqual({ used: 1, cap: 2 });
    expect(defender.canBuild(UnitType.Army, tile)).not.toBe(false);
  });

  test("an army deploys only on its owner's nebula, from the nearest zone", () => {
    build(defender, UnitType.Factory, game.ref(20, 30));
    build(defender, UnitType.Factory, game.ref(80, 30));
    expect(defender.canBuild(UnitType.Army, game.ref(150, 30))).toBe(false);
    expect(defender.canBuild(UnitType.Army, game.ref(90, 10))).toBe(
      game.ref(80, 30),
    );
  });

  test("it walks to its patrol tile through its owner's nebula", () => {
    build(defender, UnitType.Factory, game.ref(20, 30));
    const army = deployArmy(game.ref(60, 30));
    const zone = defender.units(UnitType.Factory)[0];
    // Set out from the zone a tick or two ago.
    expect(game.manhattanDist(army.tile(), zone.tile())).toBeLessThanOrEqual(3);
    executeTicks(game, 80);
    expect(
      game.manhattanDist(army.tile(), game.ref(60, 30)),
    ).toBeLessThanOrEqual(game.config().armyConfig().patrolRange);
    expect(game.owner(army.tile())).toBe(defender);
  });

  test("a move order sends it elsewhere, but never onto foreign nebula", () => {
    build(defender, UnitType.Factory, game.ref(20, 30));
    const army = deployArmy(game.ref(20, 30));
    game.addExecution(
      new MoveWarshipExecution(defender, [army.id()], game.ref(150, 30)),
    );
    executeTicks(game, 2);
    expect(army.warshipState().patrolTile).toBe(game.ref(20, 30));
    game.addExecution(
      new MoveWarshipExecution(defender, [army.id()], game.ref(90, 50)),
    );
    executeTicks(game, 2);
    expect(army.warshipState().patrolTile).toBe(game.ref(90, 50));
  });

  test("a shot at an attack's front kills 5% of its troops", () => {
    build(defender, UnitType.Factory, game.ref(90, 30));
    deployArmy(game.ref(90, 30));
    // A standing attack with one front tile in reach, no execution moving it.
    const attack = attacker.createAttack(defender, 100_000, null, new Set());
    attack.addBorderTile(game.ref(99, 30));
    executeTicks(game, 2);
    expect(defender.units(UnitType.Army)).toHaveLength(1);
    executeTicks(game, 20);
    expect(attack.troops()).toBe(95_000);
    // One shot per cooldown.
    executeTicks(game, 50);
    expect(attack.troops()).toBe(95_000);
    executeTicks(game, 60);
    expect(attack.troops()).toBe(90_250);
  });

  test("it does not fire at an attack beyond its reach", () => {
    build(defender, UnitType.Factory, game.ref(10, 30));
    deployArmy(game.ref(10, 30));
    const attack = attacker.createAttack(defender, 100_000, null, new Set());
    attack.addBorderTile(game.ref(99, 30));
    executeTicks(game, 40);
    expect(attack.troops()).toBe(100_000);
  });

  test("it is lost when the tile under it changes hands", () => {
    build(defender, UnitType.Factory, game.ref(20, 30));
    const army = deployArmy(game.ref(20, 30));
    executeTicks(game, 2);
    attacker.conquer(army.tile());
    executeTicks(game, 2);
    expect(army.isActive()).toBe(false);
    expect(defender.units(UnitType.Army)).toHaveLength(0);
  });
});

describe("Lords and armies", () => {
  test("a Lord under land attack deploys an army at the front", async () => {
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("lord", PlayerType.Nation, null, "lord_id"),
        new PlayerInfo("attacker", PlayerType.Human, null, "attacker_id"),
      ],
    );
    const lord = game.player("lord_id");
    const attacker = game.player("attacker_id");
    for (let x = 0; x < 200; x++) {
      for (let y = 0; y < 60; y++) {
        (x < 100 ? lord : attacker).conquer(game.ref(x, y));
      }
    }
    executeTicks(game, 50);
    // Infinite gold is a human's cheat; a Lord pays.
    lord.addGold(10_000_000n);
    game.addExecution(
      new ConstructionExecution(lord, UnitType.Factory, game.ref(50, 30)),
    );
    executeTicks(game, 3);
    const attack = attacker.createAttack(lord, 1_000_000, null, new Set());
    attack.addBorderTile(game.ref(99, 30));

    const behavior = new NationStructureBehavior(
      new PseudoRandom(42),
      game,
      lord,
    );
    (behavior as unknown as { placementsCount: number }).placementsCount = 1;
    behavior.handleStructures();
    executeTicks(game, 3);
    const armies = lord.units(UnitType.Army);
    expect(armies).toHaveLength(1);
    expect(armies[0].warshipState().patrolTile).toBe(game.ref(99, 30));
  });
});
