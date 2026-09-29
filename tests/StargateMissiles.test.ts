import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { GateShotExecution } from "../src/core/execution/GateShotExecution";
import { HegemonExecution } from "../src/core/execution/HegemonExecution";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
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

// Missiles under a Dark Star (docs/DarkStar-Design.md C4 and S6, revised
// 2026-09-28): the silo is gone, a warhead launches from the nearest ready
// stargate with the target in range and spends the gate's one charge; the
// throne fires from the Dark Star itself.
//
// big_plains is 200×200: the Dark Star's radius is 18 and the moat 15, so
// with the real range (180 at level 1) a gate anywhere reaches everything.
// ShortRange shrinks it so range can be tested at all.
class ShortRange extends TestConfig {
  stargateConfig() {
    return { ...super.stargateConfig(), rangeBase: 30, rangePerLevel: 10 };
  }
}

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

async function start(ConfigClass: typeof TestConfig = ShortRange) {
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
    { hegemon: { enabled: true }, disableNavMesh: false, instantBuild: true },
    humans,
    undefined,
    ConfigClass,
  );
  hegemon = game.hegemon()!;
  east = game.player("east");
  west = game.player("west");
  settle(east, 1, 30, 300_000);
  settle(west, -1, 30, 300_000);
  hegemon.addGold(50_000_000n);
  game.addExecution(new HegemonExecution());
  game.addExecution(new PlayerExecution(east));
  game.addExecution(new PlayerExecution(west));
  while (game.inSpawnPhase()) game.executeNextTick();
}

function buildGate(player: Player, tile: TileRef): Unit {
  game.addExecution(new ConstructionExecution(player, UnitType.Stargate, tile));
  executeTicks(game, 2);
  const gate = player.units(UnitType.Stargate).find((u) => u.tile() === tile);
  if (gate === undefined) throw new Error("gate not built");
  return gate;
}

function launch(player: Player, target: TileRef): Unit | undefined {
  game.addExecution(new NukeExecution(UnitType.AtomBomb, player, target));
  executeTicks(game, 2);
  return player.units(UnitType.AtomBomb)[0];
}

describe("The silo is gone (S6)", () => {
  beforeEach(() => start());

  test("missile silos are disabled under a Dark Star, whatever the lobby says", () => {
    expect(game.config().isUnitDisabled(UnitType.MissileSilo)).toBe(true);
    expect(east.canBuild(UnitType.MissileSilo, tileOf(east, 10))).toBe(false);
    const row = east
      .buildableUnits(tileOf(east, 10))
      .find((b) => b.type === UnitType.MissileSilo);
    expect(row?.canBuild).toBe(false);
  });

  test("with no gate a challenger has no missile", () => {
    expect(east.canBuild(UnitType.AtomBomb, tileOf(east, 40))).toBe(false);
    expect(east.canBuild(UnitType.HydrogenBomb, tileOf(east, 40))).toBe(false);
  });
});

describe("A stargate launches missiles (C4)", () => {
  beforeEach(() => start());

  test("the launch tile is the gate, for a target within the gate's range", () => {
    const gate = buildGate(east, tileOf(east, 10));
    // Neutral land 25 tiles out: in a level-1 gate's 30.
    expect(east.canBuild(UnitType.AtomBomb, tileOf(east, 35))).toBe(
      gate.tile(),
    );
    // 35 tiles out: beyond it, so no launcher.
    expect(east.canBuild(UnitType.AtomBomb, tileOf(east, 45))).toBe(false);
  });

  test("an upgrade extends the missile's reach with the gate's", () => {
    const gate = buildGate(east, tileOf(east, 10));
    expect(east.canBuild(UnitType.AtomBomb, tileOf(east, 45))).toBe(false);
    east.upgradeUnit(gate);
    expect(game.config().stargateRange(gate.level())).toBe(40);
    expect(east.canBuild(UnitType.AtomBomb, tileOf(east, 45))).toBe(
      gate.tile(),
    );
  });

  test("the nearest ready gate in range fires, not the nearest gate", () => {
    const near = buildGate(east, tileOf(east, 12));
    const far = buildGate(east, tileOf(east, 0, 12));
    const target = tileOf(east, 34);
    expect(east.canBuild(UnitType.AtomBomb, target)).toBe(near.tile());
    near.launch();
    // The far gate is 34 tiles off along x and 12 along y: out of range.
    expect(east.canBuild(UnitType.AtomBomb, target)).toBe(false);
    east.upgradeUnit(far);
    expect(east.canBuild(UnitType.AtomBomb, target)).toBe(far.tile());
  });

  test("a launch spends the gate's one charge, which reloads on the gate's clock", () => {
    const gate = buildGate(east, tileOf(east, 10));
    const target = tileOf(east, 35);
    const nuke = launch(east, target);
    expect(nuke).toBeDefined();
    expect(nuke!.tile()).not.toBe(target);
    expect(gate.missileTimerQueue()).toHaveLength(1);
    // Neither a second warhead nor a shot until the reload.
    expect(east.canBuild(UnitType.AtomBomb, target)).toBe(false);
    expect(east.stargateFor(target)?.readyInTicks).toBeGreaterThan(0);
    executeTicks(game, game.config().stargateCooldown() + 1);
    expect(gate.missileTimerQueue()).toHaveLength(0);
    expect(east.canBuild(UnitType.AtomBomb, target)).toBe(gate.tile());
  });

  test("a gate shot spends the charge a missile would need", () => {
    buildGate(east, tileOf(east, 10));
    const target = tileOf(east, 35);
    game.addExecution(new GateShotExecution(east, target, 1000));
    game.executeNextTick();
    expect(east.units(UnitType.Projectile)).toHaveLength(1);
    expect(east.canBuild(UnitType.AtomBomb, target)).toBe(false);
  });

  test("a level-3 gate still holds one shot", () => {
    const gate = buildGate(east, tileOf(east, 10));
    east.upgradeUnit(gate);
    east.upgradeUnit(gate);
    expect(gate.level()).toBe(3);
    launch(east, tileOf(east, 35));
    expect(east.canBuild(UnitType.AtomBomb, tileOf(east, 35))).toBe(false);
  });

  test("the launch flags the gate for a punitive strike (H19)", () => {
    const gate = buildGate(east, tileOf(east, 10));
    expect(gate.punitiveFlag()).toBeUndefined();
    launch(east, tileOf(east, 35));
    expect(gate.punitiveFlag()?.warhead).toBe(UnitType.AtomBomb);
  });

  test("a target beyond even a level-5 gate has no launcher", () => {
    buildGate(east, tileOf(east, 6));
    const target = tileOf(west, 2);
    // The gate is 2·33 + 8 = 74 tiles from the target: level 5 reaches 70,
    // so the real range is needed here.
    expect(east.canBuild(UnitType.AtomBomb, target)).toBe(false);
  });
});

