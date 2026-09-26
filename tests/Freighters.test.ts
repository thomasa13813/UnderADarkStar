import { PortExecution } from "../src/core/execution/PortExecution";
import { TradeShipExecution } from "../src/core/execution/TradeShipExecution";
import { WarshipExecution } from "../src/core/execution/WarshipExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { unpackMotionPlans } from "../src/core/game/MotionPlans";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// Freighters overland (S7, docs/DarkStar-Design.md §6.18): a trade ship
// sails in three legs — overland to its port's harbour at half speed, across
// deep space, overland into the destination port — never crossing the Dark
// Star's disc, and out of a destroyer's reach while on land.

// Every tile the ship stood on, with the tick it got there.
function trace(
  game: Game,
  owner: () => Unit | undefined,
  maxTicks: number,
): { tile: TileRef; tick: number }[] {
  const out: { tile: TileRef; tick: number }[] = [];
  let last: TileRef | undefined;
  for (let i = 0; i < maxTicks; i++) {
    game.executeNextTick();
    const ship = owner();
    if (ship === undefined || !ship.isActive()) {
      if (out.length > 0) break;
      continue;
    }
    if (ship.tile() !== last) {
      last = ship.tile();
      out.push({ tile: last, tick: game.ticks() });
    }
  }
  return out;
}

describe("Freighters on half_land_half_ocean", () => {
  // 16×16: x < 8 is land, x >= 8 one body of water.
  let game: Game;
  let north: Player;
  let south: Player;

  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("north", PlayerType.Human, null, "north"),
        new PlayerInfo("south", PlayerType.Human, null, "south"),
        new PlayerInfo("pirate", PlayerType.Human, null, "pirate"),
      ],
    );
    north = game.player("north");
    south = game.player("south");
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 16; y++) {
        (y < 8 ? north : south).conquer(game.ref(x, y));
      }
    }
    executeTicks(game, 50);
    game.config().structureMinDist = () => 5;
  });

  test("inland ports pair through their harbours", () => {
    const a = north.buildUnit(UnitType.Port, game.ref(1, 2), {});
    south.buildUnit(UnitType.Port, game.ref(1, 13), {});
    const exec = new PortExecution(a);
    exec.init(game, 0);
    expect(exec.tradingPorts().length).toBeGreaterThan(0);
    // A port with no harbour trades with nobody.
    game.config().harbourMaxRange = () => 2;
    const far = north.buildUnit(UnitType.Port, game.ref(1, 5), {});
    const farExec = new PortExecution(far);
    farExec.init(game, 0);
    expect(farExec.tradingPorts()).toHaveLength(0);
  });

  test("a freighter crawls overland, sails deep space, and crawls in", () => {
    const src = north.buildUnit(UnitType.Port, game.ref(1, 2), {});
    const dst = south.buildUnit(UnitType.Port, game.ref(1, 13), {});
    const goldNorth = north.gold();
    const goldSouth = south.gold();
    game.addExecution(new TradeShipExecution(north, src, dst));
    const steps = trace(game, () => north.units(UnitType.TradeShip)[0], 200);

    expect(steps.length).toBeGreaterThan(10);
    expect(steps[0].tile).toBe(src.tile());
    // Out: the six land tiles to the harbour, one every two ticks.
    for (let i = 1; i <= 6; i++) {
      expect(game.isLand(steps[i].tile)).toBe(true);
      expect(steps[i].tick - steps[i - 1].tick).toBe(i === 1 ? 1 : 2);
    }
    // Space: a tile a tick, water all the way.
    let i = 7;
    expect(steps[i].tile).toBe(game.ref(8, 2));
    for (; game.isWater(steps[i].tile); i++) {
      expect(steps[i].tick - steps[i - 1].tick).toBe(1);
    }
    // In: land again at half speed, ending on the port.
    expect(steps[i - 1].tile).toBe(game.ref(8, 13));
    for (; i < steps.length; i++) {
      expect(game.isLand(steps[i].tile)).toBe(true);
      expect(steps[i].tick - steps[i - 1].tick).toBe(2);
    }
    expect(steps[steps.length - 1].tile).toBe(dst.tile());
    // Delivered: the ship is gone and both ends were paid the same.
    expect(north.units(UnitType.TradeShip)).toHaveLength(0);
    expect(north.gold() - goldNorth).toBeGreaterThan(0n);
    expect(south.gold() - goldSouth).toBe(north.gold() - goldNorth);
  });

  test("the client gets a motion plan per leg", () => {
    const src = north.buildUnit(UnitType.Port, game.ref(1, 2), {});
    const dst = south.buildUnit(UnitType.Port, game.ref(1, 13), {});
    game.drainPackedMotionPlans();
    game.addExecution(new TradeShipExecution(north, src, dst));
    executeTicks(game, 3);
    const ship = north.units(UnitType.TradeShip)[0];
    executeTicks(game, 200);
    const packed = game.drainPackedMotionPlans()!;
    const plans = unpackMotionPlans(packed).filter(
      (p) => p.kind === "grid" && p.unitId === ship.id(),
    );
    expect(plans.map((p) => (p.kind === "grid" ? p.ticksPerStep : -1))).toEqual(
      [2, 1, 2],
    );
    expect(plans.map((p) => p.planId)).toEqual([1, 2, 3]);
    const inbound = plans[2];
    if (inbound.kind !== "grid") throw new Error("unreachable");
    expect(inbound.path[inbound.path.length - 1]).toBe(dst.tile());
  });

  test("a coastal port sails as before: no land legs", () => {
    const src = north.buildUnit(UnitType.Port, game.ref(7, 2), {});
    const dst = south.buildUnit(UnitType.Port, game.ref(7, 13), {});
    game.addExecution(new TradeShipExecution(north, src, dst));
    const steps = trace(game, () => north.units(UnitType.TradeShip)[0], 100);
    // Straight to sea on the spawn tick, then a tile a tick all the way
    // (the half-resolution pathfinder may brush a coast tile, as it always
    // could; what matters is that no step ever waits).
    expect(steps[0].tile).toBe(game.ref(8, 2));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].tick - steps[i - 1].tick).toBe(1);
    }
    // Delivered where the water path ends, on or beside the port, as before.
    expect(
      game.manhattanDist(steps[steps.length - 1].tile, dst.tile()),
    ).toBeLessThanOrEqual(2);
    expect(north.units(UnitType.TradeShip)).toHaveLength(0);
  });

  test("a freighter on land is beyond a destroyer's reach; captured at sea it sails to the captor's inland port", () => {
    const pirate = game.player("pirate");
    // The pirate's own port is inland on the south coast.
    for (let y = 10; y < 16; y++) {
      for (let x = 0; x < 4; x++) pirate.conquer(game.ref(x, y));
    }
    const pirateHome = pirate.buildUnit(UnitType.Port, game.ref(1, 14), {});
    const src = north.buildUnit(UnitType.Port, game.ref(1, 2), {});
    const dst = south.buildUnit(UnitType.Port, game.ref(6, 8), {});
    game.config().warshipTargettingRange = () => 4;
    // Every water tile here hugs the coast; without this the freighter would
    // be safe from pirates the whole way, as any shore-hugger is.
    game.config().safeFromPiratesCooldownMax = () => 0;
    const patrol = game.ref(9, 4);
    const ship = pirate.buildUnit(UnitType.Warship, patrol, {
      patrolTile: patrol,
    });
    game.addExecution(new WarshipExecution(ship));
    game.addExecution(new TradeShipExecution(north, src, dst));

    let captured = false;
    let landTicks = 0;
    let seen = false;
    for (let i = 0; i < 300 && !captured; i++) {
      game.executeNextTick();
      const freighter = game.units(UnitType.TradeShip)[0];
      if (freighter === undefined) {
        if (seen) break;
        continue;
      }
      seen = true;
      if (game.isLand(freighter.tile())) {
        landTicks++;
        // Never a target while overland, even within range.
        expect(ship.targetUnit()).not.toBe(freighter);
      }
      captured = freighter.owner() === pirate;
    }
    expect(landTicks).toBeGreaterThan(5);
    expect(captured).toBe(true);
    // The prize heads for the pirate's port over its harbour and land leg.
    const gold = pirate.gold();
    const steps = trace(game, () => pirate.units(UnitType.TradeShip)[0], 300);
    expect(steps[steps.length - 1].tile).toBe(pirateHome.tile());
    expect(pirate.gold()).toBeGreaterThan(gold);
  });
});

