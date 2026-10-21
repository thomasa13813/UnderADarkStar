import { EmbracePiracyExecution } from "../src/core/execution/EmbracePiracyExecution";
import { Executor } from "../src/core/execution/ExecutionManager";
import { MarkDisconnectedExecution } from "../src/core/execution/MarkDisconnectedExecution";
import { MoveWarshipExecution } from "../src/core/execution/MoveWarshipExecution";
import { PirateLandingExecution } from "../src/core/execution/PirateLandingExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { TradeShipExecution } from "../src/core/execution/TradeShipExecution";
import { TransportShipExecution } from "../src/core/execution/TransportShipExecution";
import { WarshipExecution } from "../src/core/execution/WarshipExecution";
import {
  Game,
  GameMode,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";

import {
  DisplayMessageUpdate,
  GameUpdateType,
  PlayerUpdate,
} from "../src/core/game/GameUpdates";
import {
  ClientMessage,
  ClientMessageSchema,
  StampedIntent,
  Turn,
} from "../src/core/Schemas";
import {
  createGameWireContext,
  decodeClientMessage,
  encodeClientMessage,
} from "../src/core/ZbinWire";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

// Piracy (docs/DarkStar-Piracy.md, slice A): an eliminated challenger embraces
// piracy and spawns a corsair in deep space; it raids freighters into a hold
// and a purse, never fires on fleets, heals slowly anywhere, is sunk and
// respawns on a doubling cooldown away from where it sank, and is scuttled
// when its player leaves.

// half_land_half_ocean is 16×16: x < 8 is land, x >= 8 one body of water.
const WATER = (x: number, y: number) => ({ x, y });

let game: Game;
let north: Player;
let south: Player;
let pirate: Player;

function settle(player: Player, tiles: { x: number; y: number }[]) {
  for (const { x, y } of tiles) player.conquer(game.ref(x, y));
  player.setSpawnTile(game.ref(tiles[0].x, tiles[0].y));
  game.addExecution(new PlayerExecution(player));
}

// The engine's death: no tiles left, the player's execution purges them.
// The engine's death, then the wait it starts (PR10: 15 s before the first
// corsair). Tests of the wait itself use eliminateNow.
function eliminate(player: Player) {
  eliminateNow(player);
  while (game.ticks() < player.pirateRespawnAt()) game.executeNextTick();
}

function eliminateNow(player: Player) {
  for (const tile of Array.from(player.tiles())) player.relinquish(tile);
  executeTicks(game, 2);
  expect(player.isAlive()).toBe(false);
}

// The order is initialised at the end of the tick it is added in and acts
// on the next, so it is judged at game.ticks() + 1 as seen from here.
function embrace(player: Player, x: number, y: number): Unit | undefined {
  game.addExecution(new EmbracePiracyExecution(player, game.ref(x, y)));
  executeTicks(game, 2);
  return player.units(UnitType.Warship)[0];
}

function corsairOf(player: Player): Unit | undefined {
  return player.units(UnitType.Warship).find((u) => u.isActive());
}

function sink(ship: Unit, by: Player) {
  ship.modifyHealth(-ship.health(), by);
  expect(ship.isActive()).toBe(false);
}

function playerUpdateIn(
  updates: ReturnType<Game["executeNextTick"]>,
  player: Player,
): PlayerUpdate | undefined {
  return updates[GameUpdateType.Player].find(
    (u) => (u as PlayerUpdate).id === player.id(),
  ) as PlayerUpdate | undefined;
}

function displayEventsIn(
  updates: ReturnType<Game["executeNextTick"]>,
): DisplayMessageUpdate[] {
  return updates[GameUpdateType.DisplayEvent] as DisplayMessageUpdate[];
}

beforeEach(async () => {
  game = await setup(
    "half_land_half_ocean",
    { piracy: { enabled: true }, instantBuild: true },
    [
      new PlayerInfo("north", PlayerType.Human, "client1", "north"),
      new PlayerInfo("south", PlayerType.Human, "client2", "south"),
      new PlayerInfo("pirate", PlayerType.Human, "client3", "pirate"),
    ],
  );
  north = game.player("north");
  south = game.player("south");
  pirate = game.player("pirate");
  const n: { x: number; y: number }[] = [];
  const s: { x: number; y: number }[] = [];
  const p: { x: number; y: number }[] = [];
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 16; y++) {
      if (y < 6) n.push({ x, y });
      else if (y < 10) p.push({ x, y });
      else s.push({ x, y });
    }
  }
  settle(north, n);
  settle(south, s);
  settle(pirate, p);
  north.addGold(10_000_000n);
  south.addGold(10_000_000n);
  north.setTroops(100_000);
  south.setTroops(100_000);
  executeTicks(game, 5);
  game.config().structureMinDist = () => 5;
  // Every water tile here hugs a coast; without this every freighter would
  // be safe from pirates the whole way, as any shore-hugger is.
  game.config().safeFromPiratesCooldownMax = () => 0;
});

