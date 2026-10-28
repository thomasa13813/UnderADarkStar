import { AttackExecution } from "../src/core/execution/AttackExecution";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { CounterStrikeExecution } from "../src/core/execution/CounterStrikeExecution";
import { Executor } from "../src/core/execution/ExecutionManager";
import { HegemonExecution } from "../src/core/execution/HegemonExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { RazeExecution } from "../src/core/execution/RazeExecution";
import {
  Game,
  GameMode,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";
import { TestConfig, UseRealAttackLogic } from "./util/TestConfig";
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
  yOffset = 0,
) {
  const g = game.darkStar()!;
  const outer = g.radius + g.moatWidth;
  game.forEachTile((tile) => {
    const dx = (game.x(tile) - g.cx) * side - outer;
    const dy = game.y(tile) - g.cy - yOffset;
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

// The Hegemon's land beyond the Dark Star: its strikes' bubbles.
function bubbleTiles(): TileRef[] {
  return Array.from(hegemon.tiles()).filter((t) => !game.isInDarkStar(t));
}

// A popped bubble is erased into deep space, as an Antimatter Reaction erases.
function expectErased(tiles: TileRef[]) {
  expect(tiles.length).toBeGreaterThan(0);
  for (const t of tiles) {
    expect(game.hasOwner(t)).toBe(false);
    expect(game.isWater(t)).toBe(true);
  }
}

async function start(hegemonType: PlayerType, realCombat = false) {
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
    undefined,
    realCombat ? UseRealAttackLogic : undefined,
  );
  hegemon = game.hegemon()!;
  east = game.player("east");
  west = game.player("west");
  // East is large enough to be struck at no tyranny penalty (3% of the map's
  // land); west is an ordinary small player.
  settle(east, 1, 40, 100_000, 20);
  settle(west, -1, 20, 100_000);
  game.addExecution(new HegemonExecution());
  while (game.inSpawnPhase()) game.executeNextTick();
}

describe("Razing (H8)", () => {
  beforeEach(() => start(PlayerType.Human));

  test("a strike lands after its flight, grows a bubble of Hegemon land, and erases it into deep space when it ends", () => {
    const tiles = east.numTilesOwned();
    const troops = hegemon.troops();
    const domain = game.darkStar()!.domainTileCount;
    game.addExecution(new RazeExecution(hegemon, anyTile(east), 100_000));
    executeTicks(game, 5);
    // In flight: paid for (less a few ticks' regeneration), nothing hit yet.
    expect(hegemon.troops()).toBeLessThan(troops - 90_000);
    expect(east.numTilesOwned()).toBe(tiles);

    executeTicks(game, 100);
    // The bubble: the Hegemon holds what it took, for now.
    const bubble = game.hegemonBubbleTiles();
    expect(bubble).toBeGreaterThan(50);
    expect(hegemon.numTilesOwned()).toBe(domain + bubble);
    expect(east.numTilesOwned()).toBe(tiles - bubble);
    expect(game.hegemonDomainTiles()).toBe(domain);

    // Spent: the bubble pops, and the Hegemon never keeps land beyond the
    // Dark Star. Everything the strike took is gone for good.
    const taken = new Set<TileRef>();
    let ticks = 0;
    while (hegemon.outgoingAttacks().length > 0 && ticks++ < 3000) {
      for (const t of bubbleTiles()) taken.add(t);
      game.executeNextTick();
    }
    game.executeNextTick();
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
    expectErased(Array.from(taken));
    expect(game.hegemonBubbleTiles()).toBe(0);
    expect(hegemon.numTilesOwned()).toBe(domain);
    expect(east.numTilesOwned()).toBeLessThan(tiles - 50);
    expect(west.numTilesOwned()).toBeGreaterThan(0);
  });

  test("it never eliminates: razing stops at the tyranny floor and the survivors come home", () => {
    game.addExecution(new RazeExecution(hegemon, anyTile(east), 5_000_000));
    executeTicks(game, 5);
    const afterLaunch = hegemon.troops();
    executeTicks(game, 3000);
    // More than enough to raze east entirely — but the smaller east gets, the
    // more each tile costs, and at 0.5% of the map's land it is untouchable.
    const floor =
      (40_000 * game.config().hegemonConfig().tyrannyFloorPermille) / 1000;
    expect(east.isAlive()).toBe(true);
    expect(east.numTilesOwned()).toBe(floor);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
    const returned = hegemon.troops() - afterLaunch;
    expect(returned).toBeGreaterThan(0);
    expect(returned).toBeLessThan(5_000_000);
  });

  test("a player at or below the tyranny floor cannot be struck at all", () => {
    const small = game.addPlayer(
      new PlayerInfo("small", PlayerType.Human, "client9", "small"),
    );
    settle(small, 1, 5, 10_000, 3);
    // Beyond east's block, so it needs its own land: move it out of east's.
    expect(small.numTilesOwned()).toBeGreaterThan(0);
    expect(small.numTilesOwned()).toBeLessThan(200);
    const troops = hegemon.troops();
    game.addExecution(new RazeExecution(hegemon, anyTile(small), 500_000));
    executeTicks(game, 100);
    expect(hegemon.troops()).toBeGreaterThanOrEqual(troops);
    expect(small.numTilesOwned()).toBeGreaterThan(0);
  });

  test("tyranny: the cost multiplier runs from 100% at the free share to unlimited at the floor", () => {
    const config = game.config();
    expect(config.hegemonTyrannyLossPercent(1200)).toBe(100);
    expect(config.hegemonTyrannyLossPercent(40_000)).toBe(100);
    expect(config.hegemonTyrannyLossPercent(700)).toBe(200);
    expect(config.hegemonTyrannyLossPercent(210)).toBe(10_000);
    expect(config.hegemonTyrannyLossPercent(200)).toBeNull();
    expect(config.hegemonTyrannyLossPercent(0)).toBeNull();
  });

  test("structures in the bubble are captured, and die with it when it pops", () => {
    const city = anyTile(east);
    // What a spawn registers; it is this that clears units off unowned land
    // and hands captured ones over.
    game.addExecution(new PlayerExecution(east));
    east.addGold(10_000_000n);
    game.addExecution(new ConstructionExecution(east, UnitType.City, city));
    executeTicks(game, 5);
    expect(east.units(UnitType.City)).toHaveLength(1);

    game.addExecution(new RazeExecution(hegemon, city, 2_000_000));
    executeTicks(game, 40);
    expect(east.units(UnitType.City)).toHaveLength(0);
    expect(hegemon.units(UnitType.City)).toHaveLength(1);

    executeTicks(game, 3000);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
    executeTicks(game, 2);
    expect(east.units(UnitType.City)).toHaveLength(0);
    expect(hegemon.units(UnitType.City)).toHaveLength(0);
    expect(west.units(UnitType.City)).toHaveLength(0);
  });

  test("with no strike alive, the Hegemon keeps nothing beyond the moat, whatever handed it over", () => {
    const domain = game.darkStar()!.domainTileCount;
    const tile = anyTile(east);
    hegemon.conquer(tile);
    expect(game.hegemonBubbleTiles()).toBe(1);
    executeTicks(game, 11);
    expect(game.hegemonBubbleTiles()).toBe(0);
    expect(hegemon.numTilesOwned()).toBe(domain);
    // No strike held it, so it is no bubble: it reverts to neutral nebula.
    expect(game.hasOwner(tile)).toBe(false);
    expect(game.isLand(tile)).toBe(true);
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
      if (game.isInDarkStar(tile) && game.x(tile) > g.cx + g.radius - 10) {
        east.conquer(tile);
      }
    }
    game.addExecution(new AttackExecution(200_000, hegemon, east.id()));
    executeTicks(game, 2);
    expect(hegemon.outgoingAttacks()).toHaveLength(2);
  });
});

// The engine's real combat maths: the test stub costs every tile one troop,
// which makes any two opposing attacks swap a tile a tick forever.
describe("Strike counterplay (H17)", () => {
  beforeEach(() => start(PlayerType.Human, true));

  function landStrike(troops: number) {
    game.addExecution(new RazeExecution(hegemon, anyTile(east), troops));
    while (hegemon.outgoingAttacks().length === 0) game.executeNextTick();
    return hegemon.outgoingAttacks()[0];
  }

  test("troops committed against a strike cancel it one for one, up to a strike the size of the target's ceiling", () => {
    const raze = new RazeExecution(hegemon, anyTile(east), 100_000);
    game.addExecution(raze);
    while (hegemon.outgoingAttacks().length === 0) game.executeNextTick();
    const strike = hegemon.outgoingAttacks()[0];
    executeTicks(game, 10);
    expect(game.config().maxTroops(east)).toBeGreaterThan(100_000);
    const before = strike.troops();
    expect(raze.counter(40_000)).toBe(40_000);
    expect(strike.troops()).toBe(before - 40_000);
    // Only what it takes to cancel the rest is spent.
    expect(raze.counter(1_000_000)).toBe(Math.ceil(before - 40_000));
    expect(strike.troops()).toBe(0);
  });

  test("a disproportionate strike is cancelled at a better rate: its troops over the target's ceiling", () => {
    const ceiling = game.config().maxTroops(east);
    const troops = ceiling * 4;
    const raze = new RazeExecution(hegemon, anyTile(east), troops);
    game.addExecution(raze);
    while (hegemon.outgoingAttacks().length === 0) game.executeNextTick();
    const strike = hegemon.outgoingAttacks()[0];
    const before = strike.troops();
    expect(raze.counter(10_000)).toBe(10_000);
    expect(strike.troops()).toBeCloseTo(before - 40_000, 0);
    // The whole strike never costs more than the ceiling it was measured by.
    expect(raze.counter(10 * ceiling)).toBeLessThanOrEqual(ceiling);
    expect(strike.troops()).toBe(0);
  });

  test("countered to nothing, the strike pops: the bubble goes neutral and nothing returns to the throne", () => {
    landStrike(100_000);
    executeTicks(game, 30);
    const bubble = game.hegemonBubbleTiles();
    expect(bubble).toBeGreaterThan(20);
    const eastTiles = east.numTilesOwned();
    const hegemonTroops = hegemon.troops();
    east.setTroops(1_000_000);
    game.addExecution(new CounterStrikeExecution(east, 1_000_000));
    executeTicks(game, 3);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
    expect(game.hegemonBubbleTiles()).toBe(0);
    // Only what the strike cost was spent, and none of the bubble came back.
    expect(east.troops()).toBeGreaterThan(1_000_000 - 100_000);
    expect(east.numTilesOwned()).toBeLessThanOrEqual(eastTiles);
    expect(hegemon.troops()).toBeLessThan(hegemonTroops + 10_000);
  });

  test("a counter with no landed strike does nothing", () => {
    east.setTroops(500_000);
    game.addExecution(new CounterStrikeExecution(east, 100_000));
    executeTicks(game, 2);
    expect(east.troops()).toBeGreaterThanOrEqual(500_000);
  });

  test("the bubble is never fought over, by the struck player or anyone else", () => {
    landStrike(300_000);
    executeTicks(game, 60);
    expect(game.hegemonBubbleTiles()).toBeGreaterThan(0);
    const bubbleTile = Array.from(hegemon.tiles()).find(
      (t) => !game.isInDarkStar(t),
    )!;
    expect(east.canAttack(bubbleTile)).toBe(false);
    expect(west.canAttack(bubbleTile)).toBe(false);
    // Refused before any troops are taken (east's pool is being razed, so
    // only west's can be compared).
    const westTroops = west.troops();
    for (const p of [east, west]) {
      game.addExecution(new AttackExecution(50_000, p, hegemon.id()));
      executeTicks(game, 2);
      expect(p.outgoingAttacks()).toHaveLength(0);
    }
    expect(west.troops()).toBeGreaterThanOrEqual(westTroops);

    // The invader's orders remain its invasion: the Dark Star itself is open.
    const g = game.darkStar()!;
    west.conquer(game.ref(g.cx - g.radius, g.cy));
    expect(west.canAttack(game.ref(g.cx - g.radius + 1, g.cy))).toBe(true);
    game.addExecution(new AttackExecution(50_000, west, hegemon.id()));
    executeTicks(game, 2);
    expect(west.outgoingAttacks()).toHaveLength(1);
  });

  test("a recalled strike pops its bubble and its troops are lost", () => {
    const raze = new RazeExecution(hegemon, anyTile(east), 300_000);
    game.addExecution(raze);
    while (hegemon.outgoingAttacks().length === 0) game.executeNextTick();
    executeTicks(game, 30);
    expect(game.hegemonBubbleTiles()).toBeGreaterThan(0);
    const before = hegemon.troops();
    raze.recall();
    executeTicks(game, 2);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
    expect(game.hegemonBubbleTiles()).toBe(0);
    expect(hegemon.troops()).toBeLessThan(before + 10_000);
  });

  test("a recalled strike's bubble is erased too", () => {
    const raze = new RazeExecution(hegemon, anyTile(east), 300_000);
    game.addExecution(raze);
    while (hegemon.outgoingAttacks().length === 0) game.executeNextTick();
    executeTicks(game, 30);
    const bubble = bubbleTiles();
    raze.recall();
    executeTicks(game, 2);
    expectErased(bubble);
  });

  // An east tile next to the bubble, and one far from any Hegemon land.
  function orphanSites(): { touching: TileRef; far: TileRef } {
    const touchesHegemon = (t: TileRef) =>
      game.neighbors(t).some((n) => game.owner(n) === hegemon);
    const eastTiles = Array.from(east.tiles());
    const touching = eastTiles.find(touchesHegemon)!;
    const far = eastTiles
      .filter((t) => !touchesHegemon(t))
      .sort((a, b) => game.x(b) - game.x(a))[0];
    expect(touching).toBeDefined();
    expect(game.neighbors(far).some((n) => game.owner(n) === hegemon)).toBe(
      false,
    );
    return { touching, far };
  }

  test("land handed to the Hegemon behind the strike's back pops with the bubble, touching it or not", () => {
    const raze = new RazeExecution(hegemon, anyTile(east), 300_000);
    game.addExecution(raze);
    while (hegemon.outgoingAttacks().length === 0) game.executeNextTick();
    executeTicks(game, 30);
    const domain = game.darkStar()!.domainTileCount;
    const bubble = game.hegemonBubbleTiles();
    expect(bubble).toBeGreaterThan(0);

    // What PlayerExecution's enclave rule does: a conquest the strike never
    // made, so its bubble never heard of the tile.
    const { touching, far } = orphanSites();
    hegemon.conquer(touching);
    hegemon.conquer(far);
    expect(game.hegemonBubbleTiles()).toBe(bubble + 2);
    expect(raze.holdsTile(touching)).toBe(false);

    raze.recall();
    executeTicks(game, 2);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
    expect(game.hegemonBubbleTiles()).toBe(0);
    expect(hegemon.numTilesOwned()).toBe(domain);
    expectErased([touching, far]);
  });

  test("a pocket of the target's land the bubble seals in is swallowed into the bubble, and pops with it", () => {
    game.addExecution(new PlayerExecution(east));
    const raze = new RazeExecution(hegemon, anyTile(east), 300_000);
    game.addExecution(raze);
    while (hegemon.outgoingAttacks().length === 0) game.executeNextTick();
    executeTicks(game, 30);

    // A ring of bubble two tiles in from the front, around one east tile.
    const ring = (p: TileRef) => {
      const out: TileRef[] = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx !== 0 || dy !== 0) {
            out.push(game.ref(game.x(p) + dx, game.y(p) + dy));
          }
        }
      }
      return out;
    };
    let pocket: TileRef | null = null;
    for (const b of hegemon.tiles()) {
      if (game.isInDarkStar(b)) continue;
      const p = game.ref(game.x(b) + 2, game.y(b));
      if (
        game.owner(p) === east &&
        ring(p).every((t) => game.owner(t) === east)
      ) {
        pocket = p;
        break;
      }
    }
    expect(pocket).not.toBeNull();
    for (const t of ring(pocket!)) hegemon.conquer(t);
    expect(game.owner(pocket!)).toBe(east);

    // The engine's enclave rule hands the pocket to the Hegemon.
    executeTicks(game, 25);
    expect(game.owner(pocket!)).toBe(hegemon);
    expect(game.hegemonBubbleTiles()).toBeGreaterThan(0);

    raze.recall();
    executeTicks(game, 2);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
    expect(game.hegemonBubbleTiles()).toBe(0);
    expectErased([pocket!]);
  });

  test("two strikes: one popping leaves the other's bubble, and its orphans, alone", () => {
    // West, grown to east's size, so a strike on it lasts as well.
    settle(west, -1, 40, 100_000, 20);
    const onEast = new RazeExecution(hegemon, anyTile(east), 300_000);
    const onWest = new RazeExecution(hegemon, anyTile(west), 300_000);
    game.addExecution(onEast);
    game.addExecution(onWest);
    while (hegemon.outgoingAttacks().length < 2) game.executeNextTick();
    executeTicks(game, 30);
    expect(onEast.isActive()).toBe(true);
    expect(onWest.isActive()).toBe(true);
    const { touching } = orphanSites();
    hegemon.conquer(touching);
    const eastBubble = Array.from(hegemon.tiles()).filter(
      (t) =>
        !game.isInDarkStar(t) &&
        game.neighbors(t).some((n) => game.owner(n) === east),
    );
    expect(eastBubble.length).toBeGreaterThan(0);

    onWest.recall();
    executeTicks(game, 2);
    expect(hegemon.outgoingAttacks()).toHaveLength(1);
    expect(east.isStruckBy(hegemon)).toBe(true);
    expect(west.isStruckBy(hegemon)).toBe(false);
    // The east strike keeps its bubble, and the orphan it touches is now its.
    expect(game.owner(touching)).toBe(hegemon);
    expect(onEast.holdsTile(touching)).toBe(true);
    expect(game.hegemonBubbleTiles()).toBe(onEast.bubbleSize());

    onEast.recall();
    executeTicks(game, 2);
    expect(game.hegemonBubbleTiles()).toBe(0);
  });

  test("the throne falls with its last Dark Star tile: a bubble does not keep it alive", () => {
    landStrike(300_000);
    executeTicks(game, 30);
    expect(game.hegemonBubbleTiles()).toBeGreaterThan(0);
    const bubble = bubbleTiles();
    for (const tile of Array.from(hegemon.tiles())) {
      if (game.isInDarkStar(tile)) west.conquer(tile);
    }
    expect(hegemon.isAlive()).toBe(false);
    expect(game.hegemonBubbleTiles()).toBe(0);
    executeTicks(game, 2);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
    expectErased(bubble);
  });
});

