import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { EmbracePiracyExecution } from "../src/core/execution/EmbracePiracyExecution";
import { MoveWarshipExecution } from "../src/core/execution/MoveWarshipExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { TransportShipExecution } from "../src/core/execution/TransportShipExecution";
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
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// Destroyers of the Dark Star (H10, docs/DarkStar-Design.md §6.15): the
// throne's warships, built without a port anywhere in deep space and moved
// like anyone's (revised 2026-10-25), engaging only fleets bound for the Dark
// Star, warships that enter the moat and pirates' corsairs; never trade.

let game: Game;
let hegemon: Player;
let east: Player;
let west: Player;

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

// A moat tile on the given side, mid-ring.
function moatTile(side: 1 | -1, dy = 0): TileRef {
  const g = game.darkStar()!;
  const r = g.radius + Math.floor(g.moatWidth / 2);
  const tile = game.ref(g.cx + side * r, g.cy + dy);
  expect(game.isInMoat(tile)).toBe(true);
  return tile;
}

function domainShore(side: 1 | -1): TileRef {
  const g = game.darkStar()!;
  return game.ref(g.cx + side * g.radius, g.cy);
}

// Warships path on the half-resolution water map and may touch a coast tile
// for a tick, so "in the moat" allows one tile of slack either side.
function nearMoat(tile: TileRef): boolean {
  const g = game.darkStar()!;
  const dx = game.x(tile) - g.cx;
  const dy = game.y(tile) - g.cy;
  const d2 = dx * dx + dy * dy;
  const inner = g.radius - 1;
  const outer = g.radius + g.moatWidth + 1;
  return d2 >= inner * inner && d2 <= outer * outer;
}

function outerShore(side: 1 | -1): TileRef {
  const g = game.darkStar()!;
  // The ring is inclusive at both edges: the first land tile is one further.
  return game.ref(g.cx + side * (g.radius + g.moatWidth + 1), g.cy);
}

function buildDestroyer(tile: TileRef): Unit {
  game.addExecution(new ConstructionExecution(hegemon, UnitType.Warship, tile));
  executeTicks(game, 3);
  const ships = hegemon.units(UnitType.Warship);
  expect(ships).toHaveLength(1);
  return ships[0];
}

beforeEach(async () => {
  game = await setup("big_plains", { hegemon: { enabled: true } }, [
    new PlayerInfo("east", PlayerType.Human, "client1", "east"),
    new PlayerInfo("west", PlayerType.Human, "client2", "west"),
  ]);
  hegemon = game.hegemon()!;
  east = game.player("east");
  west = game.player("west");
  settleOuterShore(east, 1);
  settleOuterShore(west, -1);
  hegemon.addGold(1_000_000_000n);
  east.addGold(1_000_000_000n);
  west.addGold(1_000_000_000n);
});

describe("Building destroyers (H10)", () => {
  test("the throne builds in the moat without a port, never on land", () => {
    const g = game.darkStar()!;
    expect(hegemon.units(UnitType.Port)).toHaveLength(0);
    const moat = moatTile(1);
    expect(hegemon.canBuild(UnitType.Warship, moat)).toBe(moat);
    // The disc, and land beyond the moat, are not water at all.
    expect(hegemon.canBuild(UnitType.Warship, game.ref(g.cx, g.cy))).toBe(
      false,
    );
    expect(hegemon.canBuild(UnitType.Warship, outerShore(1))).toBe(false);
    // The build menu agrees.
    const offer = hegemon
      .buildableUnits(moat, [UnitType.Warship])
      .find((u) => u.type === UnitType.Warship)!;
    expect(offer.canBuild).toBe(moat);
  });

  test("a challenger still needs a port", () => {
    const moat = moatTile(1);
    expect(east.canBuild(UnitType.Warship, moat)).toBe(false);
    east.buildUnit(UnitType.Port, outerShore(1), {});
    expect(east.canBuild(UnitType.Warship, moat)).not.toBe(false);
  });

  test("the ordinary build order spawns it where the throne pointed", () => {
    const moat = moatTile(1);
    const gold = hegemon.gold();
    const ship = buildDestroyer(moat);
    expect(ship.warshipState().patrolTile).toBe(moat);
    expect(game.isInMoat(ship.tile())).toBe(true);
    expect(ship.owner()).toBe(hegemon);
    expect(hegemon.gold()).toBeLessThan(gold);
  });
});

