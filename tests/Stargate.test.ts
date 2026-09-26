import { BoatRetreatExecution } from "../src/core/execution/BoatRetreatExecution";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { Executor } from "../src/core/execution/ExecutionManager";
import { GateShotExecution } from "../src/core/execution/GateShotExecution";
import { HegemonExecution } from "../src/core/execution/HegemonExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { RazeExecution } from "../src/core/execution/RazeExecution";
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
import { TestConfig, UseRealAttackLogic } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

// Stargates (C4 in docs/DarkStar-Design.md, §6.8 stage 3).
//
// big_plains is 200×200: the Dark Star's radius is 18 and the moat 15, so
// with the real range (180 at level 1) a gate anywhere reaches everything.
// ShortRange shrinks it so range can be tested at all.
class ShortRange extends TestConfig {
  stargateConfig() {
    return { ...super.stargateConfig(), rangeBase: 30, rangePerLevel: 10 };
  }
}

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
  player.addGold(20_000_000n);
}

// A tile of the player's `dx` tiles in from the moat's outer shore.
function tileOf(player: Player, dx: number, dy = 0): TileRef {
  const g = game.darkStar()!;
  const side = player === east ? 1 : -1;
  return game.ref(g.cx + side * (g.radius + g.moatWidth + dx), g.cy + dy);
}

// The domain's shore on the player's side.
function domainShore(player: Player): TileRef {
  const g = game.darkStar()!;
  const side = player === east ? 1 : -1;
  return game.ref(g.cx + side * (g.radius - 1), g.cy);
}