describe("Embracing piracy (PR1, PR3)", () => {
  test("a dead challenger spawns a corsair where it points, for nothing", () => {
    eliminate(pirate);
    expect(pirate.gold()).toBe(0n);
    expect(pirate.isPirate()).toBe(false);
    const ship = embrace(pirate, 12, 8);
    expect(ship).toBeDefined();
    expect(pirate.isPirate()).toBe(true);
    expect(ship!.tile()).toBe(game.ref(12, 8));
    expect(ship!.warshipState().patrolTile).toBe(game.ref(12, 8));
    expect(ship!.troops()).toBe(0);
    expect(pirate.gold()).toBe(0n);
    // Still dead by the engine's measure: the standings and the death
    // screen read isAlive(), and players() is alive-only.
    expect(pirate.isAlive()).toBe(false);
    expect(game.players()).not.toContain(pirate);
    expect(game.allPlayers()).toContain(pirate);
  });

  test("an alive player cannot", () => {
    expect(embrace(pirate, 12, 8)).toBeUndefined();
    expect(pirate.isPirate()).toBe(false);
  });

  test("an elimination starts the wait: no corsair for 15 s (PR10)", () => {
    const diedAt = game.ticks();
    eliminateNow(pirate);
    // The player's own execution stamps the wait on its death tick.
    expect(pirate.pirateRespawnAt()).toBeGreaterThanOrEqual(diedAt + 150);
    expect(pirate.pirateRespawnAt()).toBeLessThanOrEqual(diedAt + 152);
    expect(embrace(pirate, 12, 8)).toBeUndefined();
    expect(pirate.isPirate()).toBe(false);
    while (game.ticks() < pirate.pirateRespawnAt()) game.executeNextTick();
    expect(embrace(pirate, 12, 8)).toBeDefined();
  });

  test("only with the toggle on", async () => {
    game = await setup("half_land_half_ocean", {}, [
      new PlayerInfo("solo", PlayerType.Human, "client9", "solo"),
    ]);
    const solo = game.player("solo");
    settle(solo, [WATER(1, 1), WATER(1, 2)]);
    executeTicks(game, 2);
    eliminate(solo);
    expect(embrace(solo, 12, 8)).toBeUndefined();
    expect(solo.isPirate()).toBe(false);
  });

  test("a click on land is refused and leaves the player as they were", () => {
    eliminate(pirate);
    expect(embrace(pirate, 3, 8)).toBeUndefined();
    expect(pirate.isPirate()).toBe(false);
    expect(pirate.canBuild(UnitType.Warship, game.ref(3, 8))).toBe(false);
  });

  test("a Lord or a Baron never pirates", async () => {
    game = await setup("half_land_half_ocean", { piracy: { enabled: true } }, [
      new PlayerInfo("bot", PlayerType.Bot, null, "bot"),
    ]);
    const bot = game.player("bot");
    settle(bot, [WATER(1, 1), WATER(1, 2)]);
    executeTicks(game, 2);
    eliminate(bot);
    expect(embrace(bot, 12, 8)).toBeUndefined();
    expect(bot.isPirate()).toBe(false);
  });

  test("one corsair at a time", () => {
    eliminate(pirate);
    const first = embrace(pirate, 12, 8)!;
    embrace(pirate, 12, 12);
    expect(pirate.units(UnitType.Warship)).toHaveLength(1);
    expect(corsairOf(pirate)).toBe(first);
  });

  test("the intent comes off the wire and through the executor", () => {
    eliminate(pirate);
    const executor = new Executor(game, "game", undefined);
    const intent: StampedIntent = {
      type: "embrace_piracy",
      tile: game.ref(12, 8),
      clientID: "client3",
    };
    const turn: Turn = { turnNumber: 1, intents: [intent] };
    const msg: ClientMessage = {
      type: "intent",
      intent: { type: "embrace_piracy", tile: game.ref(12, 8) },
    };
    const ctx = createGameWireContext([{ clientID: "client3" }]);
    const decoded = decodeClientMessage(encodeClientMessage(msg, ctx), ctx);
    expect(decoded).toEqual(msg);
    expect(ClientMessageSchema.safeParse(msg).success).toBe(true);
    for (const exec of executor.createExecs(turn)) game.addExecution(exec);
    executeTicks(game, 2);
    expect(pirate.isPirate()).toBe(true);
    expect(corsairOf(pirate)).toBeDefined();
  });

  test("the player update carries the state", () => {
    eliminate(pirate);
    game.executeNextTick();
    // Nothing about the pirate changed this tick: no update, or one without
    // the flag (a diff carries only what changed).
    expect(
      playerUpdateIn(game.executeNextTick(), pirate)?.isPirate ?? false,
    ).toBe(false);
    game.addExecution(new EmbracePiracyExecution(pirate, game.ref(12, 8)));
    game.executeNextTick();
    const pu = playerUpdateIn(game.executeNextTick(), pirate);
    expect(pu?.isPirate).toBe(true);
    expect(pirate.isAlive()).toBe(false);
  });
});

describe("The corsair (PR2, PR4, PR11)", () => {
  let ship: Unit;

  beforeEach(() => {
    eliminate(pirate);
    ship = embrace(pirate, 12, 8)!;
  });

  test("takes a move order like any warship", () => {
    game.addExecution(
      new MoveWarshipExecution(pirate, [ship.id()], game.ref(13, 2)),
    );
    executeTicks(game, 1);
    expect(ship.warshipState().patrolTile).toBe(game.ref(13, 2));
  });

  test("heals one health every three ticks, anywhere, and never docks", () => {
    ship.modifyHealth(-300, north);
    expect(ship.isActive()).toBe(true);
    const start = ship.health();
    executeTicks(game, 30);
    expect(ship.health()).toBe(start + 10);
    expect(ship.warshipState().state).toBe("patrolling");
    expect(ship.warshipState().retreatPort).toBeUndefined();
  });

  test("gains no veterancy", () => {
    ship.recordTradeCapture();
    ship.recordKill(UnitType.Warship);
    expect(ship.veterancy()).toBe(0);
  });
});