describe("Freighters beside the Dark Star", () => {
  let game: Game;
  let east: Player;
  let west: Player;

  function settle(player: Player, side: 1 | -1) {
    const g = game.darkStar()!;
    const outer = g.radius + g.moatWidth;
    game.forEachTile((tile) => {
      const dx = (game.x(tile) - g.cx) * side - outer;
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
      [
        new PlayerInfo("east", PlayerType.Human, "client1", "east"),
        new PlayerInfo("west", PlayerType.Human, "client2", "west"),
      ],
    );
    east = game.player("east");
    west = game.player("west");
    settle(east, 1);
    settle(west, -1);
  });

  test("an inland port on each side trades around the moat, never over the disc", () => {
    const g = game.darkStar()!;
    const off = g.radius + g.moatWidth + 12;
    const src = east.buildUnit(UnitType.Port, game.ref(g.cx + off, g.cy), {});
    const dst = west.buildUnit(UnitType.Port, game.ref(g.cx - off, g.cy), {});
    const gold = west.gold();
    game.addExecution(new TradeShipExecution(east, src, dst));
    const steps = trace(game, () => east.units(UnitType.TradeShip)[0], 3000);
    expect(steps[steps.length - 1].tile).toBe(dst.tile());
    // The half-resolution water pathfinder may put the ship on a rim tile
    // of the disc for a tick (§6.15); it never goes deeper.
    let moat = 0;
    for (const { tile } of steps) {
      const dx = game.x(tile) - g.cx;
      const dy = game.y(tile) - g.cy;
      expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(g.radius - 2);
      if (game.isInMoat(tile)) moat++;
    }
    expect(moat).toBeGreaterThan(g.radius);
    expect(west.gold()).toBeGreaterThan(gold);
  });
});
