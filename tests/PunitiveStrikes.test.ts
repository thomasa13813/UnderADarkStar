import { AttackExecution } from "../src/core/execution/AttackExecution";
import { Executor } from "../src/core/execution/ExecutionManager";
import { HegemonExecution } from "../src/core/execution/HegemonExecution";
import { NukeExecution } from "../src/core/execution/NukeExecution";
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
import { TestConfig } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

// Punitive strikes (docs/DarkStar-Design.md H19): a missile launch flags the
// launcher — under a Dark Star a stargate (C4, 2026-09-28; silos are off);
// the Hegemon may answer with a strike levied from every challenger, capped
// to a radius around the gate, halting and popping when it is full. The
// helpers keep the "silo" name: a gate is the silo's heir here.

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

// A tile well inside a player's block: the silo's site.
function inland(player: Player, side: 1 | -1): TileRef {
  const g = game.darkStar()!;
  return game.ref(g.cx + side * (g.radius + g.moatWidth + 20), g.cy);
}

function centre(): TileRef {
  const g = game.darkStar()!;
  return game.ref(g.cx, g.cy);
}

// Fire a warhead from the player's silo at the Dark Star's centre (which it
// cannot harm, H7) — a launch is a launch.
function fire(
  player: Player,
  warhead: UnitType.AtomBomb | UnitType.HydrogenBomb,
) {
  game.addExecution(new NukeExecution(warhead, player, centre()));
  executeTicks(game, 2);
}

// The strike on the ground, once landed.
function landed(): boolean {
  return hegemon.outgoingAttacks().some((a) => a.isPunitive());
}

function runUntilLanded() {
  let ticks = 0;
  while (!landed() && ticks++ < 500) game.executeNextTick();
  expect(landed()).toBe(true);
}

function runUntilOver() {
  let ticks = 0;
  while ((landed() || game.strikesInFlight().length > 0) && ticks++ < 3000) {
    game.executeNextTick();
  }
  expect(landed()).toBe(false);
}

function punish(tile: TileRef) {
  game.addExecution(new RazeExecution(hegemon, tile, null, true));
  executeTicks(game, 1);
}

async function start(
  hegemonType: PlayerType,
  ConfigClass: typeof TestConfig = TestConfig,
) {
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
    {
      hegemon: { enabled: true },
      disableNavMesh: false,
      instantBuild: true,
      infiniteGold: true,
    },
    humans,
    undefined,
    ConfigClass,
  );
  hegemon = game.hegemon()!;
  east = game.player("east");
  west = game.player("west");
  settle(east, 1, 40, 200_000, 20);
  settle(west, -1, 40, 100_000, 20);
  game.addExecution(new HegemonExecution());
  // What a spawn registers: it hands captured structures over and clears
  // them off unowned land.
  game.addExecution(new PlayerExecution(east));
  game.addExecution(new PlayerExecution(west));
  while (game.inSpawnPhase()) game.executeNextTick();
}

function buildSilo(player: Player, tile: TileRef): Unit {
  return player.buildUnit(UnitType.Stargate, tile, {});
}

