import { AttackExecution } from "../src/core/execution/AttackExecution";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { Executor } from "../src/core/execution/ExecutionManager";
import { HegemonExecution } from "../src/core/execution/HegemonExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { RazeExecution } from "../src/core/execution/RazeExecution";
import {
  Game,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";
import { UseRealAttackLogic } from "./util/TestConfig";
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

  test("a strike lands after its flight, grows a bubble of Hegemon land, and pops it to neutral when it ends", () => {
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
    // Dark Star.
    let ticks = 0;
    while (hegemon.outgoingAttacks().length > 0 && ticks++ < 3000) {
      game.executeNextTick();
    }
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
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

  test("the struck player fights the bubble like any attacker, and its troops come out of the strike", () => {
    const strike = landStrike(300_000);
    expect(strike.isStrike()).toBe(true);
    executeTicks(game, 30);
    const bubble = game.hegemonBubbleTiles();
    expect(bubble).toBeGreaterThan(20);
    expect(east.isStruckBy(hegemon)).toBe(true);

    const hegemonTroops = hegemon.troops();
    east.setTroops(400_000);
    game.addExecution(new AttackExecution(300_000, east, hegemon.id()));
    executeTicks(game, 2);
    // Not cancelled troop for troop: both attacks are in the field.
    expect(east.outgoingAttacks()).toHaveLength(1);
    expect(hegemon.outgoingAttacks()).toHaveLength(1);
    const strikeTroops = strike.troops();

    executeTicks(game, 20);
    const retaken = Array.from(east.tiles()).filter((t) =>
      game.isInDarkStar(t),
    ).length;
    expect(retaken).toBe(0);
    // The counter-attack takes bubble tiles back and bleeds the strike; the
    // Dark Star's own army is untouched (it has only regenerated).
    expect(strike.troops()).toBeLessThan(strikeTroops - 1000);
    expect(hegemon.troops()).toBeGreaterThanOrEqual(hegemonTroops);
  });

  test("a strike ground down to nothing pops: the land goes neutral, not to the Hegemon", () => {
    landStrike(40_000);
    executeTicks(game, 30);
    const eastTiles = east.numTilesOwned();
    east.setTroops(1_000_000);
    game.addExecution(new AttackExecution(800_000, east, hegemon.id()));
    let ticks = 0;
    while (hegemon.outgoingAttacks().length > 0 && ticks++ < 600) {
      game.executeNextTick();
    }
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
    expect(game.hegemonBubbleTiles()).toBe(0);
    // What east retook is east's; what the bubble still held is neutral.
    expect(east.numTilesOwned()).toBeGreaterThan(eastTiles);
  });

  test("nobody but the struck player may attack the bubble", () => {
    landStrike(300_000);
    executeTicks(game, 60);
    expect(game.hegemonBubbleTiles()).toBeGreaterThan(0);
    const bubbleTile = Array.from(hegemon.tiles()).find(
      (t) => !game.isInDarkStar(t),
    )!;
    expect(east.canAttack(bubbleTile)).toBe(true);
    expect(west.canAttack(bubbleTile)).toBe(false);
    const westTroops = west.troops();
    game.addExecution(new AttackExecution(50_000, west, hegemon.id()));
    executeTicks(game, 2);
    expect(west.outgoingAttacks()).toHaveLength(0);
    expect(west.troops()).toBeGreaterThanOrEqual(westTroops);

    // The invader's orders remain its invasion: the Dark Star itself is open.
    const g = game.darkStar()!;
    west.conquer(game.ref(g.cx - g.radius, g.cy));
    expect(west.canAttack(game.ref(g.cx - g.radius + 1, g.cy))).toBe(true);
    game.addExecution(new AttackExecution(50_000, west, hegemon.id()));
    executeTicks(game, 2);
    expect(west.outgoingAttacks()).toHaveLength(1);
  });

  test("a recalled strike pops its bubble and brings the survivors home", () => {
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
    expect(hegemon.troops()).toBeGreaterThan(before + 100_000);
  });

  test("the throne falls with its last Dark Star tile: a bubble does not keep it alive", () => {
    landStrike(300_000);
    executeTicks(game, 30);
    expect(game.hegemonBubbleTiles()).toBeGreaterThan(0);
    for (const tile of Array.from(hegemon.tiles())) {
      if (game.isInDarkStar(tile)) west.conquer(tile);
    }
    expect(hegemon.isAlive()).toBe(false);
    expect(game.hegemonBubbleTiles()).toBe(0);
    executeTicks(game, 2);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
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

  test("a strike recalled in flight comes home whole, by the ordinary cancel-attack order", () => {
    const before = hegemon.troops();
    game.addExecution(new RazeExecution(hegemon, anyTile(east), 100_000));
    executeTicks(game, 1);
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
