import { AttackExecution } from "../src/core/execution/AttackExecution";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { HegemonExecution } from "../src/core/execution/HegemonExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { RazeExecution } from "../src/core/execution/RazeExecution";
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

let game: Game;
let hegemon: Player;
let east: Player;
let west: Player;

// A block of land beyond the moat's outer shore, east (+1) or west (-1).
function settle(
  player: Player,
  side: 1 | -1,
  depth: number,
  troops: number,
  halfHeight = 10,
) {
  const g = game.darkStar()!;
  const outer = g.radius + g.moatWidth;
  game.forEachTile((tile) => {
    const dx = (game.x(tile) - g.cx) * side - outer;
    const dy = game.y(tile) - g.cy;
    if (
      dx >= 0 &&
      dx < depth &&
      Math.abs(dy) < halfHeight &&
      game.isLand(tile)
    ) {
      player.conquer(tile);
    }
  });
  player.setTroops(troops);
}

function anyTile(player: Player): TileRef {
  return Array.from(player.tiles())[0];
}

async function start(hegemonType: PlayerType) {
  const humans = [
    new PlayerInfo("east", PlayerType.Human, "client1", "east"),
    new PlayerInfo("west", PlayerType.Human, "client2", "west"),
  ];
  if (hegemonType === PlayerType.Human) {
    humans.push(
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
    );
  }
  game = await setup(
    "big_plains",
    { hegemon: { enabled: true }, disableNavMesh: false, instantBuild: true },
    humans,
  );
  hegemon = game.hegemon()!;
  east = game.player("east");
  west = game.player("west");
  settle(east, 1, 20, 100_000);
  settle(west, -1, 20, 100_000);
  game.addExecution(new HegemonExecution());
  while (game.inSpawnPhase()) game.executeNextTick();
}

describe("Razing (H8)", () => {
  beforeEach(() => start(PlayerType.Human));

  test("a strike lands after its flight and razes the target's land to neutral", () => {
    const tiles = east.numTilesOwned();
    const troops = hegemon.troops();
    game.addExecution(new RazeExecution(hegemon, anyTile(east), 500_000));
    executeTicks(game, 5);
    // In flight: paid for (less a few ticks' regeneration), nothing hit yet.
    expect(hegemon.troops()).toBeLessThan(troops - 450_000);
    expect(east.numTilesOwned()).toBe(tiles);

    executeTicks(game, 300);
    expect(east.numTilesOwned()).toBeLessThan(tiles / 2);
    // Razed, not conquered: the Hegemon never owns land beyond the Dark Star.
    expect(hegemon.numTilesOwned()).toBe(game.darkStar()!.domainTileCount);
    for (const tile of hegemon.tiles()) {
      expect(game.isInDarkStar(tile)).toBe(true);
    }
    expect(west.numTilesOwned()).toBeGreaterThan(0);
  });

  test("it pays the normal price, and the survivors come home", () => {
    game.addExecution(new RazeExecution(hegemon, anyTile(east), 2_000_000));
    executeTicks(game, 5);
    const afterLaunch = hegemon.troops();
    executeTicks(game, 600);
    // Enough to raze east entirely: east is out, the strike is over.
    expect(east.numTilesOwned()).toBe(0);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
    const returned = hegemon.troops() - afterLaunch;
    expect(returned).toBeGreaterThan(0);
    expect(returned).toBeLessThan(2_000_000);
  });

  test("structures on razed land are destroyed", () => {
    const city = anyTile(east);
    // What a spawn registers; it is this that clears units off unowned land.
    game.addExecution(new PlayerExecution(east));
    east.addGold(10_000_000n);
    game.addExecution(new ConstructionExecution(east, UnitType.City, city));
    executeTicks(game, 5);
    expect(east.units(UnitType.City)).toHaveLength(1);

    game.addExecution(new RazeExecution(hegemon, city, 2_000_000));
    executeTicks(game, 600);
    expect(east.units(UnitType.City)).toHaveLength(0);
    expect(hegemon.units(UnitType.City)).toHaveLength(0);
    expect(west.units(UnitType.City)).toHaveLength(0);
  });

  test("a strike cannot be aimed at the Dark Star or at unowned land", () => {
    const g = game.darkStar()!;
    const troops = hegemon.troops();
    east.conquer(game.ref(g.cx + g.radius, g.cy));
    game.addExecution(
      new RazeExecution(hegemon, game.ref(g.cx + g.radius, g.cy), 100_000),
    );
    game.addExecution(new RazeExecution(hegemon, game.ref(0, 0), 100_000));
    game.addExecution(new RazeExecution(east, anyTile(west), 50_000));
    executeTicks(game, 3);
    expect(hegemon.troops()).toBeGreaterThanOrEqual(troops);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
    expect(east.outgoingAttacks()).toHaveLength(0);
  });

  test("defending the Dark Star does not absorb a strike on the invader's homeland", () => {
    const g = game.darkStar()!;
    game.addExecution(new RazeExecution(hegemon, anyTile(east), 300_000));
    executeTicks(game, 60);
    expect(hegemon.outgoingAttacks()).toHaveLength(1);

    for (const tile of Array.from(hegemon.tiles())) {
      if (game.x(tile) > g.cx + g.radius - 10) east.conquer(tile);
    }
    game.addExecution(new AttackExecution(200_000, hegemon, east.id()));
    executeTicks(game, 2);
    expect(hegemon.outgoingAttacks()).toHaveLength(2);
  });
});

describe("Punitive strikes (H11)", () => {
  test("an idle AI Hegemon strikes the strongest challenger once it is a threat", async () => {
    await start(PlayerType.Nation);
    const cfg = game.config().hegemonConfig();
    // Too small to be a threat: left alone however long the Hegemon idles.
    executeTicks(game, (cfg.punitiveFullSeconds + 10) * 10);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);

    settle(west, -1, 60, 100_000, 40);
    const tiles = west.numTilesOwned();
    const eastTiles = east.numTilesOwned();
    let struck = false;
    for (let i = 0; i < (cfg.punitiveFullSeconds + 60) * 10; i++) {
      game.executeNextTick();
      struck ||= hegemon.outgoingAttacks().some((a) => a.target() === west);
    }
    expect(struck).toBe(true);
    expect(west.numTilesOwned()).toBeLessThan(tiles);
    expect(east.numTilesOwned()).toBeGreaterThanOrEqual(eastTiles);
  });

  test("the strike is recalled when the Dark Star is invaded", async () => {
    await start(PlayerType.Nation);
    const cfg = game.config().hegemonConfig();
    settle(west, -1, 60, 100_000, 40);
    let ticks = 0;
    while (
      !hegemon.outgoingAttacks().some((a) => a.target() === west) &&
      ticks++ < (cfg.punitiveFullSeconds + 60) * 10
    ) {
      game.executeNextTick();
    }
    expect(hegemon.outgoingAttacks().some((a) => a.target() === west)).toBe(
      true,
    );

    const g = game.darkStar()!;
    east.conquer(game.ref(g.cx + g.radius, g.cy));
    executeTicks(game, 3);
    expect(hegemon.outgoingAttacks().some((a) => a.target() === west)).toBe(
      false,
    );
  });

  test("a human Hegemon is never made to strike", async () => {
    await start(PlayerType.Human);
    settle(west, -1, 60, 100_000, 40);
    executeTicks(game, 1500);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
  });
});