describe("Raids (PR5, PR15, PR16)", () => {
  let ship: Unit;
  let src: Unit;
  let dst: Unit;

  beforeEach(() => {
    eliminate(pirate);
    src = north.buildUnit(UnitType.Port, game.ref(7, 2), {});
    dst = south.buildUnit(UnitType.Port, game.ref(7, 13), {});
    ship = embrace(pirate, 9, 8)!;
    game.config().warshipTargettingRange = () => 6;
  });

  // Sail one freighter north → south; true when the corsair scuttled it.
  function raid(): boolean {
    game.addExecution(new TradeShipExecution(north, src, dst));
    let seen = false;
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
      const freighter = game.units(UnitType.TradeShip)[0];
      if (freighter === undefined) {
        if (seen) break;
        continue;
      }
      seen = true;
      // Never captured and sailed off: scuttled where it stood or delivered.
      expect(freighter.owner()).not.toBe(pirate);
    }
    return pirate.pirateRaids() > 0;
  }

  // The levers are in engine units: 1,000 and 25,000 read 100 and 2,500 on
  // screen (renderTroops shows a tenth).
  test("a freighter is scuttled: 100 troops (on screen) to the hold, 10k to the purse, nothing to the traders", () => {
    const raids = pirate.pirateRaids();
    expect(raid()).toBe(true);
    expect(pirate.pirateRaids()).toBe(raids + 1);
    expect(game.units(UnitType.TradeShip)).toHaveLength(0);
    expect(ship.troops()).toBe(1_000);
    expect(pirate.gold()).toBe(10_000n);
    expect(pirate.piracyGold()).toBe(10_000n);
    // The cargo is lost to both ends (workers still pay their tick).
    expect(north.tradeGold()).toBe(0n);
    expect(south.tradeGold()).toBe(0n);
    expect(ship.veterancy()).toBe(0);
  });

  test("the hold stops at 2,500 (on screen); the purse does not", () => {
    ship.setTroops(24_500);
    expect(raid()).toBe(true);
    expect(ship.troops()).toBe(25_000);
    expect(raid()).toBe(true);
    expect(ship.troops()).toBe(25_000);
    expect(pirate.gold()).toBe(20_000n);
  });

  test("a freighter on its land leg, or hugging a shore, is out of reach", () => {
    // Inland ports: the freighter crawls overland first; the corsair sits
    // beside the coast in range of the land leg.
    const inSrc = north.buildUnit(UnitType.Port, game.ref(2, 2), {});
    const inDst = south.buildUnit(UnitType.Port, game.ref(2, 13), {});
    game.addExecution(
      new MoveWarshipExecution(pirate, [ship.id()], game.ref(8, 3)),
    );
    game.config().safeFromPiratesCooldownMax = () => 20;
    game.addExecution(new TradeShipExecution(north, inSrc, inDst));
    let landTicks = 0;
    let shoreTicks = 0;
    for (let i = 0; i < 300; i++) {
      game.executeNextTick();
      const freighter = game.units(UnitType.TradeShip)[0];
      if (freighter === undefined) continue;
      if (game.isLand(freighter.tile())) {
        landTicks++;
        expect(ship.targetUnit()).not.toBe(freighter);
      } else if (freighter.isSafeFromPirates()) {
        shoreTicks++;
        expect(ship.targetUnit()).not.toBe(freighter);
      }
    }
    expect(landTicks).toBeGreaterThan(5);
    expect(shoreTicks).toBeGreaterThan(5);
    expect(pirate.pirateRaids()).toBe(0);
  });

  test("the victim is told pirates did it, not who; the pirate is told the take", () => {
    game.addExecution(new TradeShipExecution(north, src, dst));
    let victimEvent: DisplayMessageUpdate | undefined;
    let pirateEvent: DisplayMessageUpdate | undefined;
    for (let i = 0; i < 200 && victimEvent === undefined; i++) {
      const updates = game.executeNextTick();
      for (const e of displayEventsIn(updates)) {
        if (e.message === "events_display.freighter_raided") victimEvent = e;
        if (e.message === "events_display.pirate_raid") pirateEvent = e;
      }
    }
    expect(victimEvent).toBeDefined();
    expect(victimEvent!.playerID).toBe(north.smallID());
    // Anonymity (PR15): no name rides the victim's event.
    expect(victimEvent!.params).toBeUndefined();
    expect(pirateEvent).toBeDefined();
    expect(pirateEvent!.playerID).toBe(pirate.smallID());
    expect(pirateEvent!.params?.name).toBe(north.displayName());
    expect(pirateEvent!.goldAmount).toBe(10_000n);
  });
});