async function start(
  ConfigClass: typeof TestConfig = TestConfig,
  humanThrone = false,
) {
  const humans = [
    new PlayerInfo("east", PlayerType.Human, "client1", "east"),
    new PlayerInfo("west", PlayerType.Human, "client2", "west"),
  ];
  if (humanThrone) {
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
    ConfigClass,
  );
  hegemon = game.hegemon()!;
  east = game.player("east");
  west = game.player("west");
  settle(east, 1, 30, 300_000);
  settle(west, -1, 30, 300_000);
  game.addExecution(new HegemonExecution());
  while (game.inSpawnPhase()) game.executeNextTick();
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

function fire(player: Player, tile: TileRef, troops: number): void {
  game.addExecution(new GateShotExecution(player, tile, troops));
  game.executeNextTick();
}

function flyUntilLanded(player: Player): void {
  let ticks = 0;
  while (shot(player) !== undefined && ticks++ < 500) game.executeNextTick();
}

describe("Building a stargate", () => {
  beforeEach(() => start());

  test("a challenger builds one on its land, with the silo's cost curve and a level; the Hegemon cannot", () => {
    const tile = tileOf(east, 5);
    expect(east.canBuild(UnitType.Stargate, tile)).not.toBe(false);
    const gold = east.gold();
    const gate = buildGate(east, tile);
    expect(gate.level()).toBe(1);
    expect(gate.isUnderConstruction()).toBe(false);
    expect(east.gold()).toBe(gold - 1_000_000n);
    // The throne never expands: no gate for it.
    expect(hegemon.canBuild(UnitType.Stargate, domainShore(east))).toBe(false);
  });

  test("upgrades buy range, up to level 5", () => {
    const gate = buildGate(east, tileOf(east, 5));
    const config = game.config();
    expect(config.stargateRange(1)).toBe(180);
    expect(config.stargateRange(2)).toBe(255);
    expect(config.stargateRange(5)).toBe(480);
    for (let level = 1; level < 5; level++) {
      expect(east.canUpgradeUnit(gate)).toBe(true);
      east.upgradeUnit(gate);
      expect(gate.level()).toBe(level + 1);
    }
    expect(east.canUpgradeUnit(gate)).toBe(false);
    expect(config.stargateRange(gate.level())).toBe(480);
  });
});

describe("Aiming a gate shot", () => {
  beforeEach(() => start(ShortRange));

  test("stargateFor: the nearest built gate with the tile in range, ready ones first", () => {
    const near = buildGate(east, tileOf(east, 5));
    // Level 1 range is 30 here: 28 tiles out is in range, 40 is not.
    const inRange = tileOf(east, 33);
    const outOfRange = tileOf(east, 45);
    expect(east.stargateFor(inRange)?.gateId).toBe(near.id());
    expect(east.stargateFor(inRange)?.readyInTicks).toBe(0);
    expect(east.stargateFor(outOfRange)).toBeNull();
    // An upgrade reaches it.
    east.upgradeUnit(near);
    expect(east.stargateFor(outOfRange)?.range).toBe(40);
    // A gate under construction is not a gate yet.
    expect(west.stargateFor(tileOf(west, 5))).toBeNull();
  });

  test("a shot needs a ready gate in range: none, or reloading, and nothing flies", () => {
    // East's land runs 30 tiles out; 33 is neutral and 28 from the gate.
    fire(east, tileOf(east, 33), 10_000);
    expect(shot(east)).toBeUndefined();
    const gate = buildGate(east, tileOf(east, 5));
    const troops = east.troops();
    fire(east, tileOf(east, 33), 10_000);
    expect(shot(east)).toBeDefined();
    expect(east.troops()).toBe(troops - 10_000);
    expect(gate.missileTimerQueue()).toHaveLength(1);
    expect(east.stargateFor(tileOf(east, 33))?.readyInTicks).toBeGreaterThan(
      500,
    );
    // Reloading: refused, nothing taken.
    const after = east.troops();
    fire(east, tileOf(east, 32), 10_000);
    expect(east.units(UnitType.Projectile)).toHaveLength(1);
    expect(east.troops()).toBe(after);
    // Ready again after the cooldown.
    executeTicks(game, game.config().stargateCooldown() + 1);
    expect(gate.missileTimerQueue()).toHaveLength(0);
    expect(east.stargateFor(tileOf(east, 33))?.readyInTicks).toBe(0);
  });

  test("refused on the shooter's own land, on water, and by the Hegemon", () => {
    buildGate(east, tileOf(east, 5));
    const troops = east.troops();
    fire(east, tileOf(east, 10), 10_000);
    expect(shot(east)).toBeUndefined();
    expect(east.troops()).toBe(troops);
    // The moat is water.
    const g = game.darkStar()!;
    fire(east, game.ref(g.cx + g.radius + 2, g.cy), 10_000);
    expect(shot(east)).toBeUndefined();
    game.addExecution(new GateShotExecution(hegemon, tileOf(east, 10), 10_000));
    game.executeNextTick();
    expect(hegemon.units(UnitType.Projectile)).toHaveLength(0);
  });
});

describe("A gate shot in flight and its landing", () => {
  beforeEach(() => start());

  test("flies the projectile arc from the gate and lands as a beachhead on neutral land", () => {
    const gate = buildGate(east, tileOf(east, 5));
    const aim = tileOf(east, 60, 15);
    expect(game.hasOwner(aim)).toBe(false);
    const tiles = east.numTilesOwned();
    fire(east, aim, 20_000);
    const unit = shot(east)!;
    expect(unit.tile()).toBe(gate.tile());
    expect(unit.targetTile()).toBe(aim);
    expect(unit.troops()).toBe(20_000);
    executeTicks(game, 2);
    expect(unit.tile()).not.toBe(gate.tile());
    flyUntilLanded(east);
    expect(unit.isActive()).toBe(false);
    expect(unit.reachedTarget()).toBe(true);
    expect(unit.tile()).toBe(aim);
    // The beachhead: the aimed tile is ours and an attack grows from it.
    expect(game.owner(aim)).toBe(east);
    expect(east.outgoingAttacks()).toHaveLength(1);
    expect(east.outgoingAttacks()[0].sourceTile()).toBe(aim);
    executeTicks(game, 30);
    expect(east.numTilesOwned()).toBeGreaterThan(tiles + 20);
    expect(game.gateShotsInFlight()).toHaveLength(0);
  });

  test("lands on an enemy's land and fights it; the troops were paid at launch", () => {
    buildGate(east, tileOf(east, 5));
    const aim = tileOf(west, 5);
    expect(game.owner(aim)).toBe(west);
    const westTiles = west.numTilesOwned();
    fire(east, aim, 50_000);
    flyUntilLanded(east);
    expect(game.owner(aim)).toBe(east);
    const attack = east.outgoingAttacks()[0];
    expect(attack.target()).toBe(west);
    executeTicks(game, 30);
    expect(west.numTilesOwned()).toBeLessThan(westTiles - 5);
  });

  test("a recall in flight (the boat cancel order on the unit) brings the troops home whole", () => {
    buildGate(east, tileOf(east, 5));
    const before = east.troops();
    fire(east, tileOf(west, 5), 20_000);
    const unit = shot(east)!;
    executeTicks(game, 2);
    expect(east.troops()).toBe(before - 20_000);
    game.addExecution(new BoatRetreatExecution(east, unit.id()));
    executeTicks(game, 2);
    expect(unit.isActive()).toBe(false);
    expect(unit.reachedTarget()).toBe(false);
    expect(east.troops()).toBe(before);
    expect(game.gateShotsInFlight()).toHaveLength(0);
    executeTicks(game, 30);
    expect(east.outgoingAttacks()).toHaveLength(0);
  });

  test("the gate_shot intent from a challenger launches a shot", () => {
    buildGate(east, tileOf(east, 5));
    const executor = new Executor(game, "game", undefined);
    game.addExecution(
      executor.createExec({
        type: "gate_shot",
        clientID: "client1", // east
        tile: tileOf(west, 5),
        troops: 5_000,
      }),
    );
    game.executeNextTick();
    expect(shot(east)).toBeDefined();
    expect(shot(east)!.troops()).toBe(5_000);
  });
});

describe("Gate shots and the Dark Star (H6, H12)", () => {
  beforeEach(() => start());

  test("a shot on the domain lands, claims the invasion slot and fights the Hegemon", () => {
    buildGate(east, tileOf(east, 5));
    const aim = domainShore(east);
    expect(game.isInDarkStar(aim)).toBe(true);
    expect(game.darkStarInvader()).toBeNull();
    fire(east, aim, 100_000);
    flyUntilLanded(east);
    expect(game.owner(aim)).toBe(east);
    expect(game.darkStarInvader()).toBe(east);
    expect(east.domainTilesHeld()).toBeGreaterThan(0);
    // The beachhead attack is up the tick it lands; the AI throne's landing
    // wave then fights it like any invasion (H13, §6.2).
    expect(east.outgoingAttacks()).toHaveLength(1);
    expect(east.outgoingAttacks()[0].target()).toBe(hegemon);
  });

  test("while another power holds the slot the shot is refused at launch", () => {
    buildGate(east, tileOf(east, 5));
    buildGate(west, tileOf(west, 5));
    fire(east, domainShore(east), 100_000);
    flyUntilLanded(east);
    expect(game.darkStarInvader()).toBe(east);
    const troops = west.troops();
    fire(west, domainShore(west), 50_000);
    expect(shot(west)).toBeUndefined();
    expect(west.troops()).toBe(troops);
  });

  test("a shot bound for the Dark Star turns back the moment someone else claims the slot", () => {
    buildGate(west, tileOf(west, 5));
    const troops = west.troops();
    fire(west, domainShore(west), 50_000);
    const unit = shot(west)!;
    executeTicks(game, 2);
    expect(unit.isActive()).toBe(true);
    // East lands by other means first.
    east.conquer(domainShore(east));
    expect(game.darkStarInvader()).toBe(east);
    game.executeNextTick();
    expect(unit.isActive()).toBe(false);
    expect(unit.reachedTarget()).toBe(false);
    expect(west.troops()).toBe(troops);
    expect(game.gateShotsInFlight()).toHaveLength(0);
  });
});

describe("Gate shots and a strike's bubble (H17)", () => {
  beforeEach(() => start(TestConfig, true));

  test("only the struck player may land on the bubble", () => {
    buildGate(east, tileOf(east, 5));
    buildGate(west, tileOf(west, 5));
    // The throne strikes east: bubble tiles are the Hegemon's, beyond the moat.
    game.addExecution(new RazeExecution(hegemon, tileOf(east, 10), 100_000));
    let ticks = 0;
    while (game.hegemonBubbleTiles() < 5 && ticks++ < 300) {
      game.executeNextTick();
    }
    const bubbleTile = Array.from(hegemon.tiles()).find(
      (t) => !game.isInDarkStar(t),
    )!;
    expect(bubbleTile).toBeDefined();
    const westTroops = west.troops();
    fire(west, bubbleTile, 10_000);
    expect(shot(west)).toBeUndefined();
    expect(west.troops()).toBe(westTroops);
    fire(east, bubbleTile, 10_000);
    expect(shot(east)).toBeDefined();
  });
});

describe("A beachhead inside enemy land (the enclave rule)", () => {
  // Real combat, so the pocket grows slowly, and each player's own
  // PlayerExecution (setup() does not add them), which runs the enclave
  // rule every 20 ticks: a small cluster sealed in by one enemy is handed
  // to that enemy — unless it is a live beachhead.
  beforeEach(async () => {
    await start(UseRealAttackLogic);
    game.addExecution(new PlayerExecution(east), new PlayerExecution(west));
  });

  test("a shot deep in a nation's land founds a pocket that stands while the landing tile is held", () => {
    buildGate(east, tileOf(east, 5));
    // Well inside west's block: every neighbour is west's.
    const aim = tileOf(west, 15);
    expect(game.owner(aim)).toBe(west);
    const westTiles = west.numTilesOwned();
    fire(east, aim, 50_000);
    flyUntilLanded(east);
    expect(game.owner(aim)).toBe(east);
    expect(east.isBeachhead(aim)).toBe(true);
    // Two cluster checks later the pocket is still ours and still fighting.
    executeTicks(game, 40);
    expect(game.owner(aim)).toBe(east);
    expect(east.outgoingAttacks()).toHaveLength(1);
    expect(west.numTilesOwned()).toBeLessThan(westTiles - 5);
    // The attack burns out; the pocket, sealed in by west, still stands.
    executeTicks(game, 80);
    expect(east.outgoingAttacks()).toHaveLength(0);
    expect(game.owner(aim)).toBe(east);
    const pocket = Array.from(east.tiles()).filter(
      (t) => game.x(t) < game.darkStar()!.cx,
    );
    expect(pocket.length).toBeGreaterThan(20);
    // West retakes the landing tile: the tag is gone, and the pocket is an
    // ordinary enclave at the next check.
    west.conquer(aim);
    expect(east.isBeachhead(aim)).toBe(false);
    executeTicks(game, 25);
    expect(
      Array.from(east.tiles()).filter((t) => game.x(t) < game.darkStar()!.cx),
    ).toHaveLength(0);
  });

  test("the tag is dropped when the tile is lost or relinquished, and only marks a tile the player holds", () => {
    const aim = tileOf(west, 15);
    east.markBeachhead(aim);
    expect(east.isBeachhead(aim)).toBe(false);
    west.markBeachhead(aim);
    expect(west.isBeachhead(aim)).toBe(true);
    west.relinquish(aim);
    expect(west.isBeachhead(aim)).toBe(false);
    expect(west.beachheadCount()).toBe(0);
  });
});

describe("A beachhead inside the Dark Star (the enclave rule)", () => {
  beforeEach(async () => {
    await start(UseRealAttackLogic, true); // a human throne: no landing wave
    game.addExecution(new PlayerExecution(east));
  });

  test("the invader's foothold stands after its attack is spent, until the throne retakes the landing tile", () => {
    buildGate(east, tileOf(east, 5));
    const g = game.darkStar()!;
    const aim = game.ref(g.cx + g.radius - 12, g.cy);
    fire(east, aim, 50_000);
    flyUntilLanded(east);
    expect(game.darkStarInvader()).toBe(east);
    executeTicks(game, 20);
    expect(game.owner(aim)).toBe(east);
    expect(game.darkStarInvader()).toBe(east);
    expect(east.domainTilesHeld()).toBeGreaterThan(5);
    expect(east.outgoingAttacks()).toHaveLength(1);
    // The fortress burns the attack out within a few seconds; the foothold
    // is kept past the next cluster checks (no fiat absorption)...
    let ticks = 0;
    while (east.outgoingAttacks().length > 0 && ticks++ < 100) {
      game.executeNextTick();
    }
    expect(east.outgoingAttacks()).toHaveLength(0);
    executeTicks(game, 40);
    expect(east.domainTilesHeld()).toBeGreaterThan(5);
    expect(game.darkStarInvader()).toBe(east);
    // ...until the stalled invasion draws the throne's counter-attack (H13),
    // which takes the domain back by reconquest.
    let sawCounterAttack = false;
    ticks = 0;
    while (east.domainTilesHeld() > 0 && ticks++ < 200) {
      game.executeNextTick();
      sawCounterAttack ||= hegemon.outgoingAttacks().length > 0;
    }
    expect(sawCounterAttack).toBe(true);
    expect(east.domainTilesHeld()).toBe(0);
    expect(east.isBeachhead(aim)).toBe(false);
    expect(game.darkStarInvader()).toBeNull();
  });
});