describe("Destroyers posted in the moat (H10)", () => {
  test("patrol tiles are moat tiles", () => {
    const ship = buildDestroyer(moatTile(1));
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
      expect(nearMoat(ship.tile())).toBe(true);
    }
  });

  test("a move order is obeyed like anyone's", () => {
    const moat = moatTile(1);
    const ship = buildDestroyer(moat);
    const other = moatTile(1, 4);
    game.addExecution(new MoveWarshipExecution(hegemon, [ship.id()], other));
    executeTicks(game, 2);
    expect(ship.warshipState().patrolTile).toBe(other);
  });

  test("the moat is their harbour: they repair there", () => {
    const ship = buildDestroyer(moatTile(1));
    game.executeNextTick();
    const max = ship.maxHealth();
    ship.modifyHealth(-100);
    game.executeNextTick();
    expect(ship.health()).toBe(max - 99);
    // Never a retreat: there is no port to retreat to.
    ship.modifyHealth(-800);
    executeTicks(game, 5);
    expect(ship.warshipState().state).toBe("patrolling");
  });
});

describe("Destroyers pick their fights (H10)", () => {
  test("an invasion fleet is engaged, whoever sent it", () => {
    const ship = buildDestroyer(moatTile(1));
    game.addExecution(new TransportShipExecution(east, domainShore(1), 10_000));
    let engaged = false;
    for (let i = 0; i < 40 && !engaged; i++) {
      game.executeNextTick();
      engaged = ship.targetUnit()?.type() === UnitType.TransportShip;
    }
    expect(engaged).toBe(true);
  });

  test("a fleet bound elsewhere is left alone", () => {
    const ship = buildDestroyer(moatTile(1));
    // East sails along its own shore, never at the Dark Star.
    const g = game.darkStar()!;
    const dst = game.ref(g.cx + g.radius + g.moatWidth, g.cy + 12);
    expect(game.isLand(dst)).toBe(true);
    expect(game.isInDarkStar(dst)).toBe(false);
    game.addExecution(new TransportShipExecution(east, dst, 10_000));
    for (let i = 0; i < 40; i++) {
      game.executeNextTick();
      expect(ship.targetUnit()).toBeUndefined();
    }
  });

  test("trade is never raided, not even the invader's (2026-10-25)", () => {
    const ship = buildDestroyer(moatTile(1));
    const westPort = west.buildUnit(UnitType.Port, outerShore(-1), {});
    const trader = east.buildUnit(UnitType.TradeShip, moatTile(1, 3), {
      targetUnit: westPort,
    });
    east.conquer(domainShore(1)); // east is now the invader
    expect(game.darkStarInvader()).toBe(east);
    for (let i = 0; i < 60; i++) {
      game.executeNextTick();
      expect(ship.targetUnit()).toBeUndefined();
    }
    expect(trader.owner()).toBe(east);
    expect(trader.isActive()).toBe(true);
  });

  test("an enemy warship is engaged only inside the moat", () => {
    const ship = buildDestroyer(moatTile(1));
    east.buildUnit(UnitType.Port, outerShore(1), {});
    const raider = east.buildUnit(UnitType.Warship, moatTile(1, 2), {
      patrolTile: moatTile(1, 2),
    });
    game.addExecution(new WarshipExecution(raider));
    let engaged = false;
    for (let i = 0; i < 10 && !engaged; i++) {
      game.executeNextTick();
      engaged = ship.targetUnit() === raider;
    }
    expect(engaged).toBe(true);
  });
});

describe("Destroyers move to intercept (H10)", () => {
  test("with nothing in range, a destroyer sails towards an inbound fleet", () => {
    const ship = buildDestroyer(moatTile(1));
    // A fleet from the far side: out of gun range, bound for the Dark Star.
    game.addExecution(
      new TransportShipExecution(west, domainShore(-1), 10_000),
    );
    const landing = domainShore(-1);
    const before = game.euclideanDistSquared(ship.tile(), landing);
    executeTicks(game, 60);
    expect(game.euclideanDistSquared(ship.tile(), landing)).toBeLessThan(
      before,
    );
    expect(nearMoat(ship.tile())).toBe(true);
  });
});