describe("No fleet sinking (PR6)", () => {
  test("a fleet in range is left alone; a warship is answered", () => {
    eliminate(pirate);
    const ship = embrace(pirate, 10, 8)!;
    game.config().warshipTargettingRange = () => 30;
    // A fleet from the north to the nebula the pirate left behind (neutral:
    // the south is under 100 tiles and would be mopped up at first touch)
    // passes right by the corsair.
    game.addExecution(new TransportShipExecution(north, game.ref(5, 8), 1_000));
    executeTicks(game, 3);
    const fleet = game.units(UnitType.TransportShip)[0];
    expect(fleet).toBeDefined();
    let fleetTicksInRange = 0;
    for (let i = 0; i < 60 && fleet.isActive(); i++) {
      game.executeNextTick();
      expect(ship.targetUnit()).not.toBe(fleet);
      if (game.manhattanDist(ship.tile(), fleet.tile()) <= 10) {
        fleetTicksInRange++;
      }
    }
    expect(fleetTicksInRange).toBeGreaterThan(0);
    expect(fleet.isActive()).toBe(false);
    expect(fleet.wasDestroyedByEnemy()).toBe(false);
    expect(south.units(UnitType.Warship)).toHaveLength(0);
    // A destroyer of the south's, in range, is fired on (a shell flies and
    // lands within the tick at this range, so the hit is what shows).
    south.buildUnit(UnitType.Port, game.ref(7, 13), {});
    const enemy = south.buildUnit(UnitType.Warship, game.ref(9, 12), {
      patrolTile: game.ref(9, 12),
    });
    game.addExecution(new WarshipExecution(enemy));
    let hit = false;
    for (let i = 0; i < 40 && !hit; i++) {
      game.executeNextTick();
      hit = enemy.health() < enemy.maxHealth();
    }
    expect(hit).toBe(true);
    expect(ship.targetUnit()).toBe(enemy);
  });
});

describe("Sinking and return (PR10)", () => {
  // Refused until the tick the cooldown names, taken from it. An embrace
  // order is judged one tick after it is given (see embrace()).
  function expectRefusedThenAllowed(x = 12, y = 8): Unit {
    const at = pirate.pirateRespawnAt();
    expect(embrace(pirate, x, y)).toBeUndefined();
    while (game.ticks() < at - 3) game.executeNextTick();
    expect(embrace(pirate, x, y)).toBeUndefined(); // judged at `at` − 2
    const ship = embrace(pirate, x, y); // judged at `at`
    expect(ship).toBeDefined();
    return ship!;
  }

  test("the hold goes down with the ship; the purse stays", () => {
    eliminate(pirate);
    const ship = embrace(pirate, 12, 8)!;
    ship.setTroops(1_200);
    pirate.addGold(30_000n);
    const sunkAt = game.ticks();
    sink(ship, north);
    expect(pirate.isPirate()).toBe(true);
    expect(pirate.gold()).toBe(30_000n);
    expect(pirate.pirateSinkings()).toBe(1);
    expect(pirate.pirateRespawnAt()).toBe(sunkAt + 150);
    const next = expectRefusedThenAllowed();
    expect(next.troops()).toBe(0);
    expect(pirate.gold()).toBe(30_000n);
  });

  test("the cooldown doubles with each sinking and caps at two minutes", () => {
    eliminate(pirate);
    let ship = embrace(pirate, 12, 8)!;
    const waits = [150, 300, 600, 1200, 1200];
    for (const wait of waits) {
      const sunkAt = game.ticks();
      sink(ship, north);
      expect(pirate.pirateRespawnAt()).toBe(sunkAt + wait);
      ship = expectRefusedThenAllowed();
    }
    expect(pirate.pirateSinkings()).toBe(waits.length);
  });

  test("the next corsair may launch where the last one sank", () => {
    const cfg = game.config().piracyConfig();
    game.config().piracyConfig = () => ({ ...cfg, respawnSeconds: 1 });
    eliminate(pirate);
    const ship = embrace(pirate, 12, 8)!;
    sink(ship, north);
    executeTicks(game, 10);
    expect(pirate.canBuild(UnitType.Warship, game.ref(12, 8))).toBe(
      game.ref(12, 8),
    );
    const next = embrace(pirate, 12, 8)!;
    expect(next).toBeDefined();
    expect(next.tile()).toBe(game.ref(12, 8));
  });

  test("the sinking count persists across a scuttle", () => {
    eliminate(pirate);
    const ship = embrace(pirate, 12, 8)!;
    sink(ship, north);
    expect(pirate.pirateSinkings()).toBe(1);
    game.addExecution(new MarkDisconnectedExecution(pirate, true));
    executeTicks(game, 1);
    game.addExecution(new MarkDisconnectedExecution(pirate, false));
    executeTicks(game, 1);
    expect(pirate.pirateSinkings()).toBe(1);
  });
});

describe("A pirate who leaves (PR18)", () => {
  test("the disconnect mark scuttles the corsair and starts no cooldown", () => {
    eliminate(pirate);
    const ship = embrace(pirate, 12, 8)!;
    ship.setTroops(500);
    // The elimination's wait has run; the scuttle starts no new one.
    const waitBefore = pirate.pirateRespawnAt();
    expect(waitBefore).toBeLessThanOrEqual(game.ticks());
    game.addExecution(new MarkDisconnectedExecution(pirate, true));
    executeTicks(game, 1);
    expect(ship.isActive()).toBe(false);
    expect(pirate.isDisconnected()).toBe(true);
    expect(pirate.isPirate()).toBe(false);
    expect(pirate.pirateSinkings()).toBe(0);
    expect(pirate.pirateRespawnAt()).toBe(waitBefore);
    // Back: embraced again from the death screen, at once.
    game.addExecution(new MarkDisconnectedExecution(pirate, false));
    executeTicks(game, 1);
    const next = embrace(pirate, 12, 8);
    expect(next).toBeDefined();
    expect(pirate.isPirate()).toBe(true);
  });
});

