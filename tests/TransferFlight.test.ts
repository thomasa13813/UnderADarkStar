import { DonateGoldExecution } from "../src/core/execution/DonateGoldExecution";
import { DonateTroopsExecution } from "../src/core/execution/DonateTroopExecution";
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
import { executeTicks, landTransfers } from "./util/utils";

// Transfers in flight (GN2, revised 2026-10-28): under a Dark Star troops and
// gold leave the sender at once as a projectile from its gate nearest the
// recipient (the throne's from the Dark Star's centre), aimed at the
// recipient's tile nearest that gate, and arrive only on impact. If the tile
// is no longer the recipient's when it lands the cargo goes home whole.
//
// big_plains is 200×200, the Dark Star's radius 18 and the moat 15. Short
// range keeps the geometry readable: 30 tiles at level 1.
class ShortRange extends TestConfig {
  stargateConfig() {
    return { ...super.stargateConfig(), rangeBase: 30, rangePerLevel: 10 };
  }
}

let game: Game;
let hegemon: Player;
let east: Player;
let west: Player;
let north: Player;
let gateTile: TileRef;
// East's lone outpost within reach of west's gate: the aim of every transfer
// west sends east.
let outpost: TileRef;

// A block beyond the moat's outer shore, east (+1) or west (-1).
function settle(player: Player, side: 1 | -1) {
  const g = game.darkStar()!;
  const outer = g.radius + g.moatWidth;
  game.forEachTile((tile) => {
    const dx = (game.x(tile) - g.cx) * side - outer;
    const dy = game.y(tile) - g.cy;
    if (dx >= 0 && dx < 20 && Math.abs(dy) < 10 && game.isLand(tile)) {
      player.conquer(tile);
    }
  });
  player.setTroops(100_000);
  player.addGold(10_000_000n);
}

function tileOf(side: 1 | -1, dx: number, dy = 0): TileRef {
  const g = game.darkStar()!;
  return game.ref(g.cx + side * (g.radius + g.moatWidth + dx), g.cy + dy);
}

function inFlight(): Unit[] {
  return game.units(UnitType.Projectile);
}

beforeEach(async () => {
  const humans = [
    new PlayerInfo("east", PlayerType.Human, "c1", "east"),
    new PlayerInfo("west", PlayerType.Human, "c2", "west"),
    new PlayerInfo("north", PlayerType.Human, "c3", "north"),
    new PlayerInfo(
      "throne",
      PlayerType.Human,
      "c4",
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
      donateGold: true,
      donateTroops: true,
      instantBuild: true,
    },
    humans,
    undefined,
    ShortRange,
  );
  hegemon = game.hegemon()!;
  east = game.player("east");
  west = game.player("west");
  north = game.player("north");
  settle(east, 1);
  settle(west, -1);
  north.conquer(tileOf(-1, 40, 40));
  gateTile = tileOf(-1, 0);
  west.buildUnit(UnitType.Stargate, gateTile, {});
  outpost = tileOf(-1, 25, 15);
  east.conquer(outpost);
  east.setTroops(10_000);
  // No PlayerExecution: the outpost would be tidied away.
  while (game.inSpawnPhase()) game.executeNextTick();
});

