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
import { landTransfers } from "./util/utils";

// The gate network (docs/DarkStar-Rework.md GN1-GN12): under a Dark Star a
// transfer of troops or gold needs no alliance, only reach. A player reaches
// anyone who owns a tile within range of one of its finished stargates; the
// throne reaches everyone; the throne is reached by a gate whose range
// touches the Dark Star. Cooldowns and, between challengers, the lobby's
// toggles still apply. The invader may be supplied.
//
// big_plains is 200×200, the Dark Star's radius 18 and the moat 15. Short
// range makes reach testable: 30 tiles at level 1, +10 per level.
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

// A block beyond the moat's outer shore, east (+1) or west (-1).
function settle(player: Player, side: 1 | -1, depth = 20) {
  const g = game.darkStar()!;
  const outer = g.radius + g.moatWidth;
  game.forEachTile((tile) => {
    const dx = (game.x(tile) - g.cx) * side - outer;
    const dy = game.y(tile) - g.cy;
    if (dx >= 0 && dx < depth && Math.abs(dy) < 10 && game.isLand(tile)) {
      player.conquer(tile);
    }
  });
  player.setTroops(100_000);
  player.addGold(10_000_000n);
}

// A tile `dx` tiles in from the moat's outer shore on the player's side.
function tileOf(side: 1 | -1, dx: number, dy = 0): TileRef {
  const g = game.darkStar()!;
  return game.ref(g.cx + side * (g.radius + g.moatWidth + dx), g.cy + dy);
}

function gate(player: Player, tile: TileRef): Unit {
  return player.buildUnit(UnitType.Stargate, tile, {});
}

async function start(toggles = true) {
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
      donateGold: toggles,
      donateTroops: toggles,
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
  // North: a small block just above the moat (which ends at y = 67).
  const g = game.darkStar()!;
  for (let x = g.cx - 5; x <= g.cx + 5; x++) {
    for (let y = 56; y < 65; y++) {
      const t = game.ref(x, y);
      if (game.isLand(t)) north.conquer(t);
    }
  }
  north.setTroops(100_000);
  // No PlayerExecution: the outposts these tests plant would be tidied away.
  while (game.inSpawnPhase()) game.executeNextTick();
}

describe("Reach (GN1-GN3)", () => {
  beforeEach(() => start());

  test("no gate, no transfer, ally or not", () => {
    expect(east.isFriendly(west)).toBe(false);
    expect(east.canDonateTroops(west)).toBe(false);
    expect(east.canDonateGold(west)).toBe(false);
  });

  test("a gate reaches anyone with a tile in its range: no alliance needed", () => {
    // East's gate 5 tiles in from its shore: west's nearest tile is
    // 2 × 33 + 5 = 71 tiles away, past a level-1 gate's 30.
    gate(east, tileOf(1, 5));
    expect(east.inGateReach(west)).toBe(false);
    // An outpost of east's within 30 tiles of a gate of west's.
    gate(west, tileOf(-1, 0));
    east.conquer(tileOf(-1, 25, 15));
    expect(west.inGateReach(east)).toBe(true);
    expect(west.isFriendly(east)).toBe(false);
    expect(west.canDonateTroops(east)).toBe(true);
    expect(west.canDonateGold(east)).toBe(true);
  });

  test("upgrading a gate widens its reach (GN3)", () => {
    const g = gate(east, tileOf(1, 0));
    // North's nearest tile, (105, 64), is 46 tiles from the gate at
    // (133, 100): beyond levels 1 and 2 (30, 40), within level 3 (50).
    expect(east.inGateReach(north)).toBe(false);
    east.upgradeUnit(g);
    expect(east.inGateReach(north)).toBe(false);
    east.upgradeUnit(g);
    expect(g.level()).toBe(3);
    expect(east.inGateReach(north)).toBe(true);
  });

  test("a gate under construction reaches nobody", () => {
    const g = gate(west, tileOf(-1, 0));
    east.conquer(tileOf(-1, 25, 15));
    g.setUnderConstruction(true);
    expect(west.canDonateTroops(east)).toBe(false);
    g.setUnderConstruction(false);
    expect(west.canDonateTroops(east)).toBe(true);
  });

  test("the transfer lands and spends no gate charge (GN2)", () => {
    const g = gate(west, tileOf(-1, 0));
    east.conquer(tileOf(-1, 25, 15));
    const gold = east.gold();
    game.addExecution(new DonateGoldExecution(west, east.id(), 1_000_000));
    landTransfers(game);
    expect(east.gold()).toBeGreaterThanOrEqual(gold + 1_000_000n);
    expect(g.missileTimerQueue()).toHaveLength(0);
    // The donation cooldown applies (GN6).
    expect(west.canDonateGold(east)).toBe(false);
    expect(west.canDonateTroops(east)).toBe(false);
  });
});