describe("The throne's missiles (H2, revised 2026-09-28)", () => {
  beforeEach(() => start(TestConfig));

  test("fly from the Dark Star's centre, whatever the range", () => {
    const target = tileOf(east, 25);
    expect(hegemon.canBuild(UnitType.AtomBomb, target)).toBe(centre());
    expect(hegemon.canBuild(UnitType.HydrogenBomb, target)).toBe(centre());
    // Never a MIRV (S6).
    expect(hegemon.canBuild(UnitType.MIRV, target)).toBe(false);
  });

  test("cost the same gold as anyone's", () => {
    const cost = game.config().unitInfo(UnitType.AtomBomb).cost(game, hegemon);
    expect(cost).toBe(1_000_000n);
    expect(cost).toBe(
      game.config().unitInfo(UnitType.AtomBomb).cost(game, east),
    );
    const gold = hegemon.gold();
    launch(hegemon, tileOf(east, 25));
    expect(hegemon.gold()).toBe(gold - cost);
  });

  test("launch, fly and detonate, raising no flag anywhere", () => {
    const target = tileOf(east, 25);
    const eastTiles = east.numTilesOwned();
    const nuke = launch(hegemon, target);
    expect(nuke).toBeDefined();
    expect(game.isInDarkStar(nuke!.tile())).toBe(true);
    let ticks = 0;
    while (hegemon.units(UnitType.AtomBomb).length > 0 && ticks++ < 500) {
      game.executeNextTick();
    }
    expect(hegemon.units(UnitType.AtomBomb)).toHaveLength(0);
    expect(east.numTilesOwned()).toBeLessThan(eastTiles);
    for (const u of game.units(UnitType.Stargate)) {
      expect(u.punitiveFlag()).toBeUndefined();
    }
  });

  test("the build intent works for the throne as for anyone", () => {
    const target = tileOf(east, 25);
    game.addExecution(
      new ConstructionExecution(hegemon, UnitType.AtomBomb, target),
    );
    executeTicks(game, 3);
    expect(hegemon.units(UnitType.AtomBomb)).toHaveLength(1);
  });

  test("the throne's own build list carries its missiles on a challenger's tile", () => {
    const target = tileOf(east, 25);
    const rows = hegemon.buildableUnits(target, [
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
      UnitType.MIRV,
      UnitType.City,
    ]);
    expect(rows.find((r) => r.type === UnitType.AtomBomb)?.canBuild).toBe(
      centre(),
    );
    expect(rows.find((r) => r.type === UnitType.HydrogenBomb)?.canBuild).toBe(
      centre(),
    );
    expect(rows.find((r) => r.type === UnitType.MIRV)?.canBuild).toBe(false);
    // Structures stay gifts through the host (H18), never its own.
    expect(rows.find((r) => r.type === UnitType.City)?.canBuild).toBe(false);
  });

  test("never a captured gate: the centre is the launch tile even with one in hand", () => {
    const gate = buildGate(east, tileOf(east, 10));
    gate.setOwner(hegemon);
    expect(hegemon.units(UnitType.Stargate)).toHaveLength(1);
    expect(hegemon.canBuild(UnitType.AtomBomb, tileOf(west, 5))).toBe(centre());
    launch(hegemon, tileOf(west, 5));
    expect(gate.missileTimerQueue()).toHaveLength(0);
  });
});
