import { vi } from "vitest";
import { ArmyShotExecution } from "../src/core/execution/ArmyExecution";
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

  test("an order cuts a rest short and the army walks straight there", () => {
    build(defender, UnitType.Factory, game.ref(20, 30));
    const army = deployArmy(game.ref(20, 30));
    // Wait until it rests at a patrol stop (up to 6 s there).
    let last = army.tile();
    for (let i = 0; i < 300; i++) {
      executeTicks(game, 1);
      if (army.tile() === last && army.targetTile() === undefined) break;
      last = army.tile();
    }
    expect(army.targetTile()).toBeUndefined();
    const resting = army.tile();
    const goal = game.ref(90, 50);
    game.addExecution(new MoveWarshipExecution(defender, [army.id()], goal));
    executeTicks(game, 2);
    expect(army.tile()).not.toBe(resting);
    // One tile a tick on the shortest way, give or take a tick.
    const steps = Math.max(
      Math.abs(game.x(resting) - 90),
      Math.abs(game.y(resting) - 50),
    );
    executeTicks(game, steps);
    expect(army.tile()).toBe(goal);
  });

  test("a shot at an attack's front kills 10% of its troops", () => {
    build(defender, UnitType.Factory, game.ref(90, 30));
    deployArmy(game.ref(90, 30));
    // A standing attack with one front tile in reach, no execution moving it.
    const attack = attacker.createAttack(defender, 100_000, null, new Set());
    attack.addBorderTile(game.ref(99, 30));
    executeTicks(game, 2);
    expect(defender.units(UnitType.Army)).toHaveLength(1);
    executeTicks(game, 20);
    expect(attack.troops()).toBe(90_000);
    // One shot per cooldown.
    executeTicks(game, 50);
    expect(attack.troops()).toBe(90_000);
    executeTicks(game, 60);
    expect(attack.troops()).toBe(81_000);
  });

  test("a hit is reported to both sides in the newsfeed", () => {
    build(defender, UnitType.Factory, game.ref(90, 30));
    const army = deployArmy(game.ref(90, 30));
    const attack = attacker.createAttack(defender, 100_000, null, new Set());
    attack.addBorderTile(game.ref(99, 30));
    const spy = vi.spyOn(game, "displayMessage");
    executeTicks(game, 22);
    const calls = spy.mock.calls.filter(([key]) =>
      String(key).startsWith("events_display.army_hit"),
    );
    expect(calls).toHaveLength(2);
    const [mine, theirs] = calls;
    expect(mine[0]).toBe("events_display.army_hit");
    expect(mine[2]).toBe(defender.id());
    expect(mine[4]).toEqual({ troops: "1.00K", name: attacker.displayName() });
    expect(mine[5]).toBe(army.id());
    expect(theirs[0]).toBe("events_display.army_hit_taken");
    expect(theirs[2]).toBe(attacker.id());
    expect(theirs[4]).toEqual({
      troops: "1.00K",
      name: defender.displayName(),
    });
  });

  test("it does not fire at an attack beyond its reach", () => {
    build(defender, UnitType.Factory, game.ref(10, 30));
    deployArmy(game.ref(10, 30));
    const attack = attacker.createAttack(defender, 100_000, null, new Set());
    attack.addBorderTile(game.ref(99, 30));
    executeTicks(game, 40);
    expect(attack.troops()).toBe(100_000);
  });

  test("a shot whose shell is gone before it lands does nothing", () => {
    const attack = attacker.createAttack(defender, 100_000, null, new Set());
    attack.addBorderTile(game.ref(99, 30));
    game.addExecution(
      new ArmyShotExecution(
        defender,
        game.ref(10, 30),
        game.ref(99, 30),
        attack,
        0,
      ),
    );
    executeTicks(game, 2);
    const shell = defender.units(UnitType.Shell)[0];
    expect(shell.isActive()).toBe(true);
    // As when its owner is eliminated mid-flight.
    shell.delete(false);
    expect(() => executeTicks(game, 40)).not.toThrow();
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

describe("Armies on a large realm", () => {
  test("a long order across the realm arrives", async () => {
    // The world map; the realm is all the nebula in a 500×350 box over Asia,
    // about 150k tiles: far more than a flood from the army could search.
    const game = await setup(
      "world",
      { infiniteGold: true, instantBuild: true },
      [new PlayerInfo("realm", PlayerType.Human, null, "realm_id")],
    );
    const realm = game.player("realm_id");
    const inBox = (x: number, y: number) =>
      x >= 1100 && x < 1600 && y >= 100 && y < 450;
    for (let x = 1100; x < 1600; x++) {
      for (let y = 100; y < 450; y++) {
        if (game.isLand(game.ref(x, y))) realm.conquer(game.ref(x, y));
      }
    }
    executeTicks(game, 20);
    let start: TileRef | null = null;
    for (let x = 1350; start === null; x++) {
      if (game.isLand(game.ref(x, 275))) start = game.ref(x, 275);
    }
    // The farthest tile of the start's landmass, by walking steps.
    const steps = new Map<TileRef, number>([[start, 0]]);
    const queue = [start];
    let goal = start;
    for (let head = 0; head < queue.length; head++) {
      const t = queue[head];
      if (steps.get(t)! > steps.get(goal)!) goal = t;
      game.forEachNeighborWithDiag(t, (n) => {
        if (steps.has(n) || !game.isLand(n) || game.isInDarkStar(n)) return;
        if (!inBox(game.x(n), game.y(n))) return;
        steps.set(n, steps.get(t)! + 1);
        queue.push(n);
      });
    }
    expect(steps.get(goal)!).toBeGreaterThan(200);

    game.addExecution(
      new ConstructionExecution(realm, UnitType.Factory, start),
    );
    executeTicks(game, 3);
    game.addExecution(new ConstructionExecution(realm, UnitType.Army, start));
    executeTicks(game, 3);
    const army = realm.units(UnitType.Army)[0];
    game.addExecution(new MoveWarshipExecution(realm, [army.id()], goal));
    let arrived = false;
    for (let i = 0; i < steps.get(goal)! + 100 && !arrived; i++) {
      executeTicks(game, 1);
      arrived = army.tile() === goal;
    }
    expect(arrived).toBe(true);
  }, 60_000);
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
