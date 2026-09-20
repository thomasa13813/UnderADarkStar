import { HegemonExecution } from "../src/core/execution/HegemonExecution";
import { TransportShipExecution } from "../src/core/execution/TransportShipExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { canBuildTransportShip } from "../src/core/game/TransportShipUtils";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let hegemon: Player;
let east: Player;
let west: Player;

// A block of land on the moat's outer shore, east (+1) or west (-1).
function settleOuterShore(player: Player, side: 1 | -1) {
  const g = game.darkStar()!;
  const outer = g.radius + g.moatWidth;
  game.forEachTile((tile) => {
    const dx = (game.x(tile) - g.cx) * side - outer;
    const dy = game.y(tile) - g.cy;
    if (dx >= 0 && dx < 12 && Math.abs(dy) < 6 && game.isLand(tile)) {
      player.conquer(tile);
    }
  });
  player.setTroops(200_000);
}

function domainShore(side: 1 | -1): TileRef {
  const g = game.darkStar()!;
  return game.ref(g.cx + side * g.radius, g.cy);
}

function domainTiles(player: Player): TileRef[] {
  return Array.from(player.tiles()).filter((t) => game.isInDarkStar(t));
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
    { hegemon: { enabled: true }, disableNavMesh: false },
    humans,
  );
  hegemon = game.hegemon()!;
  east = game.player("east");
  west = game.player("west");
  settleOuterShore(east, 1);
  settleOuterShore(west, -1);
  game.addExecution(new HegemonExecution());
}

describe("The invasion slot (H6, H12)", () => {
  beforeEach(() => start(PlayerType.Nation));

  test("belongs to whoever holds a domain tile", () => {
    expect(game.darkStarInvader()).toBeNull();
    expect(game.canInvadeDarkStar(east)).toBe(true);
    expect(game.canInvadeDarkStar(west)).toBe(true);
    expect(game.canInvadeDarkStar(hegemon)).toBe(false);

    east.conquer(domainShore(1));
    expect(game.darkStarInvader()).toBe(east);
    expect(game.domainTilesHeldBy(east)).toBe(1);
    expect(game.canInvadeDarkStar(east)).toBe(true);
    expect(game.canInvadeDarkStar(west)).toBe(false);
    // The UI and the AI ask this before offering a boat.
    expect(canBuildTransportShip(game, west, domainShore(-1))).toBe(false);
    expect(canBuildTransportShip(game, east, domainShore(-1))).not.toBe(false);
  });

  test("an evicted invader waits out the cooldown; others are free to go", () => {
    east.conquer(domainShore(1));
    hegemon.conquer(domainShore(1));
    expect(game.darkStarInvader()).toBeNull();
    expect(game.invasionCooldownTicks(east)).toBe(5 * 60 * 10);
    expect(game.canInvadeDarkStar(east)).toBe(false);
    expect(game.canInvadeDarkStar(west)).toBe(true);

    game.addExecution(new TransportShipExecution(east, domainShore(1), 1000));
    executeTicks(game, 5);
    expect(east.units(UnitType.TransportShip)).toHaveLength(0);

    executeTicks(game, 5 * 60 * 10);
    expect(game.canInvadeDarkStar(east)).toBe(true);
  });

  test("a fleet bound for the Dark Star turns back when someone else lands", () => {
    game.addExecution(new TransportShipExecution(east, domainShore(1), 50_000));
    executeTicks(game, 3);
    game.addExecution(
      new TransportShipExecution(west, domainShore(-1), 50_000),
    );
    executeTicks(game, 3);
    expect(west.units(UnitType.TransportShip)).toHaveLength(1);
    const westTroops = west.troops();

    let landed = false;
    for (let i = 0; i < 300; i++) {
      game.executeNextTick();
      landed ||= game.darkStarInvader() === east;
      // Only ever the Hegemon and one invader on the Dark Star.
      expect(domainTiles(west)).toHaveLength(0);
    }
    expect(landed).toBe(true);
    expect(west.units(UnitType.TransportShip)).toHaveLength(0);
    // Home whole (plus what it regenerated meanwhile), and free to try later.
    expect(west.troops()).toBeGreaterThanOrEqual(westTroops + 50_000);
    expect(game.invasionCooldownTicks(west)).toBe(0);
  });
});

describe("The Dark Star fights back (H13)", () => {
  test("an AI Hegemon answers a landing at once", async () => {
    await start(PlayerType.Nation);
    const before = hegemon.troops();
    east.conquer(domainShore(1));
    executeTicks(game, 3);
    const attacks = hegemon.outgoingAttacks();
    expect(attacks).toHaveLength(1);
    expect(attacks[0].target()).toBe(east);
    expect(hegemon.troops()).toBeLessThan(before * 0.85);

    executeTicks(game, 200);
    expect(game.darkStarInvader()).toBeNull();
    expect(hegemon.numTilesOwned()).toBe(game.darkStar()!.domainTileCount);
  });

  test("a human Hegemon is left to its own defence until the invasion stalls", async () => {
    await start(PlayerType.Human);
    expect(hegemon.name()).toBe("throne");
    east.conquer(domainShore(1));
    east.setTroops(0); // nothing to push on with: the invasion will stall

    const troops = hegemon.troops();
    executeTicks(game, 40);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
    expect(hegemon.troops()).toBe(troops);
    expect(game.darkStarInvader()).toBe(east);

    executeTicks(game, 30); // 5 s without a gain: a wave is forced, and evicts
    expect(game.darkStarInvader()).toBeNull();
    expect(game.invasionCooldownTicks(east)).toBeGreaterThan(0);
  });

  test("while stalled, everything the Hegemon gains is sent after the invader", async () => {
    await start(PlayerType.Human);
    const g = game.darkStar()!;
    // A deep beachhead, so the counter-attack is still running when we look.
    for (const tile of Array.from(hegemon.tiles())) {
      if (game.x(tile) > g.cx) east.conquer(tile);
    }
    east.setTroops(5_000_000);
    executeTicks(game, 70);
    const committed = hegemon.outgoingAttacks()[0].troops();
    const pinned = hegemon.troops();

    hegemon.addTroops(100_000); // a donation, say
    executeTicks(game, 11);
    expect(hegemon.troops()).toBeLessThanOrEqual(pinned);
    expect(hegemon.outgoingAttacks()[0].troops()).toBeGreaterThan(
      committed + 50_000,
    );
  });

  test("an invader that advances again is no longer stalled", async () => {
    await start(PlayerType.Human);
    const g = game.darkStar()!;
    for (const tile of Array.from(hegemon.tiles())) {
      if (game.x(tile) > g.cx) east.conquer(tile);
    }
    east.setTroops(5_000_000);
    executeTicks(game, 70); // stalled, forced wave sent
    const pinned = hegemon.troops();

    // The invader takes another tile: the forced routing switches off.
    const next = Array.from(hegemon.borderTiles()).find((t) =>
      game.neighbors(t).some((n) => game.owner(n) === east),
    )!;
    east.conquer(next);
    executeTicks(game, 1);
    hegemon.addTroops(100_000);
    executeTicks(game, 20);
    expect(hegemon.troops()).toBeGreaterThanOrEqual(pinned + 100_000);
  });
});