// Beyond the moat (revised 2026-10-25). half_land_half_ocean is 16×16: x < 8
// is land, x >= 8 one body of water; the smallest Dark Star the engine allows
// sits at (8, 8) with a one-tile moat, leaving open deep space in the east.
describe("Destroyers beyond the moat (H10, 2026-10-25)", () => {
  let north: Player;
  let pirate: Player;

  function settle(player: Player, tiles: { x: number; y: number }[]) {
    for (const { x, y } of tiles) player.conquer(game.ref(x, y));
    player.setSpawnTile(game.ref(tiles[0].x, tiles[0].y));
    game.addExecution(new PlayerExecution(player));
  }

  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { piracy: { enabled: true }, hegemon: { enabled: true } },
      [
        new PlayerInfo("north", PlayerType.Human, "client1", "north"),
        new PlayerInfo("pirate", PlayerType.Human, "client3", "pirate"),
      ],
      undefined,
      undefined,
      true,
      [],
      { center: [8, 8], radius: 4, moat: 1 },
    );
    hegemon = game.hegemon()!;
    north = game.player("north");
    pirate = game.player("pirate");
    const n: { x: number; y: number }[] = [];
    const p: { x: number; y: number }[] = [];
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 16; y++) {
        const tile = game.ref(x, y);
        if (!game.isLand(tile) || game.isInDarkStar(tile)) continue;
        (y < 8 ? n : p).push({ x, y });
      }
    }
    settle(north, n);
    settle(pirate, p);
    hegemon.addGold(1_000_000_000n);
    north.addGold(1_000_000_000n);
    executeTicks(game, 5);
  });

  test("the throne builds anywhere in deep space", () => {
    const open = game.ref(15, 15);
    expect(game.isWater(open)).toBe(true);
    expect(game.isInMoat(open)).toBe(false);
    expect(hegemon.canBuild(UnitType.Warship, open)).toBe(open);
    const ship = buildDestroyer(open);
    expect(ship.warshipState().patrolTile).toBe(open);
  });

  test("a destroyer sent out of the moat goes there and stays", () => {
    const g = game.darkStar()!;
    const moat = game.ref(g.cx + g.radius + 1, g.cy);
    expect(game.isInMoat(moat)).toBe(true);
    const ship = buildDestroyer(moat);
    const post = game.ref(14, 14);
    game.addExecution(new MoveWarshipExecution(hegemon, [ship.id()], post));
    executeTicks(game, 2);
    expect(ship.warshipState().patrolTile).toBe(post);
    executeTicks(game, 40);
    expect(game.isInMoat(ship.tile())).toBe(false);
    expect(game.manhattanDist(ship.tile(), post)).toBeLessThan(8);
  });

  test("a pirate's corsair is engaged anywhere", () => {
    const ship = buildDestroyer(game.ref(13, 14));
    for (const tile of Array.from(pirate.tiles())) pirate.relinquish(tile);
    executeTicks(game, 2);
    while (game.ticks() < pirate.pirateRespawnAt()) game.executeNextTick();
    game.addExecution(new EmbracePiracyExecution(pirate, game.ref(15, 15)));
    executeTicks(game, 2);
    const corsair = pirate.units(UnitType.Warship)[0];
    expect(corsair).toBeDefined();
    expect(game.isInMoat(corsair.tile())).toBe(false);
    let engaged = false;
    for (let i = 0; i < 10 && !engaged; i++) {
      game.executeNextTick();
      engaged = ship.targetUnit() === corsair;
    }
    expect(engaged).toBe(true);
  });

  test("a challenger's destroyer outside the moat is left alone", () => {
    const ship = buildDestroyer(game.ref(13, 14));
    const port = north.buildUnit(UnitType.Port, game.ref(7, 2), {});
    expect(port.isActive()).toBe(true);
    const other = north.buildUnit(UnitType.Warship, game.ref(15, 15), {
      patrolTile: game.ref(15, 15),
    });
    expect(game.isInMoat(other.tile())).toBe(false);
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
      expect(ship.targetUnit()).not.toBe(other);
    }
  });
});