describe("Punitive strikes (H11)", () => {
  test("an idle AI Hegemon strikes the strongest challenger once it is a threat", async () => {
    await start(PlayerType.Nation);
    const cfg = game.config().hegemonConfig();
    // Too small to be a threat: left alone however long the Hegemon idles.
    executeTicks(game, (cfg.levellerFullSeconds + 10) * 10);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);

    settle(west, -1, 60, 100_000, 40);
    const tiles = west.numTilesOwned();
    const eastTiles = east.numTilesOwned();
    let struck = false;
    for (let i = 0; i < (cfg.levellerFullSeconds + 60) * 10; i++) {
      game.executeNextTick();
      struck ||= hegemon.outgoingAttacks().some((a) => a.target() === west);
    }
    expect(struck).toBe(true);
    expect(west.numTilesOwned()).toBeLessThan(tiles);
    expect(east.numTilesOwned()).toBeGreaterThanOrEqual(eastTiles);
  });

  test("an invasion of the Dark Star leaves a live strike razing: its troops would not come home", async () => {
    await start(PlayerType.Nation);
    const cfg = game.config().hegemonConfig();
    settle(west, -1, 60, 100_000, 40);
    let ticks = 0;
    while (
      !hegemon.outgoingAttacks().some((a) => a.target() === west) &&
      ticks++ < (cfg.levellerFullSeconds + 60) * 10
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
      true,
    );
  });

  // Runs the idle AI Hegemon until its first leveller strike; returns its target.
  function firstStrikeTarget(): Player | null {
    const cfg = game.config().hegemonConfig();
    for (let i = 0; i < (cfg.levellerFullSeconds + 60) * 10; i++) {
      game.executeNextTick();
      const strike = hegemon.outgoingAttacks()[0];
      if (strike !== undefined) return strike.target() as Player;
    }
    return null;
  }

  test("land counts as well as capacity: a sprawling challenger outranks a small built-up one", async () => {
    await start(PlayerType.Nation);
    settle(east, 1, 80, 100_000, 60);
    game.addExecution(new PlayerExecution(west));
    west.addGold(100_000_000n);
    game.addExecution(
      new ConstructionExecution(west, UnitType.City, anyTile(west)),
    );
    executeTicks(game, 5);
    const city = west.units(UnitType.City)[0];
    city.increaseLevel();
    // By capacity alone west would be struck: two city levels outweigh
    // twenty times its land.
    expect(game.config().maxTroops(west)).toBeGreaterThan(
      game.config().maxTroops(east),
    );
    expect(firstStrikeTarget()).toBe(east);
  });

  test("teammates add up: the strongest team is struck at its strongest member", async () => {
    game = await setup(
      "big_plains",
      {
        hegemon: { enabled: true },
        disableNavMesh: false,
        instantBuild: true,
        gameMode: GameMode.Team,
        playerTeams: 2,
      },
      [
        new PlayerInfo(
          "solo",
          PlayerType.Human,
          "c1",
          "solo",
          false,
          null,
          [],
          0,
        ),
        new PlayerInfo("a", PlayerType.Human, "c2", "a", false, null, [], 1),
        new PlayerInfo("b", PlayerType.Human, "c3", "b", false, null, [], 1),
      ],
    );
    hegemon = game.hegemon()!;
    const solo = game.player("solo");
    const a = game.player("a");
    const b = game.player("b");
    expect(a.isOnSameTeam(b)).toBe(true);
    expect(a.isOnSameTeam(solo)).toBe(false);
    settle(solo, 1, 60, 100_000, 30);
    settle(a, -1, 60, 100_000, 20, -25);
    settle(b, -1, 50, 100_000, 20, 25);
    game.addExecution(new HegemonExecution());
    while (game.inSpawnPhase()) game.executeNextTick();
    // Alone, each teammate is smaller than solo.
    expect(a.numTilesOwned()).toBeLessThan(solo.numTilesOwned());
    expect(b.numTilesOwned()).toBeLessThan(a.numTilesOwned());
    expect(firstStrikeTarget()).toBe(a);
  });

  test("a human Hegemon is never made to strike", async () => {
    await start(PlayerType.Human);
    settle(west, -1, 60, 100_000, 40);
    executeTicks(game, 1500);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
  });
});