describe("A transfer flies (GN2)", () => {
  test("troops leave at launch from the gate and land on the nearest tile", () => {
    const westBefore = west.troops();
    game.addExecution(new DonateTroopsExecution(west, east.id(), 20_000));
    executeTicks(game, 2);

    const shots = inFlight();
    expect(shots).toHaveLength(1);
    const shot = shots[0];
    expect(shot.owner()).toBe(west);
    expect(shot.targetTile()).toBe(outpost);
    expect(shot.troops()).toBe(20_000);
    expect(shot.toUpdate().transfer).toBe(true);
    // Gone from the sender, not yet with the recipient.
    expect(west.troops()).toBe(westBefore - 20_000);
    expect(east.troops()).toBe(10_000);
    // The cooldown runs from launch (GN6).
    expect(west.canDonateTroops(east)).toBe(false);

    landTransfers(game);
    expect(inFlight()).toHaveLength(0);
    expect(east.troops()).toBe(30_000);
    expect(west.troops()).toBe(westBefore - 20_000);
  });

  test("the flight starts at the gate and spends none of its charge", () => {
    game.addExecution(new DonateGoldExecution(west, east.id(), 1_000_000));
    executeTicks(game, 2);
    const shot = inFlight()[0];
    // The first step of the arc is near the gate, not the outpost.
    expect(game.manhattanDist(shot.tile(), gateTile)).toBeLessThan(
      game.manhattanDist(shot.tile(), outpost),
    );
    const gate = west.units(UnitType.Stargate)[0];
    expect(gate.missileTimerQueue()).toHaveLength(0);
  });

  test("gold leaves at launch and lands on impact", () => {
    const westGold = west.gold();
    const eastGold = east.gold();
    game.addExecution(new DonateGoldExecution(west, east.id(), 1_000_000));
    executeTicks(game, 2);
    expect(inFlight()).toHaveLength(1);
    expect(inFlight()[0].troops()).toBe(0);
    expect(west.gold()).toBe(westGold - 1_000_000n);
    expect(east.gold()).toBe(eastGold);

    landTransfers(game);
    expect(east.gold()).toBe(eastGold + 1_000_000n);
    expect(west.gold()).toBe(westGold - 1_000_000n);
  });

  test("the throne fires from the Dark Star's centre", () => {
    const g = game.darkStar()!;
    const centre = game.ref(g.cx, g.cy);
    game.addExecution(new DonateTroopsExecution(hegemon, west.id(), 10_000));
    executeTicks(game, 2);
    const shot = inFlight()[0];
    expect(shot.owner()).toBe(hegemon);
    expect(game.owner(shot.targetTile()!)).toBe(west);
    expect(game.manhattanDist(shot.tile(), centre)).toBeLessThan(
      game.manhattanDist(shot.tile(), shot.targetTile()!),
    );
    const before = west.troops();
    landTransfers(game);
    expect(west.troops()).toBe(before + 10_000);
  });

  test("supplies for the throne land on the Dark Star", () => {
    west.buildUnit(UnitType.Stargate, tileOf(-1, 3, 6), {});
    hegemon.setTroops(game.config().maxTroops(hegemon) - 100_000);
    const before = hegemon.troops();
    game.addExecution(new DonateTroopsExecution(west, hegemon.id(), 20_000));
    executeTicks(game, 2);
    expect(game.owner(inFlight()[0].targetTile()!)).toBe(hegemon);
    landTransfers(game);
    expect(hegemon.troops()).toBe(before + 20_000);
  });
});

describe("A transfer whose tile changes hands goes home (GN2)", () => {
  test("troops come home whole on impact", () => {
    const westBefore = west.troops();
    game.addExecution(new DonateTroopsExecution(west, east.id(), 20_000));
    executeTicks(game, 2);
    north.conquer(outpost);
    // Still in the air: nothing has come back yet.
    expect(west.troops()).toBe(westBefore - 20_000);
    landTransfers(game);
    expect(east.troops()).toBe(10_000);
    expect(west.troops()).toBe(westBefore);
  });

  test("gold comes home whole, and is not counted as income", () => {
    const westGold = west.gold();
    const earned = west.goldEarned();
    const eastGold = east.gold();
    game.addExecution(new DonateGoldExecution(west, east.id(), 1_000_000));
    executeTicks(game, 2);
    north.conquer(outpost);
    landTransfers(game);
    expect(east.gold()).toBe(eastGold);
    expect(west.gold()).toBe(westGold);
    expect(west.goldEarned()).toBe(earned);
  });

  test("it fails even if the recipient holds the tile again by then", () => {
    const westBefore = west.troops();
    game.addExecution(new DonateTroopsExecution(west, east.id(), 20_000));
    executeTicks(game, 2);
    north.conquer(outpost);
    executeTicks(game, 1);
    east.conquer(outpost);
    landTransfers(game);
    // It changed hands in flight: the troops come home all the same.
    expect(east.troops()).toBe(10_000);
    expect(west.troops()).toBe(westBefore);
  });
});

describe("Other outcomes in flight", () => {
  test("troops beyond the recipient's room come home", () => {
    const max = Math.floor(game.config().maxTroops(east));
    const westBefore = west.troops();
    game.addExecution(new DonateTroopsExecution(west, east.id(), 20_000));
    executeTicks(game, 2);
    east.setTroops(max - 5_000);
    landTransfers(game);
    expect(east.troops()).toBe(max);
    expect(west.troops()).toBe(westBefore - 5_000);
  });

  test("a sender who dies in flight loses the cargo", () => {
    const eastGold = east.gold();
    game.addExecution(new DonateGoldExecution(west, east.id(), 1_000_000));
    executeTicks(game, 2);
    for (const tile of Array.from(west.tiles())) north.conquer(tile);
    expect(west.isAlive()).toBe(false);
    landTransfers(game);
    expect(inFlight()).toHaveLength(0);
    expect(east.gold()).toBe(eastGold);
  });
});
