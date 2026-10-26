import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { HegemonExecution } from "../src/core/execution/HegemonExecution";
import { NationStructureBehavior } from "../src/core/execution/nation/NationStructureBehavior";
import { TitheExecution } from "../src/core/execution/TitheExecution";
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

// Tithes (docs/DarkStar-Rework.md TI1-TI11): the throne aims a tithe at any
// tile outside its domain; it flies from the Dark Star's centre and, when it
// lands, every challenger owning a tile within 50 tiles of the landing pays
// all its gold above 500k to the throne, reckoned at landing. One in flight
// at a time; the next 10 s after the last lands. The AI throne tithes once a
// minute from the second minute, at the richest; Lords under a ring spend
// down before it lands.
//
// big_plains is 200×200: the Dark Star's radius is 18 and the moat 15, so
// the outer shore is 33 tiles from the centre.

const RESERVE = 500_000n;

let game: Game;
let hegemon: Player;
let east: Player;
let west: Player;

// A block beyond the moat's outer shore, east (+1) or west (-1).
function settle(player: Player, side: 1 | -1, depth = 40, half = 20) {
  const g = game.darkStar()!;
  const outer = g.radius + g.moatWidth;
  game.forEachTile((tile) => {
    const dx = (game.x(tile) - g.cx) * side - outer;
    const dy = game.y(tile) - g.cy;
    if (dx >= 0 && dx < depth && Math.abs(dy) < half && game.isLand(tile)) {
      player.conquer(tile);
    }
  });
  player.setTroops(100_000);
}

function tileOf(side: 1 | -1, dx: number, dy = 0): TileRef {
  const g = game.darkStar()!;
  return game.ref(g.cx + side * (g.radius + g.moatWidth + dx), g.cy + dy);
}

function setGold(player: Player, gold: bigint) {
  player.removeGold(player.gold());
  player.addGold(gold);
}