describe("Playing the Hegemon: the seat and the strike order", () => {
  beforeEach(() => start(PlayerType.Human));

  test("a strike intent from the Hegemon launches a strike; from anyone else it does nothing", () => {
    const executor = new Executor(game, "game", undefined);
    const tile = anyTile(east);
    const before = hegemon.troops();
    game.addExecution(
      executor.createExec({
        type: "strike",
        tile,
        troops: 200_000,
        clientID: "client1", // east
      }),
    );
    executeTicks(game, 2);
    expect(game.strikesInFlight()).toHaveLength(0);
    expect(hegemon.troops()).toBe(before);

    game.addExecution(
      executor.createExec({
        type: "strike",
        tile,
        troops: 200_000,
        clientID: "client3", // the throne
      }),
    );
    executeTicks(game, 1);
    const flight = game.strikesInFlight();
    expect(flight).toHaveLength(1);
    expect(flight[0].targetPlayer()).toBe(east);
    expect(flight[0].troopCount()).toBe(200_000);
    expect(flight[0].aimTile()).toBe(tile);
    expect(flight[0].landsAtTick()).toBeGreaterThan(game.ticks());
    expect(hegemon.troops()).toBe(before - 200_000);

    // The landed attack keeps the in-flight id: one HUD row from launch to end.
    const id = flight[0].id();
    while (hegemon.outgoingAttacks().length === 0) game.executeNextTick();
    expect(game.strikesInFlight()).toHaveLength(0);
    expect(hegemon.outgoingAttacks()[0].id()).toBe(id);
    expect(hegemon.outgoingAttacks()[0].isStrike()).toBe(true);

    // The struck player's counter_strike order cancels it (H17).
    const strike = hegemon.outgoingAttacks()[0];
    const strikeTroops = strike.troops();
    game.addExecution(
      executor.createExec({
        type: "counter_strike",
        troops: 50_000,
        clientID: "client1",
      }),
    );
    executeTicks(game, 1);
    expect(strike.troops()).toBeLessThan(strikeTroops - 49_000);
  });

  test("one live strike per target, any number of targets", () => {
    const before = hegemon.troops();
    game.addExecution(new RazeExecution(hegemon, anyTile(east), 100_000));
    game.addExecution(new RazeExecution(hegemon, anyTile(east), 100_000));
    game.addExecution(new RazeExecution(hegemon, anyTile(west), 100_000));
    executeTicks(game, 1);
    expect(game.strikesInFlight()).toHaveLength(2);
    expect(hegemon.troops()).toBe(before - 200_000);
    expect(game.hegemonStrikeOn(east)).toBe(true);
    expect(game.hegemonStrikeOn(west)).toBe(true);

    // Still refused once it is on the ground.
    while (hegemon.outgoingAttacks().length < 2) game.executeNextTick();
    game.addExecution(new RazeExecution(hegemon, anyTile(east), 100_000));
    executeTicks(game, 1);
    expect(game.strikesInFlight()).toHaveLength(0);
    expect(hegemon.outgoingAttacks()).toHaveLength(2);
  });

  test("a strike recalled in flight is lost, by the ordinary cancel-attack order", () => {
    game.addExecution(new RazeExecution(hegemon, anyTile(east), 100_000));
    executeTicks(game, 1);
    const before = hegemon.troops();
    const id = game.strikesInFlight()[0].id();
    hegemon.orderRetreat(id);
    expect(game.strikesInFlight()).toHaveLength(0);
    expect(hegemon.troops()).toBe(before);
    executeTicks(game, 60);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
    expect(game.hegemonBubbleTiles()).toBe(0);
  });

  test("the Hegemon cannot order a plain attack beyond the Dark Star, even next to its bubble", () => {
    expect(hegemon.canAttack(anyTile(east))).toBe(false);
    game.addExecution(new RazeExecution(hegemon, anyTile(east), 300_000));
    while (hegemon.outgoingAttacks().length === 0) game.executeNextTick();
    executeTicks(game, 20);
    expect(game.hegemonBubbleTiles()).toBeGreaterThan(0);
    for (const tile of east.borderTiles()) {
      expect(hegemon.canAttack(tile)).toBe(false);
    }
  });
});

