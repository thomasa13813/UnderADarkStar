import { BoatRetreatExecution } from "../src/core/execution/BoatRetreatExecution";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { HegemonExecution } from "../src/core/execution/HegemonExecution";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { NationHegemonBehavior } from "../src/core/execution/nation/NationHegemonBehavior";
import { NationStargateBehavior } from "../src/core/execution/nation/NationStargateBehavior";
import { NationStructureBehavior } from "../src/core/execution/nation/NationStructureBehavior";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import {
  Difficulty,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

// Nations build and fire stargates (C4 in docs/DarkStar-Design.md, §6.8
// stage 5). big_plains is 200×200: the Dark Star's radius is 18 and the moat
// 15. With the real range (120 at level 1) a gate anywhere reaches the rim
// and the rival across the moat; ShortRange (30, +10 per level) leaves a gate
// deep in a nation's land short of the rim, so the fleet fallback and the
// range upgrade can be tested.
class ShortRange extends TestConfig {
  stargateConfig() {
    return { ...super.stargateConfig(), rangeBase: 30, rangePerLevel: 10 };
  }
}

let game: Game;
let hegemon: Player;
let east: Player;
let west: Player;
let random: PseudoRandom;

// A block of land beyond the moat's outer shore, east (+1) or west (-1).
function settle(player: Player, side: 1 | -1, depth: number, troops: number) {
  const g = game.darkStar()!;
  const outer = g.radius + g.moatWidth;
  game.forEachTile((tile) => {
    const dx = (game.x(tile) - g.cx) * side - outer;
    const dy = game.y(tile) - g.cy;
    if (dx >= 0 && dx < depth && Math.abs(dy) < 10 && game.isLand(tile)) {
      player.conquer(tile);
    }
  });
  player.setTroops(troops);
  player.addGold(20_000_000n);
}

// A tile of the player's `dx` tiles in from the moat's outer shore.
function tileOf(player: Player, dx: number, dy = 0): TileRef {
  const g = game.darkStar()!;
  const side = player === east ? 1 : -1;
  return game.ref(g.cx + side * (g.radius + g.moatWidth + dx), g.cy + dy);
}

async function start(ConfigClass: typeof TestConfig = TestConfig) {
  game = await setup(
    "big_plains",
    {
      hegemon: { enabled: true },
      disableNavMesh: false,
      instantBuild: true,
      difficulty: Difficulty.Hard,
    },
    [
      new PlayerInfo("east", PlayerType.Nation, null, "east"),
      new PlayerInfo("west", PlayerType.Nation, null, "west"),
    ],
    undefined,
    ConfigClass,
  );
  hegemon = game.hegemon()!;
  east = game.player("east");
  west = game.player("west");
  settle(east, 1, 60, 300_000);
  settle(west, -1, 60, 100_000);
  game.addExecution(new HegemonExecution());
  while (game.inSpawnPhase()) game.executeNextTick();
  random = new PseudoRandom(42);
}

function buildGate(player: Player, tile: TileRef): Unit {
  game.addExecution(new ConstructionExecution(player, UnitType.Stargate, tile));
  executeTicks(game, 2);
  const gate = player.units(UnitType.Stargate).find((u) => u.tile() === tile);
  if (gate === undefined) throw new Error("gate not built");
  return gate;
}

function shot(player: Player): Unit | undefined {
  return player.units(UnitType.Projectile)[0];
}

function flyUntilLanded(player: Player): void {
  let ticks = 0;
  while (shot(player) !== undefined && ticks++ < 500) game.executeNextTick();
}

function boatsToDarkStar(player: Player) {
  return player
    .units(UnitType.TransportShip)
    .filter((b) => game.isInDarkStar(b.targetTile()!));
}

function structureAI(player: Player): NationStructureBehavior {
  return new NationStructureBehavior(
    random,
    game,
    player,
    new NationHegemonBehavior(game, player),
  );
}

function stargateAI(player: Player): NationStargateBehavior {
  const attack = new AiAttackBehavior(
    random,
    game,
    player,
    0.5,
    0.3,
    0.1,
    undefined,
    new NationEmojiBehavior(random, game, player),
  );
  return new NationStargateBehavior(random, game, player, attack);
}

describe("Building gates (NationStructureBehavior)", () => {
  test("a nation ready for the throne builds its first gate towards the moat, whatever its city count", async () => {
    await start();
    east.setTroops(hegemon.troops());
    const ai = new NationHegemonBehavior(game, east);
    expect(ai.wantsThrone()).toBe(true);
    expect(east.units(UnitType.City)).toHaveLength(0);

    expect(structureAI(east).handleStructures()).toBe(true);
    executeTicks(game, 2);
    const gates = east.units(UnitType.Stargate);
    expect(gates).toHaveLength(1);
    // Pulled towards the Dark Star: in the nearer half of a 60-deep block.
    const g = game.darkStar()!;
    expect(
      game.x(gates[0].tile()) - (g.cx + g.radius + g.moatWidth),
    ).toBeLessThan(30);
    // And the gate reaches the rim.
    expect(ai.gateReaches()[0].shortfall).toBeLessThanOrEqual(0);
  });

  test("a nation not ready for the throne builds gates by the city ratio, like silos", async () => {
    await start();
    // Far below the bar, and no cities: no gate wanted.
    const ai = structureAI(east);
    ai.handleStructures();
    executeTicks(game, 2);
    expect(east.units(UnitType.Stargate)).toHaveLength(0);
  });

  test("upgrades the gate that falls short of the moat when its levels left would close the gap", async () => {
    await start(ShortRange);
    east.setTroops(hegemon.troops());
    const gate = buildGate(east, tileOf(east, 30)); // 46 tiles from the rim
    const hegemonAI = new NationHegemonBehavior(game, east);
    expect(hegemonAI.gateReaches()[0].shortfall).toBeGreaterThan(0);

    const ai = structureAI(east);
    expect(ai.handleStructures()).toBe(true);
    executeTicks(game, 2);
    expect(gate.level()).toBe(2);
    expect(ai.handleStructures()).toBe(true);
    executeTicks(game, 2);
    expect(gate.level()).toBe(3); // range 50: the rim is in reach
    expect(hegemonAI.gateReaches()[0].shortfall).toBeLessThanOrEqual(0);

    // Reached: no further gate work this turn.
    ai.handleStructures();
    executeTicks(game, 2);
    expect(gate.level()).toBe(3);
    expect(east.units(UnitType.Stargate)).toHaveLength(1);
  });
});

describe("Invading the Dark Star by gate (NationHegemonBehavior)", () => {
  test("a ready gate that reaches the rim fires the invasion instead of a fleet, and it lands", async () => {
    await start();
    buildGate(east, tileOf(east, 5));
    east.setTroops(hegemon.troops());
    const cfg = game.config().hegemonConfig();
    const troops = east.troops();
    const ai = new NationHegemonBehavior(game, east);

    expect(ai.considerInvasion()).toBe(true);
    game.executeNextTick();
    expect(boatsToDarkStar(east)).toHaveLength(0);
    const projectile = shot(east);
    expect(projectile).toBeDefined();
    expect(game.isInDarkStar(projectile!.targetTile()!)).toBe(true);
    expect(projectile!.troops()).toBe(
      Math.floor((troops * cfg.aiInvasionSendPercent) / 100),
    );
    // One invasion at a time: nothing more while the shot is in the air.
    expect(ai.considerInvasion()).toBe(false);

    flyUntilLanded(east);
    expect(game.darkStarInvader()).toBe(east);
    // Now it pushes by land, never a second shot on its own foothold.
    expect(ai.considerInvasion()).toBe(true);
    game.executeNextTick();
    expect(shot(east)).toBeUndefined();
    expect(east.outgoingAttacks().some((a) => a.target() === hegemon)).toBe(
      true,
    );
  });

  test("a gate short of the rim is no use: the fleet goes as before", async () => {
    await start(ShortRange);
    buildGate(east, tileOf(east, 30));
    east.setTroops(hegemon.troops());
    const ai = new NationHegemonBehavior(game, east);

    expect(ai.considerInvasion()).toBe(true);
    executeTicks(game, 2);
    expect(shot(east)).toBeUndefined();
    expect(boatsToDarkStar(east)).toHaveLength(1);
  });

  test("the slot and the reload are respected: no shot while another power holds the Dark Star, none from a reloading gate", async () => {
    await start();
    const gate = buildGate(east, tileOf(east, 5));
    east.setTroops(hegemon.troops());
    const ai = new NationHegemonBehavior(game, east);
    const g = game.darkStar()!;

    west.conquer(game.ref(g.cx - g.radius, g.cy));
    expect(ai.wantsThrone()).toBe(false);
    expect(ai.considerInvasion()).toBe(false);
    executeTicks(game, 2);
    expect(shot(east)).toBeUndefined();
    expect(boatsToDarkStar(east)).toHaveLength(0);

    // The slot frees; the gate has fired at someone else and is reloading.
    hegemon.conquer(game.ref(g.cx - g.radius, g.cy));
    gate.launch();
    expect(ai.wantsThrone()).toBe(true);
    expect(ai.considerInvasion()).toBe(true); // by fleet
    executeTicks(game, 2);
    expect(shot(east)).toBeUndefined();
    expect(boatsToDarkStar(east)).toHaveLength(1);
  });
});

describe("Shots at rivals (NationStargateBehavior)", () => {
  test("with a ready gate a nation fires across the moat at a rival it shares no land border with, sized like a boat landing", async () => {
    await start();
    buildGate(east, tileOf(east, 5));
    const ai = stargateAI(east);
    expect(east.sharesBorderWith(west)).toBe(false);

    expect(ai.maybeFire()).toBe(true);
    game.executeNextTick();
    const projectile = shot(east);
    expect(projectile).toBeDefined();
    expect(game.owner(projectile!.targetTile()!)).toBe(west);
    expect(projectile!.troops()).toBe(Math.floor(300_000 / 5));

    flyUntilLanded(east);
    const attack = east.outgoingAttacks().find((a) => a.target() === west);
    expect(attack).toBeDefined();
    expect(attack!.sourceTile()).not.toBeNull();
  });

  test("it does not stack a second shot on a rival it is already fighting from a landing", async () => {
    await start();
    buildGate(east, tileOf(east, 5, 8));
    buildGate(east, tileOf(east, 45, -8));
    const ai = stargateAI(east);

    expect(ai.maybeFire()).toBe(true);
    game.executeNextTick();
    // In the air: the second gate is ready but the shot counts as engagement.
    expect(ai.maybeFire()).toBe(false);
    flyUntilLanded(east);
    expect(east.outgoingAttacks().some((a) => a.target() === west)).toBe(true);
    expect(ai.maybeFire()).toBe(false);
    expect(east.units(UnitType.Projectile)).toHaveLength(0);
  });

  test("a reloading gate fires nothing until the cooldown has passed", async () => {
    await start();
    buildGate(east, tileOf(east, 5));
    const ai = stargateAI(east);

    expect(ai.maybeFire()).toBe(true);
    game.executeNextTick();
    // Recall so nothing lands and no fight is on.
    game.addExecution(new BoatRetreatExecution(east, shot(east)!.id()));
    executeTicks(game, 2);
    expect(shot(east)).toBeUndefined();
    expect(east.outgoingAttacks()).toHaveLength(0);

    expect(ai.maybeFire()).toBe(false);
    executeTicks(game, game.config().stargateCooldown());
    expect(ai.maybeFire()).toBe(true);
  });

  test("never at a friend", async () => {
    await start();
    buildGate(east, tileOf(east, 5));
    east.createAllianceRequest(west)?.accept();
    expect(east.isAlliedWith(west)).toBe(true);

    expect(stargateAI(east).maybeFire()).toBe(false);
    executeTicks(game, 2);
    expect(shot(east)).toBeUndefined();
  });

  test("never at the Hegemon, and never outside Hegemon mode", async () => {
    await start();
    buildGate(east, tileOf(east, 5));
    // West is the only rival; make it a friend and the Dark Star the only
    // thing in range.
    east.createAllianceRequest(west)?.accept();
    expect(stargateAI(east).maybeFire()).toBe(false);

    const plain = await setup("big_plains", {}, [
      new PlayerInfo("solo", PlayerType.Nation, null, "solo"),
    ]);
    const solo = plain.player("solo");
    expect(
      new NationStargateBehavior(
        random,
        plain,
        solo,
        new AiAttackBehavior(random, plain, solo, 0.5, 0.3, 0.1),
      ).maybeFire(),
    ).toBe(false);
  });
});
