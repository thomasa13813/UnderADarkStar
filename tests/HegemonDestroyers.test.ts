import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { MoveWarshipExecution } from "../src/core/execution/MoveWarshipExecution";
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
// throne's warships, built without a port, living in the moat, engaging only
// fleets bound for the Dark Star, the invader's trade and warships that enter
// the moat.

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
  test("the throne builds in the moat without a port, nowhere else", () => {
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

describe("Destroyers stay in the moat (H10)", () => {
  test("patrol tiles are moat tiles", () => {
    const ship = buildDestroyer(moatTile(1));
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
      expect(nearMoat(ship.tile())).toBe(true);
    }
  });

  test("a move order out of the moat is ignored", () => {
    const moat = moatTile(1);
    const ship = buildDestroyer(moat);
    east.conquer(outerShore(1)); // make sure it is land the throne cannot sail to
    game.addExecution(
      new MoveWarshipExecution(hegemon, [ship.id()], outerShore(1)),
    );
    executeTicks(game, 2);
    expect(ship.warshipState().patrolTile).toBe(moat);

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

  test("only the invader's trade is harassed", () => {
    const ship = buildDestroyer(moatTile(1));
    const westPort = west.buildUnit(UnitType.Port, outerShore(-1), {});
    const trader = east.buildUnit(UnitType.TradeShip, moatTile(1, 3), {
      targetUnit: westPort,
    });
    executeTicks(game, 3);
    expect(ship.targetUnit()).toBeUndefined();
    expect(trader.owner()).toBe(east);

    east.conquer(domainShore(1)); // east is now the invader
    expect(game.darkStarInvader()).toBe(east);
    let taken = false;
    for (let i = 0; i < 60 && !taken; i++) {
      game.executeNextTick();
      taken = trader.owner() !== east || !trader.isActive();
    }
    expect(taken).toBe(true);
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