describe("The flag (H19)", () => {
  beforeEach(() => start(PlayerType.Human));

  test("a launch flags the silo for punitiveFlagSeconds, and the flag expires", () => {
    const silo = buildSilo(east, inland(east, 1));
    expect(silo.punitiveFlag()).toBeUndefined();
    fire(east, UnitType.AtomBomb);
    const flag = silo.punitiveFlag();
    expect(flag).toBeDefined();
    expect(flag!.warhead).toBe(UnitType.AtomBomb);
    const seconds = game.config().hegemonConfig().punitiveFlagSeconds;
    expect(flag!.expiresTick).toBeGreaterThan(game.ticks());
    expect(flag!.expiresTick).toBeLessThanOrEqual(game.ticks() + seconds * 10);
    executeTicks(game, seconds * 10);
    expect(silo.punitiveFlag()).toBeUndefined();
  });

  test("the severer warhead wins, and the latest launch sets the expiry", () => {
    const silo = buildSilo(east, inland(east, 1));
    fire(east, UnitType.HydrogenBomb);
    const first = silo.punitiveFlag()!;
    expect(first.warhead).toBe(UnitType.HydrogenBomb);
    executeTicks(game, 50);
    silo.reloadMissile();
    fire(east, UnitType.AtomBomb);
    const second = silo.punitiveFlag()!;
    expect(second.warhead).toBe(UnitType.HydrogenBomb);
    expect(second.expiresTick).toBeGreaterThan(first.expiresTick);
  });

  test("no flag arises while the throne is already striking the player", () => {
    const silo = buildSilo(east, inland(east, 1));
    game.addExecution(new RazeExecution(hegemon, inland(east, 1), 50_000));
    executeTicks(game, 1);
    expect(game.hegemonStrikeOn(east)).toBe(true);
    fire(east, UnitType.AtomBomb);
    expect(silo.punitiveFlag()).toBeUndefined();
  });

  test("the option the Hegemon sees: the flag, its levy, and nothing while a strike is alive", () => {
    const tile = inland(east, 1);
    buildSilo(east, tile);
    expect(RazeExecution.punitiveOption(game, tile)).toBeNull();
    fire(east, UnitType.AtomBomb);
    const option = RazeExecution.punitiveOption(game, tile)!;
    expect(option.siloTile).toBe(tile);
    expect(option.warhead).toBe(UnitType.AtomBomb);
    const cfg = game.config().hegemonConfig();
    expect(option.levyPercent).toBe(cfg.punitiveLevyPercentNuclear);
    expect(option.levyTroops).toBe(
      Math.floor((east.troops() * cfg.punitiveLevyPercentNuclear) / 100) +
        Math.floor((west.troops() * cfg.punitiveLevyPercentNuclear) / 100),
    );
    punish(tile);
    expect(RazeExecution.punitiveOption(game, tile)).toBeNull();
  });

  test("a click near the silo, not on its one tile, still means it; the strike lands on the silo", () => {
    const tile = inland(east, 1);
    const silo = buildSilo(east, tile);
    fire(east, UnitType.AtomBomb);
    const near = game.ref(game.x(tile) + 3, game.y(tile) - 2);
    const far = game.ref(
      game.x(tile) + RazeExecution.CLICK_RADIUS + 2,
      game.y(tile),
    );
    expect(RazeExecution.punitiveOption(game, near)?.siloTile).toBe(tile);
    expect(RazeExecution.punitiveOption(game, far)).toBeNull();
    // Two flagged silos: the nearer one is meant.
    const other = buildSilo(east, game.ref(game.x(tile) + 8, game.y(tile)));
    other.reloadMissile();
    fire(east, UnitType.AtomBomb);
    expect(other.punitiveFlag()).toBeDefined();
    expect(RazeExecution.punitiveOption(game, near)?.siloTile).toBe(tile);

    punish(near);
    const flight = game.strikesInFlight();
    expect(flight).toHaveLength(1);
    expect(flight[0].aimTile()).toBe(tile);
    runUntilLanded();
    expect(game.owner(tile)).toBe(hegemon);
    executeTicks(game, 2);
    expect(silo.owner()).toBe(hegemon);
  });
});