describe("Playing the Hegemon: the singleplayer spawn phase", () => {
  async function startSingleplayer(humanHegemon: boolean) {
    const humans = [
      new PlayerInfo("east", PlayerType.Human, "client1", "east"),
    ];
    if (humanHegemon) {
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
      {
        hegemon: { enabled: true },
        gameType: GameType.Singleplayer,
        disableNavMesh: false,
      },
      humans,
      undefined,
      undefined,
      false,
    );
    game.addExecution(new HegemonExecution());
  }

  test("a seated human ends the spawn phase without spawning; a challenger still has to pick", async () => {
    await startSingleplayer(true);
    executeTicks(game, 5);
    expect(game.inSpawnPhase()).toBe(true);
    executeTicks(game, 100);
    expect(game.inSpawnPhase()).toBe(false);
    expect(game.hegemon()!.type()).toBe(PlayerType.Human);
    expect(game.hegemonDomainTiles()).toBe(game.darkStar()!.domainTileCount);

    await startSingleplayer(false);
    executeTicks(game, 150);
    expect(game.inSpawnPhase()).toBe(true);
  });
});

// The strike as a projectile (§6.8 stage 2): a Projectile unit flies the
// nuke's arc from the Dark Star's centre and the strike lands the tick it
// comes down.
class FastStrike extends TestConfig {
  hegemonConfig() {
    return { ...super.hegemonConfig(), strikeSpeed: 40 };
  }
}

