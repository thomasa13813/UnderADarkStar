import { GiftExecution } from "../src/core/execution/GiftExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Structures,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import {
  DisplayMessageUpdate,
  GameUpdateType,
} from "../src/core/game/GameUpdates";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// Gifts (H18, docs/DarkStar-Design.md §6.14): the Hegemon builds on a
// challenger's land at its own cost; the host owns the structure from the
// start and cannot refuse. The throne pays the flat first-building price
// whatever the host already owns (Tom, 2026-10-17).

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

function homeTile(player: Player): TileRef {
  const g = game.darkStar()!;
  const outer = g.radius + g.moatWidth;
  const side = player === east ? 1 : -1;
  return game.ref(g.cx + side * (outer + 6), g.cy);
}

function domainShore(side: 1 | -1): TileRef {
  const g = game.darkStar()!;
  return game.ref(g.cx + side * g.radius, g.cy);
}

// Runs one tick and returns the messages shown to the player.
function messagesFor(player: Player): DisplayMessageUpdate[] {
  const updates = game.executeNextTick();
  return (
    updates[GameUpdateType.DisplayEvent] as DisplayMessageUpdate[]
  ).filter((u) => u.playerID === player.smallID());
}

function gift(
  sender: Player,
  host: Player,
  type: UnitType,
  tile: TileRef,
  amount?: number,
) {
  game.addExecution(new GiftExecution(sender, host.id(), type, tile, amount));
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
});

describe("The gift menu (H18)", () => {
  test("on a challenger's tile the throne sees the host's list, paying itself", () => {
    const tile = homeTile(east);
    east.addGold(1_000_000_000n);
    const own = east.buildableUnits(tile, Structures.types);
    const gifted = east.buildableUnits(tile, Structures.types, hegemon);
    for (const type of Structures.types) {
      const mine = own.find((u) => u.type === type)!;
      const theirs = gifted.find((u) => u.type === type)!;
      expect(theirs.canBuild).toBe(mine.canBuild);
      // A host with nothing yet pays the first-building price, as the throne
      // always does.
      expect(theirs.cost).toBe(mine.cost);
    }
    // The Hegemon's own list there is empty of structures (H2) — the gift
    // list is the host's, never the Hegemon's.
    for (const u of hegemon.buildableUnits(tile, Structures.types)) {
      expect(u.canBuild).toBe(false);
    }
  });

  test("the gift list prices every structure as the host's first", () => {
    const tile = homeTile(east);
    east.addGold(1_000_000_000n);
    const first = game.config().unitInfo(UnitType.City).cost(game, east);
    // The host builds two cities of their own; their third costs them more.
    for (let i = 0; i < 2; i++) {
      east.buildUnit(
        UnitType.City,
        game.ref(game.x(tile) + i * 4, game.y(tile) + 3),
        {},
      );
    }
    const own = east.buildableUnits(tile, [UnitType.City])[0];
    expect(own.cost).toBeGreaterThan(first);
    // The throne's bill is the first-building price, and so is every step
    // of a bulk upgrade.
    const gifted = east.buildableUnits(tile, [UnitType.City], hegemon)[0];
    expect(gifted.cost).toBe(first);
    expect(gifted.canUpgrade).not.toBe(false);
    gifted.upgradeCosts!.forEach((total, n) => {
      expect(total).toBe(first * BigInt(n + 1));
    });
    expect(own.upgradeCosts![1]).toBeGreaterThan(first * 2n);
  });

  test("a throne that cannot pay is offered nothing", () => {
    const tile = homeTile(east);
    east.addGold(1_000_000_000n);
    hegemon.removeGold(hegemon.gold());
    for (const u of east.buildableUnits(tile, Structures.types, hegemon)) {
      expect(u.canBuild).toBe(false);
    }
    expect(east.canBuild(UnitType.City, tile, null, hegemon)).toBe(false);
    expect(east.canBuild(UnitType.City, tile)).not.toBe(false);
  });
});