describe("The levy and the strike (H19)", () => {
  beforeEach(() => start(PlayerType.Human));

  test("the galaxy pays, the throne does not; the offender's flags are spent; leftovers are burnt", () => {
    const tile = inland(east, 1);
    const silo = buildSilo(east, tile);
    const other = buildSilo(east, game.ref(game.x(tile), game.y(tile) + 8));
    fire(east, UnitType.AtomBomb);
    other.reloadMissile();
    fire(east, UnitType.AtomBomb);
    expect(other.punitiveFlag()).toBeDefined();

    // At the ceiling the throne regenerates nothing, so any troops it ends
    // with above it would be the levy's.
    const ceiling = game.config().maxTroops(hegemon);
    hegemon.setTroops(ceiling);
    const eastTroops = east.troops();
    const westTroops = west.troops();
    const pct = game.config().hegemonConfig().punitiveLevyPercentNuclear;
    punish(tile);

    const flight = game.strikesInFlight();
    expect(flight).toHaveLength(1);
    expect(flight[0].isPunitive()).toBe(true);
    expect(flight[0].targetPlayer()).toBe(east);
    // The levy is taken a tick after the order, so allow a tick's regeneration.
    const eastShare = Math.floor((eastTroops * pct) / 100);
    const westShare = Math.floor((westTroops * pct) / 100);
    expect(flight[0].troopCount()).toBeGreaterThanOrEqual(
      eastShare + westShare,
    );
    expect(flight[0].troopCount()).toBeLessThan((eastShare + westShare) * 1.02);
    expect(east.troops()).toBeLessThan(eastTroops - eastShare + 2_000);
    expect(west.troops()).toBeLessThan(westTroops - westShare + 2_000);
    expect(hegemon.troops()).toBe(ceiling);
    expect(silo.punitiveFlag()).toBeUndefined();
    expect(other.punitiveFlag()).toBeUndefined();

    runUntilLanded();
    expect(hegemon.outgoingAttacks()[0].isStrike()).toBe(true);
    runUntilOver();
    // Burnt: nothing came home.
    expect(hegemon.troops()).toBe(ceiling);
  });

  test("an Antimatter flag draws the larger levy", () => {
    const tile = inland(east, 1);
    buildSilo(east, tile);
    fire(east, UnitType.HydrogenBomb);
    const pct = game.config().hegemonConfig().punitiveLevyPercentAntimatter;
    const expected =
      Math.floor((east.troops() * pct) / 100) +
      Math.floor((west.troops() * pct) / 100);
    punish(tile);
    const troops = game.strikesInFlight()[0].troopCount();
    expect(troops).toBeGreaterThanOrEqual(expected);
    expect(troops).toBeLessThan(expected * 1.02);
  });

  test("it lands on the silo, razes only within punitiveRadius, halts, then pops: silo gone, land neutral", () => {
    const tile = inland(east, 1);
    const silo = buildSilo(east, tile);
    fire(east, UnitType.AtomBomb);
    const eastTiles = east.numTilesOwned();
    punish(tile);
    runUntilLanded();
    // Captured at the impact (the hand-over is PlayerExecution's).
    expect(game.owner(tile)).toBe(hegemon);
    executeTicks(game, 2);
    expect(silo.owner()).toBe(hegemon);
    expect(hegemon.units(UnitType.Stargate)).toHaveLength(1);
    // The throne never fires a captured gate: its own missiles fly from the
    // Dark Star's centre (H2, revised 2026-09-28).
    expect(hegemon.canBuild(UnitType.AtomBomb, inland(west, -1))).toBe(
      centre(),
    );

    const cfg = game.config().hegemonConfig();
    let bubblePeak = 0;
    let farthest = 0;
    const landedAt = game.ticks();
    let ticks = 0;
    while (landed() && ticks++ < 3000) {
      game.executeNextTick();
      bubblePeak = Math.max(bubblePeak, game.hegemonBubbleTiles());
      if (ticks % 5 !== 0) continue;
      for (const t of hegemon.tiles()) {
        if (game.isInDarkStar(t)) continue;
        farthest = Math.max(farthest, game.euclideanDistSquared(t, tile));
      }
    }
    expect(landed()).toBe(false);
    expect(farthest).toBeLessThanOrEqual(cfg.punitiveRadius ** 2);
    // With the stub combat (one troop a tile) the pocket fills, then the
    // strike waits out the halt before popping.
    expect(bubblePeak).toBeGreaterThan(100);
    expect(game.ticks() - landedAt).toBeGreaterThan(
      cfg.punitiveHaltSeconds * 10,
    );
    expect(game.hegemonBubbleTiles()).toBe(0);
    // PlayerExecution clears the silo off the unowned land.
    executeTicks(game, 3);
    expect(silo.isActive()).toBe(false);
    expect(east.units(UnitType.Stargate)).toHaveLength(0);
    expect(east.numTilesOwned()).toBeLessThan(eastTiles - 100);
    expect(east.numTilesOwned()).toBeGreaterThan(eastTiles - bubblePeak - 50);
    expect(game.owner(tile).isPlayer()).toBe(false);
  });

  test("the target retaking a bubble tile during the halt resumes the strike", () => {
    const tile = inland(east, 1);
    buildSilo(east, tile);
    fire(east, UnitType.AtomBomb);
    punish(tile);
    runUntilLanded();
    // Let it fill its radius and halt.
    let bubble = 0;
    let stable = 0;
    while (stable < 5 && landed()) {
      game.executeNextTick();
      const now = game.hegemonBubbleTiles();
      stable = now === bubble ? stable + 1 : 0;
      bubble = now;
    }
    expect(landed()).toBe(true);
    const haltTicks = game.config().hegemonConfig().punitiveHaltSeconds * 10;

    // Fight back: a few tiles retaken puts the strike back to work.
    east.setTroops(50_000);
    game.addExecution(new AttackExecution(2_000, east, hegemon.id()));
    executeTicks(game, 3);
    expect(east.outgoingAttacks()).toHaveLength(1);
    executeTicks(game, haltTicks);
    // Still alive well past one halt: the breach reset it.
    expect(landed()).toBe(true);
    runUntilOver();
    expect(game.hegemonBubbleTiles()).toBe(0);
  });

  test("it cannot be recalled, in flight or on the ground", () => {
    const tile = inland(east, 1);
    buildSilo(east, tile);
    fire(east, UnitType.AtomBomb);
    punish(tile);
    const flight = game.strikesInFlight()[0];
    hegemon.orderRetreat(flight.id());
    executeTicks(game, 1);
    expect(game.strikesInFlight()).toHaveLength(1);
    runUntilLanded();
    const attack = hegemon.outgoingAttacks()[0];
    hegemon.orderRetreat(attack.id());
    executeTicks(game, 5);
    expect(landed()).toBe(true);
    expect(attack.retreating()).toBe(false);
  });

  test("a tiny player is not erased: the strike halts at the tyranny floor and pops", () => {
    const small = game.addPlayer(
      new PlayerInfo("small", PlayerType.Human, "client9", "small"),
    );
    // Its whole land fits in the pocket.
    const g = game.darkStar()!;
    const x0 = g.cx + g.radius + g.moatWidth + 45;
    for (let dx = 0; dx < 12; dx++) {
      for (let dy = -6; dy < 6; dy++) {
        small.conquer(game.ref(x0 + dx, g.cy + dy));
      }
    }
    small.setTroops(10_000);
    const tile = game.ref(x0 + 6, g.cy);
    buildSilo(small, tile);
    fire(small, UnitType.AtomBomb);
    punish(tile);
    expect(game.strikesInFlight()).toHaveLength(1);
    runUntilLanded();
    runUntilOver();
    expect(small.isAlive()).toBe(true);
    expect(small.numTilesOwned()).toBeGreaterThan(0);
    expect(game.hegemonBubbleTiles()).toBe(0);
  });

  test("a gate that changes hands loses its flag: the captor is not the one who fired", () => {
    const tile = inland(east, 1);
    const silo = buildSilo(east, tile);
    fire(east, UnitType.AtomBomb);
    expect(silo.punitiveFlag()).toBeDefined();
    expect(RazeExecution.punitiveOption(game, tile)).not.toBeNull();

    // West takes the gate's tile; the hand-over is PlayerExecution's.
    west.conquer(tile);
    executeTicks(game, 2);
    expect(silo.owner()).toBe(west);
    expect(silo.punitiveFlag()).toBeUndefined();
    expect(RazeExecution.punitiveOption(game, tile)).toBeNull();

    // Nothing to answer: the throne's order on the captured gate fizzles.
    punish(tile);
    expect(game.strikesInFlight()).toHaveLength(0);
    expect(game.hegemonStrikeOn(west)).toBe(false);
    expect(game.hegemonStrikeOn(east)).toBe(false);
  });

  test("a strike in flight to a gate that changes hands is cancelled at once; the levy is not refunded", () => {
    const tile = inland(east, 1);
    const silo = buildSilo(east, tile);
    fire(east, UnitType.AtomBomb);
    const ceiling = game.config().maxTroops(hegemon);
    hegemon.setTroops(ceiling);
    punish(tile);
    expect(game.strikesInFlight()).toHaveLength(1);
    const eastAfterLevy = east.troops();
    const westAfterLevy = west.troops();

    west.conquer(tile);
    executeTicks(game, 1);
    expect(game.strikesInFlight()).toHaveLength(0);
    expect(game.hegemonStrikeOn(east)).toBe(false);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
    expect(hegemon.units(UnitType.Projectile)).toHaveLength(0);
    // Burnt, not returned: nobody is richer than a tick's regeneration.
    expect(hegemon.troops()).toBe(ceiling);
    expect(east.troops()).toBeLessThan(eastAfterLevy * 1.02);
    expect(west.troops()).toBeLessThan(westAfterLevy * 1.02);

    // The gate is the captor's, unflagged, and never captured by the throne.
    executeTicks(game, 2);
    expect(silo.isActive()).toBe(true);
    expect(silo.owner()).toBe(west);
    expect(silo.punitiveFlag()).toBeUndefined();
    expect(game.hegemonBubbleTiles()).toBe(0);
    // Another strike on east may follow: the cancelled one is not "alive".
    const second = buildSilo(east, game.ref(game.x(tile), game.y(tile) + 8));
    fire(east, UnitType.AtomBomb);
    expect(second.punitiveFlag()).toBeDefined();
    punish(second.tile());
    expect(game.strikesInFlight()).toHaveLength(1);
  });

  test("no flag, no strike; a challenger's order does nothing; the throne's order fires", () => {
    const tile = inland(east, 1);
    buildSilo(east, tile);
    punish(tile);
    expect(game.strikesInFlight()).toHaveLength(0);

    fire(east, UnitType.AtomBomb);
    const executor = new Executor(game, "game", undefined);
    game.addExecution(
      executor.createExec({
        type: "punitive_strike",
        tile,
        clientID: "client2", // west
      }),
    );
    executeTicks(game, 2);
    expect(game.strikesInFlight()).toHaveLength(0);
    game.addExecution(
      executor.createExec({
        type: "punitive_strike",
        tile,
        clientID: "client3", // the throne
      }),
    );
    executeTicks(game, 1);
    expect(game.strikesInFlight()).toHaveLength(1);
    expect(game.strikesInFlight()[0].isPunitive()).toBe(true);
  });
});