describe("The Dark Star (PR3, PR5)", () => {
  // The smallest Dark Star the engine allows, carved into the map's centre:
  // the disc (radius 4) at (8, 8) with a one-tile moat, leaving open water
  // in the east and in the corners.
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
    executeTicks(game, 5);
    eliminate(pirate);
  });

  test("the corsair spawns outside the disc and the moat, never in them", () => {
    const g = game.darkStar()!;
    expect(game.isInDarkStar(game.ref(g.cx, g.cy))).toBe(true);
    const moatX = g.cx + g.radius + 1;
    expect(game.isInMoat(game.ref(moatX, g.cy))).toBe(true);
    expect(game.isWater(game.ref(15, 15))).toBe(true);
    expect(embrace(pirate, g.cx, g.cy)).toBeUndefined();
    expect(embrace(pirate, moatX, g.cy)).toBeUndefined();
    expect(pirate.isPirate()).toBe(false);
    const ship = embrace(pirate, 15, 15);
    expect(ship).toBeDefined();
    expect(ship!.tile()).toBe(game.ref(15, 15));
    expect(game.isInMoat(ship!.tile())).toBe(false);
  });

  test("the Hegemon never embraces piracy", () => {
    const hegemon = game.hegemon()!;
    for (const tile of Array.from(hegemon.tiles())) hegemon.relinquish(tile);
    executeTicks(game, 1);
    expect(hegemon.isAlive()).toBe(false);
    expect(embrace(hegemon, 15, 15)).toBeUndefined();
    expect(hegemon.isPirate()).toBe(false);
  });
});