async function start(humanThrone = true, eastType = PlayerType.Human) {
  const players = [
    new PlayerInfo(
      "east",
      eastType,
      eastType === PlayerType.Human ? "c1" : null,
      "east",
    ),
    new PlayerInfo("west", PlayerType.Human, "c2", "west"),
  ];
  if (humanThrone) {
    players.push(
      new PlayerInfo(
        "throne",
        PlayerType.Human,
        "c3",
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
    { hegemon: { enabled: true }, instantBuild: true },
    players,
  );
  hegemon = game.hegemon()!;
  east = game.player("east");
  west = game.player("west");
  settle(east, 1);
  settle(west, -1);
  game.addExecution(new HegemonExecution());
  while (game.inSpawnPhase()) game.executeNextTick();
}

// Launch a tithe and run until it has landed.
function tithe(target: TileRef): void {
  game.addExecution(new TitheExecution(hegemon, target));
  executeTicks(game, 2);
  expect(game.titheInFlight()).not.toBeNull();
  let ticks = 0;
  while (game.titheInFlight() !== null && ticks++ < 500) {
    game.executeNextTick();
  }
  expect(game.titheInFlight()).toBeNull();
}

describe("The tithe lands (TI1, TI2)", () => {
  beforeEach(() => start());

  test("everyone under the ring pays all gold above 500k; the rest pay nothing", () => {
    setGold(east, 3_000_000n);
    setGold(west, 3_000_000n);
    const before = hegemon.gold();
    // 20 tiles into east's block: the ring (50) never reaches west's, which
    // is 66 tiles across the Dark Star at the nearest.
    tithe(tileOf(1, 20));
    expect(east.gold()).toBeLessThan(RESERVE + 100_000n);
    expect(west.gold()).toBeGreaterThanOrEqual(3_000_000n);
    const taken = hegemon.gold() - before;
    expect(taken).toBeGreaterThan(2_400_000n);
    expect(game.titheCollected()).toBe(taken);
  });

  test("a player at or below the reserve pays nothing", () => {
    setGold(east, 400_000n);
    tithe(tileOf(1, 20));
    expect(east.gold()).toBeGreaterThanOrEqual(400_000n);
    expect(game.titheCollected()).toBe(0n);
  });

  test("the bill is reckoned at landing: gold spent in flight is safe", () => {
    setGold(east, 3_000_000n);
    game.addExecution(new TitheExecution(hegemon, tileOf(1, 20)));
    executeTicks(game, 2);
    expect(game.titheInFlight()).not.toBeNull();
    // East sees the ring and builds a Stargate and more before it lands.
    setGold(east, 450_000n);
    let ticks = 0;
    while (game.titheInFlight() !== null && ticks++ < 500) {
      game.executeNextTick();
    }
    expect(game.titheCollected()).toBe(0n);
  });

  test("any tile under the ring counts, Barons included; shields do not stop it (TI4)", () => {
    const baron = game.addPlayer(
      new PlayerInfo("baron", PlayerType.Bot, null, "baron"),
    );
    baron.conquer(tileOf(1, 45, 30));
    setGold(baron, 1_000_000n);
    setGold(east, 3_000_000n);
    // A shielded post right on the aim tile.
    game.addExecution(
      new ConstructionExecution(east, UnitType.DefensePost, tileOf(1, 20)),
    );
    executeTicks(game, 2);
    game.addExecution(
      new ConstructionExecution(east, UnitType.ShieldArray, tileOf(1, 20)),
    );
    executeTicks(game, 2);
    expect(east.units(UnitType.ShieldArray)).toHaveLength(1);
    setGold(east, 3_000_000n);
    tithe(tileOf(1, 20));
    expect(east.gold()).toBeLessThan(RESERVE + 100_000n);
    expect(baron.gold()).toBeLessThan(RESERVE + 100_000n);
  });

  test("the projectile carries the tithe flag, for the ring", () => {
    game.addExecution(new TitheExecution(hegemon, tileOf(1, 20)));
    executeTicks(game, 2);
    const projectile = hegemon.units(UnitType.Projectile)[0];
    expect(projectile).toBeDefined();
    expect(projectile.toUpdate().tithe).toBe(true);
    expect(projectile.targetTile()).toBe(tileOf(1, 20));
  });
});

describe("Who may tithe, and when (TI1, TI5, TI8)", () => {
  beforeEach(() => start());

  test("only the throne, and never on the Dark Star", () => {
    const g = game.darkStar()!;
    expect(TitheExecution.canTithe(game, east, tileOf(-1, 20))).toBe(false);
    expect(TitheExecution.canTithe(game, hegemon, game.ref(g.cx, g.cy))).toBe(
      false,
    );
    expect(TitheExecution.canTithe(game, hegemon, tileOf(1, 20))).toBe(true);
    // Deep space is outside the domain too.
    expect(
      TitheExecution.canTithe(
        game,
        hegemon,
        game.ref(g.cx + g.radius + 5, g.cy),
      ),
    ).toBe(true);
  });

  test("one in flight; the next 10 s after the last lands", () => {
    game.addExecution(new TitheExecution(hegemon, tileOf(1, 20)));
    executeTicks(game, 2);
    expect(TitheExecution.readyInTicks(game)).toBeNull();
    expect(TitheExecution.canTithe(game, hegemon, tileOf(-1, 20))).toBe(false);
    let ticks = 0;
    while (game.titheInFlight() !== null && ticks++ < 500) {
      game.executeNextTick();
    }
    const landed = game.lastTitheLandedTick()!;
    expect(TitheExecution.readyInTicks(game)).toBe(landed + 100 - game.ticks());
    executeTicks(game, landed + 99 - game.ticks());
    expect(TitheExecution.canTithe(game, hegemon, tileOf(-1, 20))).toBe(false);
    executeTicks(game, 1);
    expect(TitheExecution.canTithe(game, hegemon, tileOf(-1, 20))).toBe(true);
  });

  test("the radial option names who would pay, and how much (TI7)", () => {
    setGold(east, 2_000_000n);
    setGold(west, 2_000_000n);
    const option = TitheExecution.option(game, tileOf(1, 20));
    expect(option.readyInTicks).toBe(0);
    expect(option.payers).toEqual([{ name: "east", gold: 1_500_000n }]);
  });
});

describe("The AI throne tithes (TI9)", () => {
  beforeEach(() => start(false));

  test("from the second minute, at the richest challenger above the reserve", () => {
    expect(hegemon.type()).not.toBe(PlayerType.Human);
    setGold(east, 1_000_000n);
    setGold(west, 9_000_000n);
    // Nothing in the first minute; then one, aimed at the richest.
    while (game.titheInFlight() === null && game.elapsedGameSeconds() < 90) {
      game.executeNextTick();
    }
    expect(game.elapsedGameSeconds()).toBeGreaterThanOrEqual(60);
    expect(game.elapsedGameSeconds()).toBeLessThan(62);
    const flight = game.titheInFlight();
    expect(flight).not.toBeNull();
    expect(game.owner(flight!.aimTile())).toBe(west);
    let ticks = 0;
    while (game.titheInFlight() !== null && ticks++ < 500) {
      game.executeNextTick();
    }
    expect(game.titheCollected()).toBeGreaterThan(0n);
    // Not again within the minute.
    executeTicks(game, 300);
    expect(game.titheInFlight()).toBeNull();
  });

  test("nobody above the reserve, no tithe", () => {
    setGold(east, 100_000n);
    setGold(west, 100_000n);
    // Income would lift them above the reserve in time: keep them poor.
    for (let i = 0; i < 900; i++) {
      game.executeNextTick();
      if (east.gold() > 200_000n) setGold(east, 100_000n);
      if (west.gold() > 200_000n) setGold(west, 100_000n);
    }
    expect(game.titheCollected()).toBe(0n);
    expect(game.lastTitheLandedTick()).toBeNull();
  });
});

describe("Lords spend down under a ring (TI10)", () => {
  beforeEach(() => start(true, PlayerType.Nation));

  test("a Lord whose nebula the ring touches spends to the reserve before it lands", () => {
    // A Population Center to upgrade.
    setGold(east, 1_000_000n);
    game.addExecution(
      new ConstructionExecution(east, UnitType.City, tileOf(1, 20)),
    );
    executeTicks(game, 2);
    expect(east.units(UnitType.City)).toHaveLength(1);
    setGold(east, 20_000_000n);
    const lord = new NationStructureBehavior(new PseudoRandom(1), game, east);
    // No ring, no hurry.
    expect(lord.spendBeforeTithe()).toBe(false);

    game.addExecution(new TitheExecution(hegemon, tileOf(1, 20)));
    executeTicks(game, 2);
    let ticks = 0;
    while (game.titheInFlight() !== null && ticks++ < 500) {
      lord.spendBeforeTithe();
      game.executeNextTick();
    }
    // Spent down: the throne took little or nothing.
    expect(game.titheCollected()).toBeLessThan(1_000_000n);
    expect(east.gold()).toBeLessThanOrEqual(RESERVE + 1_000_000n);
  });

  test("a ring elsewhere leaves it alone", () => {
    setGold(east, 20_000_000n);
    const lord = new NationStructureBehavior(new PseudoRandom(1), game, east);
    game.addExecution(new TitheExecution(hegemon, tileOf(-1, 20)));
    executeTicks(game, 2);
    expect(lord.spendBeforeTithe()).toBe(false);
  });
});