describe("The strike as a projectile", () => {
  async function startWith(ConfigClass: typeof TestConfig) {
    const humans = [
      new PlayerInfo("east", PlayerType.Human, "client1", "east"),
      new PlayerInfo("west", PlayerType.Human, "client2", "west"),
    ];
    game = await setup(
      "big_plains",
      { hegemon: { enabled: true }, disableNavMesh: false, instantBuild: true },
      humans,
      undefined,
      ConfigClass,
    );
    hegemon = game.hegemon()!;
    east = game.player("east");
    west = game.player("west");
    settle(east, 1, 40, 100_000, 20);
    settle(west, -1, 20, 100_000);
    while (game.inSpawnPhase()) game.executeNextTick();
  }

  // Ticks from launch to landing at the given speed.
  async function flightTicks(ConfigClass: typeof TestConfig): Promise<number> {
    await startWith(ConfigClass);
    game.addExecution(new RazeExecution(hegemon, anyTile(east), 100_000));
    game.executeNextTick();
    const launched = game.ticks();
    const strike = game.strikesInFlight()[0];
    let ticks = 0;
    while (game.strikesInFlight().length > 0 && ticks++ < 1000) {
      game.executeNextTick();
    }
    // landsAtTick is the tick it lands IN; the counter is one past it after.
    expect(game.ticks()).toBe(strike.landsAtTick() + 1);
    return game.ticks() - launched;
  }

  test("a launched strike is a Projectile unit of the Hegemon's, flying the arc from the Dark Star's centre to the aim tile", async () => {
    await startWith(TestConfig);
    const g = game.darkStar()!;
    const aim = anyTile(east);
    game.addExecution(new RazeExecution(hegemon, aim, 100_000));
    game.executeNextTick();
    const units = game.units(UnitType.Projectile);
    expect(units).toHaveLength(1);
    const unit = units[0];
    expect(unit.owner()).toBe(hegemon);
    expect(unit.tile()).toBe(game.ref(g.cx, g.cy));
    expect(unit.targetTile()).toBe(aim);
    expect(unit.trajectory().length).toBeGreaterThan(2);
    const trajectory = unit.trajectory();
    expect(trajectory[trajectory.length - 1].tile).toBe(aim);
    const strike = game.strikesInFlight()[0];
    expect(strike.landsAtTick()).toBeGreaterThan(game.ticks() + 5);

    // It moves every tick, towards the target.
    const before = game.euclideanDistSquared(unit.tile(), aim);
    executeTicks(game, 3);
    expect(unit.tile()).not.toBe(game.ref(g.cx, g.cy));
    expect(game.euclideanDistSquared(unit.tile(), aim)).toBeLessThan(before);
    expect(unit.isActive()).toBe(true);
    expect(east.numTilesOwned()).toBeGreaterThan(0);

    // The landing: the unit comes down on the aim tile the tick the HUD was
    // told, marked as having reached it (the client's impact cue), and the
    // strike is on the ground from that tick.
    while (game.ticks() < strike.landsAtTick()) game.executeNextTick();
    expect(unit.isActive()).toBe(true);
    expect(game.strikesInFlight()).toHaveLength(1);
    // The next tick to run is landsAtTick: it lands in it.
    game.executeNextTick();
    expect(unit.isActive()).toBe(false);
    expect(unit.reachedTarget()).toBe(true);
    expect(unit.tile()).toBe(aim);
    expect(game.units(UnitType.Projectile)).toHaveLength(0);
    expect(game.strikesInFlight()).toHaveLength(0);
    expect(hegemon.outgoingAttacks()).toHaveLength(1);
    expect(hegemon.outgoingAttacks()[0].id()).toBe(strike.id());
    expect(game.owner(aim)).toBe(hegemon);
  });

  test("flight time is the arc divided by strikeSpeed", async () => {
    const slow = await flightTicks(TestConfig);
    const fast = await flightTicks(FastStrike);
    // big_plains is small: the hop over the moat is a few tiles' worth of arc.
    expect(slow).toBeGreaterThan(5);
    // Four times the speed: a fraction of the time (the arc is sampled in
    // whole tiles, so not exactly a quarter).
    expect(fast).toBeLessThan(slow / 2);
    expect(fast).toBeGreaterThanOrEqual(1);
  });

  test("a recall in flight removes the projectile without an impact", async () => {
    await startWith(TestConfig);
    game.addExecution(new RazeExecution(hegemon, anyTile(east), 100_000));
    executeTicks(game, 3);
    const before = hegemon.troops();
    const unit = game.units(UnitType.Projectile)[0];
    expect(unit.isActive()).toBe(true);
    hegemon.orderRetreat(game.strikesInFlight()[0].id());
    expect(unit.isActive()).toBe(false);
    expect(unit.reachedTarget()).toBe(false);
    expect(game.units(UnitType.Projectile)).toHaveLength(0);
    expect(hegemon.troops()).toBe(before);
    executeTicks(game, 200);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
    expect(game.hegemonBubbleTiles()).toBe(0);
  });

  test("the throne falling in flight removes the projectile", async () => {
    await startWith(TestConfig);
    game.addExecution(new RazeExecution(hegemon, anyTile(east), 100_000));
    executeTicks(game, 3);
    const unit = game.units(UnitType.Projectile)[0];
    for (const tile of Array.from(hegemon.tiles())) {
      if (game.isInDarkStar(tile)) west.conquer(tile);
    }
    expect(hegemon.isAlive()).toBe(false);
    executeTicks(game, 2);
    expect(unit.isActive()).toBe(false);
    expect(game.strikesInFlight()).toHaveLength(0);
    expect(game.hegemonStrikes()).toHaveLength(0);
    executeTicks(game, 100);
    expect(game.units(UnitType.Projectile)).toHaveLength(0);
    expect(game.hegemonBubbleTiles()).toBe(0);
  });
});