describe("What stays shut to a pirate", () => {
  test("a pirate builds nothing but the corsair", () => {
    eliminate(pirate);
    embrace(pirate, 12, 8);
    pirate.addGold(100_000_000n);
    for (const u of [
      UnitType.Port,
      UnitType.City,
      UnitType.Stargate,
      UnitType.AtomBomb,
    ]) {
      expect(pirate.canBuild(u, game.ref(3, 8))).toBe(false);
    }
    expect(pirate.canSendAllianceRequest(north)).toBe(false);
    expect(pirate.canDonateGold(north)).toBe(false);
    expect(pirate.canDonateTroops(north)).toBe(false);
    expect(pirate.canAttack(game.ref(3, 8))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Slice B: the landing (PR4, PR7–PR9, PR12) and the return.

// The landing order is judged in init (the same tick it is added), then the
// corsair sails a tile a tick.
function orderLanding(player: Player, x: number, y: number) {
  game.addExecution(new PirateLandingExecution(player, game.ref(x, y)));
  executeTicks(game, 1);
}

// True once beached, false once the landing was cancelled or time ran out.
function sailUntilLanded(player: Player, maxTicks = 100): boolean {
  for (let i = 0; i < maxTicks; i++) {
    if (!player.isPirate()) return true;
    if (player.pirateLanding() === undefined) return false;
    game.executeNextTick();
  }
  return !player.isPirate();
}

// The 16×16 map has 128 land tiles; the claim is a lever (§5), 20 here.
function smallClaims(n = 20) {
  const cfg = game.config().piracyConfig();
  game.config().piracyConfig = () => ({ ...cfg, landingTiles: n });
}

function settleHalves(withSouth: boolean) {
  const n: { x: number; y: number }[] = [];
  const s: { x: number; y: number }[] = [];
  const p: { x: number; y: number }[] = [];
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 16; y++) {
      if (y < 6) n.push({ x, y });
      else if (y < 10 || !withSouth) p.push({ x, y });
      else s.push({ x, y });
    }
  }
  settle(north, n);
  if (withSouth) settle(south, s);
  settle(pirate, p);
  executeTicks(game, 5);
}

describe("The landing (PR7, PR8)", () => {
  let ship: Unit;

  beforeEach(() => {
    smallClaims();
    eliminate(pirate);
    // The pirate's old nebula (x < 8, 6 <= y < 10) is neutral now: 32 tiles.
    ship = embrace(pirate, 10, 8)!;
    ship.setTroops(600);
  });

  test("on neutral nebula: the claim, the hold's attack, the return", () => {
    expect(pirate.numTilesOwned()).toBe(0);
    orderLanding(pirate, 3, 8);
    expect(pirate.pirateLanding()).toBe(game.ref(7, 8));
    expect(ship.targetTile()).toBe(game.ref(7, 8));
    // Sailing: the corsair heads for the shore and its own execution stands
    // down (no patrol wander).
    const startDist = game.manhattanDist(ship.tile(), game.ref(7, 8));
    game.executeNextTick();
    expect(game.manhattanDist(ship.tile(), game.ref(7, 8))).toBeLessThan(
      startDist,
    );
    expect(sailUntilLanded(pirate)).toBe(true);
    // Beached: the ship is gone, the claim is exactly the lever, all of it
    // the neutral coast, and the player is a challenger again.
    expect(ship.isActive()).toBe(false);
    expect(pirate.units(UnitType.Warship)).toHaveLength(0);
    expect(pirate.numTilesOwned()).toBe(20);
    expect(pirate.isAlive()).toBe(true);
    expect(pirate.isPirate()).toBe(false);
    expect(pirate.pirateLanding()).toBeUndefined();
    expect(pirate.pirateLandings()).toBe(1);
    expect(game.owner(game.ref(7, 8))).toBe(pirate);
    for (const t of pirate.tiles()) {
      expect(game.y(t)).toBeGreaterThanOrEqual(6);
      expect(game.y(t)).toBeLessThan(10);
    }
    // The hold lands as an ordinary attack on the neutral nebula around the
    // claim: more tiles follow.
    const attacks = pirate.outgoingAttacks();
    expect(attacks).toHaveLength(1);
    expect(attacks[0].troops()).toBeLessThanOrEqual(600);
    expect(attacks[0].target().isPlayer()).toBe(false);
    executeTicks(game, 20);
    expect(pirate.numTilesOwned()).toBeGreaterThan(20);
    // Alive again, among the living.
    expect(game.players()).toContain(pirate);
  });

  test("on a coast with a structure: the structure's tile is clipped out", () => {
    // The north's coast, with a city two tiles in from the shore.
    const city = north.buildUnit(UnitType.City, game.ref(6, 3), {});
    const northTiles = north.numTilesOwned();
    orderLanding(pirate, 5, 3);
    const shore = pirate.pirateLanding()!;
    expect(game.owner(shore)).toBe(north);
    expect(sailUntilLanded(pirate)).toBe(true);
    expect(pirate.numTilesOwned()).toBe(20);
    expect(game.owner(city.tile())).toBe(north);
    expect(city.owner()).toBe(north);
    expect(city.isActive()).toBe(true);
    // The bite came out of the north, not out of neutral nebula elsewhere.
    expect(north.numTilesOwned()).toBeLessThan(northTiles);
    // The bite is the north's shore and the neutral nebula behind it.
    for (const t of pirate.tiles()) expect(game.y(t)).toBeLessThan(10);
    // The hold attacks the coast's owner.
    const attacks = pirate.outgoingAttacks();
    expect(attacks).toHaveLength(1);
    expect(attacks[0].target()).toBe(north);
    expect(north.incomingAttacks()).toHaveLength(1);
  });

  test("an empty hold may still land: the claim without the push", () => {
    ship.setTroops(0);
    orderLanding(pirate, 3, 8);
    expect(sailUntilLanded(pirate)).toBe(true);
    expect(pirate.numTilesOwned()).toBe(20);
    expect(pirate.outgoingAttacks()).toHaveLength(0);
    // One PlayerExecution, not two: a tick's growth is one tick's rate.
    game.executeNextTick();
    const before = pirate.troops();
    const rate = game.config().troopIncreaseRate(pirate);
    game.executeNextTick();
    // addTroops floors; two executions would give about twice the rate.
    expect(Math.abs(pirate.troops() - before - rate)).toBeLessThan(1);
  });

  test("a shore with a structure is passed over for the next one", () => {
    // A port on the north's whole coast column but one tile.
    game.config().structureMinDist = () => 1;
    for (let y = 0; y < 6; y++) {
      if (y === 4) continue;
      north.buildUnit(UnitType.Port, game.ref(7, y), {});
    }
    orderLanding(pirate, 5, 1);
    expect(pirate.pirateLanding()).toBe(game.ref(7, 4));
  });

  test("the landing rides the player update", () => {
    game.addExecution(new PirateLandingExecution(pirate, game.ref(3, 8)));
    const pu = playerUpdateIn(game.executeNextTick(), pirate);
    expect(pu?.pirateLanding).toBe(game.ref(7, 8));
  });

  test("the intent comes off the wire and through the executor", () => {
    const executor = new Executor(game, "game", undefined);
    const msg: ClientMessage = {
      type: "intent",
      intent: { type: "pirate_land", tile: game.ref(3, 8) },
    };
    const ctx = createGameWireContext([{ clientID: "client3" }]);
    expect(decodeClientMessage(encodeClientMessage(msg, ctx), ctx)).toEqual(
      msg,
    );
    game.addExecution(
      executor.createExec({
        type: "pirate_land",
        tile: game.ref(3, 8),
        clientID: "client3",
      }),
    );
    executeTicks(game, 1);
    expect(pirate.pirateLanding()).toBe(game.ref(7, 8));
  });
});

describe("Landings refused (PR8, PR9, PR12)", () => {
  function refusalEvent(x: number, y: number): string | undefined {
    game.addExecution(new PirateLandingExecution(pirate, game.ref(x, y)));
    const events = displayEventsIn(game.executeNextTick()).filter(
      (e) =>
        e.playerID === pirate.smallID() &&
        e.message.startsWith("events_display.pirate_landing_"),
    );
    return events[0]?.message;
  }

  beforeEach(() => {
    eliminate(pirate);
    embrace(pirate, 10, 8);
  });

  test("a rock too small to live on (the full 100-tile claim)", () => {
    // 32 neutral tiles, 48 + 32 with the north's: never 100 on this map.
    expect(refusalEvent(3, 8)).toBe("events_display.pirate_landing_too_small");
    expect(refusalEvent(3, 3)).toBe("events_display.pirate_landing_too_small");
    expect(pirate.pirateLanding()).toBeUndefined();
    expect(pirate.isPirate()).toBe(true);
  });

  test("a coast under spawn immunity, but not neutral nebula beside it", () => {
    smallClaims();
    (game.config() as TestConfig).setSpawnImmunityDuration(100_000);
    expect(north.isImmune()).toBe(true);
    expect(refusalEvent(3, 3)).toBe("events_display.pirate_landing_forbidden");
    expect(refusalEvent(3, 8)).toBeUndefined();
    expect(pirate.pirateLanding()).toBe(game.ref(7, 8));
  });

  test("a click on deep space is not a landing", () => {
    smallClaims();
    expect(refusalEvent(12, 12)).toBeUndefined();
    expect(pirate.pirateLanding()).toBeUndefined();
  });

  test("the last minute of the round", async () => {
    game = await setup(
      "half_land_half_ocean",
      { piracy: { enabled: true }, maxTimerValue: 2 },
      [
        new PlayerInfo("north", PlayerType.Human, "client1", "north"),
        new PlayerInfo("pirate", PlayerType.Human, "client3", "pirate"),
      ],
    );
    north = game.player("north");
    pirate = game.player("pirate");
    settleHalves(false);
    smallClaims();
    eliminate(pirate);
    embrace(pirate, 14, 8);
    expect(game.config().roundSeconds()).toBe(120);
    // Open until 60 s before the end, closed from then on. The order goes
    // in on the last open tick (judged at 59.9 s): at the corsair's pace,
    // two tiles a tick, an earlier order would beach before the minute
    // turns.
    while (game.elapsedGameSeconds() < 59.8) game.executeNextTick();
    expect(refusalEvent(3, 12)).toBeUndefined();
    expect(pirate.pirateLanding()).toBeDefined();
    while (game.elapsedGameSeconds() < 60) game.executeNextTick();
    // The voyage cannot carry a landing past the close.
    expect(sailUntilLanded(pirate)).toBe(false);
    expect(pirate.isPirate()).toBe(true);
    expect(refusalEvent(3, 12)).toBe("events_display.pirate_landing_closed");
  });

  test("a teammate's coast (team throne, L8)", async () => {
    game = await setup(
      "half_land_half_ocean",
      { piracy: { enabled: true }, gameMode: GameMode.Team, playerTeams: 2 },
      [
        new PlayerInfo("north", PlayerType.Human, "client1", "north"),
        new PlayerInfo("south", PlayerType.Human, "client2", "south"),
        new PlayerInfo("pirate", PlayerType.Human, "client3", "pirate"),
      ],
    );
    north = game.player("north");
    south = game.player("south");
    pirate = game.player("pirate");
    settleHalves(true);
    smallClaims();
    eliminate(pirate);
    embrace(pirate, 10, 8);
    const mate = [north, south].find((q) => q.isOnSameTeam(pirate));
    const foe = [north, south].find((q) => !q.isOnSameTeam(pirate));
    expect(mate).toBeDefined();
    expect(foe).toBeDefined();
    const coastOf = (q: Player) => (q === north ? 3 : 13);
    expect(refusalEvent(3, coastOf(mate!))).toBe(
      "events_display.pirate_landing_forbidden",
    );
    expect(refusalEvent(3, coastOf(foe!))).toBeUndefined();
    expect(pirate.pirateLanding()).toBeDefined();
  });
});

describe("Landings and the Dark Star (PR9)", () => {
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
    executeTicks(game, 5);
    smallClaims(5);
    eliminate(pirate);
    embrace(pirate, 15, 15);
  });

  function refused(x: number, y: number): boolean {
    game.addExecution(new PirateLandingExecution(pirate, game.ref(x, y)));
    game.executeNextTick();
    const refused = pirate.pirateLanding() === undefined;
    pirate.setPirateLanding(undefined);
    return refused;
  }

  test("never on the domain, never on the Hegemon's land beyond the moat", () => {
    const g = game.darkStar()!;
    expect(refused(g.cx, g.cy)).toBe(true);
    // A bubble: Hegemon land outside the moat (as a strike leaves it).
    const hegemon = game.hegemon()!;
    const bubble = game.ref(1, 14);
    expect(game.isLand(bubble)).toBe(true);
    hegemon.conquer(bubble);
    expect(refused(1, 14)).toBe(true);
    // Neutral nebula beside it is fine.
    expect(refused(0, 15)).toBe(false);
  });
});

describe("Cancelling and superseding a landing (PR4)", () => {
  let ship: Unit;

  beforeEach(() => {
    smallClaims();
    eliminate(pirate);
    ship = embrace(pirate, 14, 14)!;
  });

  test("a click on deep space cancels the landing; the corsair patrols there", () => {
    orderLanding(pirate, 3, 8);
    expect(pirate.pirateLanding()).toBeDefined();
    executeTicks(game, 2);
    game.addExecution(
      new MoveWarshipExecution(pirate, [ship.id()], game.ref(12, 2)),
    );
    executeTicks(game, 2);
    expect(pirate.pirateLanding()).toBeUndefined();
    expect(ship.isActive()).toBe(true);
    expect(ship.warshipState().patrolTile).toBe(game.ref(12, 2));
    executeTicks(game, 60);
    expect(pirate.isPirate()).toBe(true);
    expect(pirate.numTilesOwned()).toBe(0);
  });

  test("a later landing order replaces the earlier one", () => {
    orderLanding(pirate, 3, 8);
    expect(pirate.pirateLanding()).toBe(game.ref(7, 8));
    orderLanding(pirate, 3, 13);
    expect(pirate.pirateLanding()).toBe(game.ref(7, 13));
    expect(sailUntilLanded(pirate)).toBe(true);
    expect(game.owner(game.ref(7, 13))).toBe(pirate);
    expect(pirate.pirateLandings()).toBe(1);
  });

  test("a sunk corsair takes its landing order down with it", () => {
    orderLanding(pirate, 3, 8);
    sink(ship, north);
    executeTicks(game, 2);
    expect(pirate.pirateLanding()).toBeUndefined();
    expect(pirate.isPirate()).toBe(true);
    expect(pirate.numTilesOwned()).toBe(0);
  });
});

describe("Dying again", () => {
  test("a returned pirate who falls again may embrace again, on the same count", () => {
    const cfg = game.config().piracyConfig();
    game.config().piracyConfig = () => ({
      ...cfg,
      landingTiles: 20,
    });
    eliminate(pirate);
    let ship = embrace(pirate, 10, 8)!;
    sink(ship, north);
    expect(pirate.pirateSinkings()).toBe(1);
    executeTicks(game, 201);
    ship = embrace(pirate, 10, 8)!;
    expect(ship).toBeDefined();
    orderLanding(pirate, 3, 8);
    expect(sailUntilLanded(pirate)).toBe(true);
    expect(pirate.isAlive()).toBe(true);
    // Falls again: the engine's death, as the first time, and the wait
    // with it (PR10: every phase transition).
    const fellAt = game.ticks();
    eliminateNow(pirate);
    expect(pirate.isPirate()).toBe(false);
    expect(pirate.gold()).toBe(0n);
    expect(pirate.pirateRespawnAt()).toBeGreaterThanOrEqual(fellAt + 150);
    expect(embrace(pirate, 10, 8)).toBeUndefined();
    while (game.ticks() < pirate.pirateRespawnAt()) game.executeNextTick();
    ship = embrace(pirate, 10, 8)!;
    expect(ship).toBeDefined();
    expect(pirate.isPirate()).toBe(true);
    expect(pirate.pirateSinkings()).toBe(1);
    expect(pirate.pirateLandings()).toBe(1);
  });
});

describe("The full-size claim on the world map", () => {
  test("a landing claims exactly 100 tiles, none with a structure", async () => {
    game = await setup("world", { piracy: { enabled: true } }, [
      new PlayerInfo("north", PlayerType.Human, "client1", "north"),
      new PlayerInfo("pirate", PlayerType.Human, "client3", "pirate"),
    ]);
    north = game.player("north");
    pirate = game.player("pirate");
    // Far from the landing: the north at (1200, 100) on solid plains.
    const n: { x: number; y: number }[] = [];
    for (let x = 1200; x < 1210; x++) {
      for (let y = 100; y < 110; y++) n.push({ x, y });
    }
    settle(north, n);
    const shoreX = 1025;
    const shoreY = 248;
    settle(pirate, [{ x: shoreX, y: shoreY }]);
    executeTicks(game, 3);
    eliminate(pirate);
    const ship = embrace(pirate, shoreX, shoreY + 1)!;
    expect(ship).toBeDefined();
    ship.setTroops(25_000);
    orderLanding(pirate, shoreX, shoreY);
    expect(pirate.pirateLanding()).toBeDefined();
    expect(sailUntilLanded(pirate, 60)).toBe(true);
    expect(pirate.numTilesOwned()).toBe(100);
    expect(pirate.isAlive()).toBe(true);
    // A Lord aiming a stargate reads the returned player's cluster box in
    // the landing tick, before PlayerExecution has set it: null, never
    // undefined (Tom's crash, 2026-10-15).
    expect(pirate.largestClusterBoundingBox).not.toBeUndefined();
    for (const t of pirate.tiles()) {
      expect(game.isLand(t)).toBe(true);
      expect(game.isImpassable(t)).toBe(false);
    }
    expect(pirate.outgoingAttacks()).toHaveLength(1);
    expect(pirate.outgoingAttacks()[0].troops()).toBeLessThanOrEqual(25_000);
  });
});

describe("The same landing order twice", () => {
  test("does not sail the corsair twice as fast", () => {
    smallClaims();
    eliminate(pirate);
    const ship = embrace(pirate, 14, 8)!;
    orderLanding(pirate, 3, 8);
    orderLanding(pirate, 3, 8);
    const from = ship.tile();
    game.executeNextTick();
    // The corsair's pace is two tiles a tick; two executions would be four.
    expect(game.manhattanDist(from, ship.tile())).toBeLessThanOrEqual(2);
    expect(sailUntilLanded(pirate)).toBe(true);
    expect(pirate.pirateLandings()).toBe(1);
  });
});
