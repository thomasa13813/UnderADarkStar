import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { NationStructureBehavior } from "../src/core/execution/nation/NationStructureBehavior";
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

// Lords under a Dark Star (docs/DarkStar-Rework.md Q15, Q16, Tom 2026-10-25):
// they save towards one 5M warhead, not five, so they still fire; and once
// a Lord owns one of every other building it shields one Defense Post.
//
// big_plains is 200×200: the Dark Star's radius is 18 and the moat 15.

let game: Game;
let lord: Player;

function tileOf(dx: number, dy = 0): TileRef {
  const g = game.darkStar()!;
  return game.ref(g.cx + g.radius + g.moatWidth + dx, g.cy + dy);
}

function build(type: UnitType, tile: TileRef) {
  game.addExecution(new ConstructionExecution(lord, type, tile));
  executeTicks(game, 2);
  expect(lord.units(type).length).toBeGreaterThan(0);
}

beforeEach(async () => {
  game = await setup(
    "big_plains",
    { hegemon: { enabled: true }, instantBuild: true },
    [new PlayerInfo("lord", PlayerType.Nation, null, "lord")],
  );
  lord = game.player("lord");
  const g = game.darkStar()!;
  const outer = g.radius + g.moatWidth;
  game.forEachTile((tile) => {
    const dx = game.x(tile) - g.cx - outer;
    const dy = game.y(tile) - g.cy;
    if (dx >= 0 && dx < 60 && Math.abs(dy) < 50 && game.isLand(tile)) {
      lord.conquer(tile);
    }
  });
  while (game.inSpawnPhase()) game.executeNextTick();
  lord.addGold(50_000_000n);
});

function behaviour(): NationStructureBehavior {
  // A hegemon behaviour marks a Dark Star Lord, whose gates are its launchers.
  return new NationStructureBehavior(
    new PseudoRandom(1),
    game,
    lord,
    {} as never,
  );
}

test("a Lord saves towards one 5M warhead, not five (Q15)", () => {
  expect((behaviour() as any).getSaveUpTarget()).toBe(5_000_000n);
});

describe("one Shield Array once it has one of everything else (Q16)", () => {
  function buildAllButGate() {
    build(UnitType.City, tileOf(10, -30));
    build(UnitType.Factory, tileOf(30, -30));
    build(UnitType.Port, tileOf(50, -30));
    build(UnitType.DefensePost, tileOf(30, 0));
  }

  test("shields the post once the set is complete", () => {
    buildAllButGate();
    const b = behaviour();
    expect((b as any).maybeShieldAPost()).toBe(false);
    build(UnitType.Stargate, tileOf(10, 30));
    expect((b as any).maybeShieldAPost()).toBe(true);
    executeTicks(game, 2);
    const arrays = lord.units(UnitType.ShieldArray);
    expect(arrays).toHaveLength(1);
    expect(arrays[0].tile()).toBe(tileOf(30, 0));
    // One only.
    expect((b as any).maybeShieldAPost()).toBe(false);
  });

  test("not without the gold", () => {
    buildAllButGate();
    build(UnitType.Stargate, tileOf(10, 30));
    lord.removeGold(lord.gold());
    lord.addGold(1_000_000n);
    expect((behaviour() as any).maybeShieldAPost()).toBe(false);
  });
});