describe("Placing a gift (H18)", () => {
  test("the host owns it from the start; the throne pays the first-building price", () => {
    const tile = homeTile(east);
    const cost = game.config().unitInfo(UnitType.City).cost(game, east);
    const throneGold = hegemon.gold();
    const hostGold = east.gold();
    expect(hostGold).toBeLessThan(cost); // the host could not have afforded it

    gift(hegemon, east, UnitType.City, tile);
    executeTicks(game, 3); // gift, then the construction's init, then the build
    const cities = east.units(UnitType.City);
    expect(cities).toHaveLength(1);
    expect(cities[0].owner()).toBe(east);
    expect(hegemon.units(UnitType.City)).toHaveLength(0);
    expect(hegemon.gold()).toBe(throneGold - cost);
    expect(east.gold()).toBe(hostGold);
    // Counted as the host's build: their next city costs them more, but the
    // throne's next gift of one costs the same again.
    expect(east.unitsConstructed(UnitType.City)).toBe(1);
    expect(
      game.config().unitInfo(UnitType.City).cost(game, east),
    ).toBeGreaterThan(cost);
    expect(
      game.config().unitInfo(UnitType.City).cost(game, east, 0, hegemon),
    ).toBe(cost);

    // Built like any other: under construction, then live.
    expect(cities[0].isUnderConstruction()).toBe(true);
    executeTicks(game, 200);
    expect(cities[0].isActive()).toBe(true);
    expect(cities[0].isUnderConstruction()).toBe(false);
  });

  test("the host is told", () => {
    const tile = homeTile(east);
    gift(hegemon, east, UnitType.DefensePost, tile);
    executeTicks(game, 2); // the gift hands over to the construction
    const shown = messagesFor(east);
    expect(shown.map((m) => m.message)).toContain(
      "events_display.dark_star_gift",
    );
    const notice = shown.find(
      (m) => m.message === "events_display.dark_star_gift",
    )!;
    expect(notice.params?.unit).toBe(UnitType.DefensePost);
  });

  test("a second gift of the same type upgrades the first", () => {
    const tile = homeTile(east);
    gift(hegemon, east, UnitType.City, tile);
    executeTicks(game, 300);
    const city = east.units(UnitType.City)[0];
    expect(city.level()).toBe(1);
    const throneGold = hegemon.gold();
    const hostGold = east.gold();

    gift(hegemon, east, UnitType.City, tile, 2);
    game.executeNextTick(); // the gift hands over; the upgrade runs next tick
    const shown = messagesFor(east);
    expect(city.level()).toBe(3);
    expect(east.units(UnitType.City)).toHaveLength(1);
    // Two steps at the flat first-building price, though the host has one
    // city built and another level on it.
    const first = game
      .config()
      .unitInfo(UnitType.City)
      .cost(game, east, 0, hegemon);
    expect(hegemon.gold()).toBe(throneGold - first * 2n);
    expect(east.gold()).toBe(hostGold);
    expect(shown.map((m) => m.message)).toContain(
      "events_display.dark_star_gift_upgrade",
    );
  });
});

describe("Gifts that are refused (H18)", () => {
  test("only the Hegemon gives", () => {
    const tile = homeTile(west);
    east.addGold(1_000_000_000n);
    gift(east, west, UnitType.City, tile);
    executeTicks(game, 3);
    expect(west.units(UnitType.City)).toHaveLength(0);
    expect(east.units(UnitType.City)).toHaveLength(0);
  });

  test("the named host must hold the tile", () => {
    const throneGold = hegemon.gold();
    // West's land, but aimed at east.
    gift(hegemon, east, UnitType.City, homeTile(west));
    // Neutral land.
    gift(hegemon, east, UnitType.City, game.ref(10, 10));
    const shown: string[] = [];
    for (let i = 0; i < 3; i++) {
      shown.push(...messagesFor(hegemon).map((m) => m.message));
    }
    expect(east.units(UnitType.City)).toHaveLength(0);
    expect(west.units(UnitType.City)).toHaveLength(0);
    expect(hegemon.gold()).toBe(throneGold);
    expect(shown).toContain("events_display.dark_star_gift_refused");
  });

  test("never on the Dark Star, even for the invader (H2)", () => {
    const shore = domainShore(1);
    east.conquer(shore);
    expect(game.darkStarInvader()).toBe(east);
    const throneGold = hegemon.gold();
    gift(hegemon, east, UnitType.DefensePost, shore);
    executeTicks(game, 3);
    expect(east.units(UnitType.DefensePost)).toHaveLength(0);
    expect(hegemon.gold()).toBe(throneGold);
  });

  test("nothing is built when the throne cannot pay", () => {
    hegemon.removeGold(hegemon.gold());
    const hostGold = east.gold();
    gift(hegemon, east, UnitType.City, homeTile(east));
    executeTicks(game, 3);
    expect(east.units(UnitType.City)).toHaveLength(0);
    expect(east.gold()).toBe(hostGold);
  });

  test("a gift to the throne itself, or of a non-structure, is refused", () => {
    const g = game.darkStar()!;
    gift(hegemon, hegemon, UnitType.City, game.ref(g.cx, g.cy));
    gift(hegemon, east, UnitType.Warship, homeTile(east));
    gift(hegemon, east, UnitType.AtomBomb, homeTile(east));
    executeTicks(game, 3);
    expect(hegemon.units(UnitType.City)).toHaveLength(0);
    expect(east.units(UnitType.Warship)).toHaveLength(0);
    expect(east.units(UnitType.AtomBomb)).toHaveLength(0);
  });
});
