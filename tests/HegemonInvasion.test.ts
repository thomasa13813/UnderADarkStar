import { AttackExecution } from "../src/core/execution/AttackExecution";
import { DonateTroopsExecution } from "../src/core/execution/DonateTroopExecution";
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
import { GameUpdateType, PlayerUpdate } from "../src/core/game/GameUpdates";
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

  test("an evicted invader may land again at once: no cooldown", () => {
    east.conquer(domainShore(1));
    hegemon.conquer(domainShore(1));
    expect(game.darkStarInvader()).toBeNull();
    expect(game.canInvadeDarkStar(east)).toBe(true);
    expect(game.canInvadeDarkStar(west)).toBe(true);

    // The slot is free, so the boat sails on the tick it is ordered.
    game.addExecution(new TransportShipExecution(east, domainShore(1), 1000));
    executeTicks(game, 5);
    expect(east.units(UnitType.TransportShip)).toHaveLength(1);
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

  test("a donation to a stalled throne is sent once, not pinned and sent again", async () => {
    await start(PlayerType.Human);
    const g = game.darkStar()!;
    for (const tile of Array.from(hegemon.tiles())) {
      if (game.x(tile) > g.cx) east.conquer(tile);
    }
    east.setTroops(5_000_000);
    executeTicks(game, 70);
    const committed = hegemon.outgoingAttacks()[0].troops();
    const pinned = hegemon.troops();

    // The order itself throws the troops at the invader (H9); the attack
    // takes them back out of the pool the same tick, so H13's surplus
    // routing never sees them and the pool is not drained below its pin.
    // (The pool breathes by one second of regeneration around its pin, so the
    // bound below allows one surplus send; a second send of the donation
    // would drain it by 100k.)
    // West's gate reaches the Dark Star (GN5).
    west.buildUnit(UnitType.Stargate, Array.from(west.tiles())[0], {});
    game.addExecution(new DonateTroopsExecution(west, hegemon.id(), 100_000));
    executeTicks(game, 2);
    expect(hegemon.outgoingAttacks()).toHaveLength(1);
    expect(hegemon.outgoingAttacks()[0].troops()).toBeGreaterThanOrEqual(
      committed + 99_000,
    );
    expect(hegemon.outgoingAttacks()[0].troops()).toBeLessThan(
      committed + 110_000,
    );
    expect(hegemon.troops()).toBeGreaterThan(pinned - 5_000);
    executeTicks(game, 10);
    expect(hegemon.troops()).toBeGreaterThan(pinned - 5_000);
    expect(hegemon.troops()).toBeLessThan(pinned + 5_000);
    expect(west.troops()).toBeLessThan(110_000);
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

describe("The last stand (M4)", () => {
  // The invader takes the eastern share of the domain outright.
  function seize(invader: Player, share: number) {
    const g = game.darkStar()!;
    const cut = g.cx + g.radius - 2 * g.radius * share;
    for (const tile of Array.from(hegemon.tiles())) {
      if (game.x(tile) > cut) invader.conquer(tile);
    }
    invader.setTroops(5_000_000);
  }

  test("an AI Hegemon goes all in once enough of the domain is lost", async () => {
    await start(PlayerType.Nation);
    const cfg = game.config().hegemonConfig();
    const g = game.darkStar()!;
    seize(east, 0.5);
    expect(east.domainTilesHeld() * 100).toBeGreaterThanOrEqual(
      g.domainTileCount * cfg.lastStandDomainLostPercent,
    );
    const ceiling = game.config().maxTroops(hegemon);
    const before = hegemon.troops();

    executeTicks(game, 12);
    const attack = hegemon.outgoingAttacks().find((a) => a.target() === east);
    expect(attack).toBeDefined();
    // Everything above the reserve, not a 20% wave (plus up to a second of
    // refill since the last send).
    const reserve = (ceiling * cfg.lastStandReservePercent) / 100;
    const slack = 10 * game.config().hegemonTroopsPerTick() + 1;
    expect(hegemon.troops()).toBeLessThanOrEqual(reserve + slack);
    expect(hegemon.troops()).toBeLessThan(before * 0.5);

    // And it stays in: a donation is sent after the invader within a second.
    hegemon.addTroops(200_000);
    executeTicks(game, 11);
    expect(hegemon.troops()).toBeLessThanOrEqual(reserve + slack);
  });

  test("a smaller foothold gets the ordinary waves", async () => {
    await start(PlayerType.Nation);
    const cfg = game.config().hegemonConfig();
    const g = game.darkStar()!;
    seize(east, 0.15);
    expect(east.domainTilesHeld() * 100).toBeLessThan(
      g.domainTileCount * cfg.lastStandDomainLostPercent,
    );
    const before = hegemon.troops();
    executeTicks(game, 12);
    // One 20% wave, and a forced wave at most: well over half the pool stays.
    expect(hegemon.troops()).toBeGreaterThan(before * 0.6);
  });

  test("a human Hegemon is left to make its own last stand", async () => {
    await start(PlayerType.Human);
    seize(east, 0.5);
    const before = hegemon.troops();
    executeTicks(game, 12);
    expect(hegemon.troops()).toBeGreaterThan(before * 0.6);
  });
});

describe("An invader gains nothing from the Dark Star (H5)", () => {
  beforeEach(() => start(PlayerType.Human));

  test("domain tiles raise neither its troop cap nor its combat bonuses", () => {
    const config = game.config();
    const tiles = east.numTilesOwned();
    const cap = config.maxTroops(east);

    const g = game.darkStar()!;
    for (const tile of Array.from(hegemon.tiles())) {
      if (game.x(tile) > g.cx) east.conquer(tile);
    }
    expect(east.numTilesOwned()).toBeGreaterThan(tiles * 3);
    expect(east.domainTilesHeld()).toBe(east.numTilesOwned() - tiles);
    expect(config.maxTroops(east)).toBe(cap);

    // Land outside the Dark Star still counts.
    east.conquer(game.ref(0, 0));
    expect(config.maxTroops(east)).toBeGreaterThan(cap);
  });

  test("the client is told who holds what, for the HUD", () => {
    const eastUpdate = () =>
      (game.executeNextTick()[GameUpdateType.Player] as PlayerUpdate[]).find(
        (u) => u.id === east.id(),
      );
    eastUpdate();
    east.conquer(domainShore(1));
    east.setTroops(0);
    expect(eastUpdate()?.domainTilesHeld).toBe(1);

    // Stalled after 5 s: flagged until the forced wave evicts it.
    let sawStalled = false;
    for (let i = 0; i < 80; i++) {
      const update = eastUpdate(); // ticks the game: not inside the ||=
      sawStalled ||= update?.invasionStalled === true;
    }
    expect(sawStalled).toBe(true);
    expect(game.darkStarInvader()).toBeNull();
    expect(east.domainTilesHeld()).toBe(0);
  });
});

describe("An invader must keep a homeland (H20)", () => {
  beforeEach(() => start(PlayerType.Human));

  // Half the domain: more than the engine's 100-tile mop-up would take.
  function seizeHalf(invader: Player) {
    const g = game.darkStar()!;
    for (const tile of Array.from(hegemon.tiles())) {
      if (game.x(tile) > g.cx) invader.conquer(tile);
    }
    expect(invader.domainTilesHeld()).toBeGreaterThan(100);
  }

  function homeland(player: Player): TileRef[] {
    return Array.from(player.tiles()).filter((t) => !game.isInDarkStar(t));
  }

  test("keeps its foothold while it holds any nebula beyond the moat", () => {
    seizeHalf(east);
    const held = east.domainTilesHeld();
    const land = homeland(east);
    for (const tile of land.slice(1)) west.conquer(tile);
    expect(homeland(east)).toHaveLength(1);
    expect(game.darkStarInvader()).toBe(east);
    expect(east.domainTilesHeld()).toBe(held);
  });

  test("is out when its last nebula falls; the Dark Star is whole again and the taker has the kill", () => {
    seizeHalf(east);
    const land = homeland(east);
    for (const tile of land.slice(1)) west.conquer(tile);
    east.setTroops(0);
    game.addExecution(new AttackExecution(10_000, west, east.id()));

    let conqueror: string | null = null;
    for (let i = 0; i < 50 && conqueror === null; i++) {
      const events = game.executeNextTick()[GameUpdateType.ConquestEvent];
      const kill = events.find((e) => e.conqueredId === east.id());
      if (kill !== undefined) conqueror = kill.conquerorId;
    }
    expect(conqueror).toBe(west.id());
    expect(east.numTilesOwned()).toBe(0);
    expect(game.darkStarInvader()).toBeNull();
    expect(game.hegemonDomainTiles()).toBe(game.darkStar()!.domainTileCount);
    executeTicks(game, 2);
    expect(east.isAlive()).toBe(false);
    // The slot is free for the next challenger.
    expect(game.canInvadeDarkStar(west)).toBe(true);
  });

  test("land lost to nobody counts too", () => {
    seizeHalf(east);
    for (const tile of homeland(east)) east.relinquish(tile);
    expect(east.numTilesOwned()).toBe(0);
    expect(game.hegemonDomainTiles()).toBe(game.darkStar()!.domainTileCount);
    executeTicks(game, 2);
    expect(east.isAlive()).toBe(false);
  });
});