// Big Plains is 40k land tiles: east's block is ~4%, so the AI's bar is
// lowered to 3% to strike it, and west is shrunk beneath it.
class LowBar extends TestConfig {
  hegemonConfig() {
    return { ...super.hegemonConfig(), punitiveAIMinLandPermille: 30 };
  }
}

describe("The AI Hegemon answers launches (H19)", () => {
  test("it strikes a flagged silo, but not one of a player below the land bar", async () => {
    await start(PlayerType.Nation, LowBar);
    const tile = inland(east, 1);
    buildSilo(east, tile);
    fire(east, UnitType.AtomBomb);
    let ticks = 0;
    while (game.strikesInFlight().length === 0 && ticks++ < 30) {
      game.executeNextTick();
    }
    expect(game.strikesInFlight()).toHaveLength(1);
    expect(game.strikesInFlight()[0].isPunitive()).toBe(true);
    expect(game.strikesInFlight()[0].targetPlayer()).toBe(east);

    // West, shrunk to a sliver, fires with impunity.
    for (const t of Array.from(west.tiles())) {
      if (game.x(t) < game.x(inland(west, -1)) - 3) west.relinquish(t);
    }
    const bar =
      (game.numLandTiles() *
        game.config().hegemonConfig().punitiveAIMinLandPermille) /
      1000;
    expect(west.numTilesOwned()).toBeLessThan(bar);
    buildSilo(west, inland(west, -1));
    fire(west, UnitType.AtomBomb);
    executeTicks(game, 30);
    expect(game.hegemonStrikeOn(west)).toBe(false);
  });
});