describe("The throne (GN4, GN5, GN12)", () => {
  beforeEach(() => start());

  test("the throne reaches everyone, with troops and gold", () => {
    expect(hegemon.units(UnitType.Stargate)).toHaveLength(0);
    for (const p of [east, west, north]) {
      expect(hegemon.canDonateTroops(p)).toBe(true);
      expect(hegemon.canDonateGold(p)).toBe(true);
    }
  });

  test("supplying the throne needs a gate whose range touches the Dark Star", () => {
    hegemon.setTroops(game.config().maxTroops(hegemon) - 1_000);
    expect(east.canDonateTroops(hegemon)).toBe(false);
    expect(east.canDonateGold(hegemon)).toBe(false);
    // 19 tiles past the moat: 33 + 19 = 52 from the centre, 34 from the
    // Dark Star's rim, beyond 30.
    gate(east, tileOf(1, 19));
    expect(east.inGateReach(hegemon)).toBe(false);
    gate(east, tileOf(1, 5, 5));
    expect(east.inGateReach(hegemon)).toBe(true);
    expect(east.canDonateTroops(hegemon)).toBe(true);
    expect(east.canDonateGold(hegemon)).toBe(true);
  });

  test("the invader can be supplied (GN12)", () => {
    const g = game.darkStar()!;
    // East takes a corner of the domain.
    for (const t of Array.from(hegemon.tiles())) {
      if (game.x(t) > g.cx + g.radius - 3) east.conquer(t);
    }
    expect(game.darkStarInvader()).toBe(east);
    gate(west, tileOf(-1, 0));
    // West's gate (range 30) reaches nothing of east's beyond the moat, but
    // the domain tiles east holds are east's too: put one within range.
    east.conquer(game.ref(g.cx - g.radius + 2, g.cy));
    expect(west.inGateReach(east)).toBe(true);
    expect(west.canDonateTroops(east)).toBe(true);
    east.setTroops(1_000);
    game.addExecution(new DonateTroopsExecution(west, east.id(), 10_000));
    landTransfers(game);
    expect(east.troops()).toBeGreaterThan(5_000);
  });
});

describe("The lobby toggles (GN11)", () => {
  beforeEach(() => start(false));

  test("hold between challengers, not for the throne", () => {
    gate(west, tileOf(-1, 0));
    east.conquer(tileOf(-1, 25, 15));
    expect(west.inGateReach(east)).toBe(true);
    expect(west.canDonateTroops(east)).toBe(false);
    expect(west.canDonateGold(east)).toBe(false);
    expect(hegemon.canDonateTroops(east)).toBe(true);
    expect(hegemon.canDonateGold(east)).toBe(true);
    gate(west, tileOf(-1, 3, 6));
    hegemon.setTroops(game.config().maxTroops(hegemon) - 1_000);
    expect(west.canDonateGold(hegemon)).toBe(true);
    expect(west.canDonateTroops(hegemon)).toBe(true);
  });
});
