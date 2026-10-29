import { EmbracePiracyExecution } from "../src/core/execution/EmbracePiracyExecution";
import { Executor } from "../src/core/execution/ExecutionManager";
import { DROP_IN_PIRATE_DELAY_TICKS } from "../src/core/execution/JoinRoundExecution";
import { PirateLandingExecution } from "../src/core/execution/PirateLandingExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import {
  Game,
  GameMode,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import {
  ServerMessage,
  StampedIntent,
  StampedIntentSchema,
  Turn,
} from "../src/core/Schemas";
import {
  createGameWireContext,
  decodeServerMessage,
  encodeServerMessage,
} from "../src/core/ZbinWire";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// Under a Dark Star (docs/DarkStar-Lobbies.md L36, L37, L42, §14.4): a player
// arrives in a room's round after it started. The server issues a join_round
// into the turn stream; every client creates the same player on the same
// tick. In the spawn phase the newcomer spawns as usual; after it they are a
// pirate from 30 s into play, as is anyone who never spawned. A team game
// puts them on its smallest team; a clientID that already has a player keeps
// it.

// half_land_half_ocean is 16×16: x < 8 is land, x >= 8 one body of water.

function join(clientID: string, username = "Newcomer"): StampedIntent {
  return { type: "join_round", clientID, username, clanTag: null };
}

function run(game: Game, ...intents: StampedIntent[]) {
  const executor = new Executor(game, "game", undefined);
  const turn: Turn = { turnNumber: game.ticks(), intents };
  for (const exec of executor.createExecs(turn)) game.addExecution(exec);
  executeTicks(game, 2);
}

function settle(game: Game, player: Player, x0: number, x1: number) {
  for (let x = x0; x < x1; x++) {
    for (let y = 0; y < 4; y++) player.conquer(game.ref(x, y));
  }
  player.setSpawnTile(game.ref(x0, 0));
  game.addExecution(new PlayerExecution(player));
}

const HUMANS = () => [
  new PlayerInfo("north", PlayerType.Human, "client1", "north"),
  new PlayerInfo("south", PlayerType.Human, "client2", "south"),
];

describe("A drop-in joins the round (L36)", () => {
  test("in the spawn phase: a challenger who spawns as everyone does", async () => {
    const game = await setup(
      "half_land_half_ocean",
      { piracy: { enabled: true } },
      HUMANS(),
      undefined,
      undefined,
      false,
    );
    expect(game.inSpawnPhase()).toBe(true);
    run(game, join("late1", "Ada"));
    const ada = game.playerByClientID("late1");
    expect(ada).not.toBeNull();
    expect(ada!.name()).toBe("Ada");
    expect(ada!.type()).toBe(PlayerType.Human);
    expect(ada!.hasSpawned()).toBe(false);
    run(game, { type: "spawn", clientID: "late1", tile: game.ref(4, 12) });
    executeTicks(game, 3);
    expect(ada!.hasSpawned()).toBe(true);
    expect(ada!.isAlive()).toBe(true);
  });

  test("after the spawn phase: no spawn, a corsair from 30 s into play", async () => {
    const game = await setup(
      "half_land_half_ocean",
      { piracy: { enabled: true } },
      HUMANS(),
    );
    while (game.inOpening()) game.executeNextTick();
    run(game, join("late1"));
    const late = game.playerByClientID("late1")!;
    expect(late).not.toBeNull();
    // The spawn phase is over: a spawn is refused.
    run(game, { type: "spawn", clientID: "late1", tile: game.ref(4, 12) });
    executeTicks(game, 3);
    expect(late.hasSpawned()).toBe(false);
    expect(late.isAlive()).toBe(false);

    const ready = game.roundStartTick()! + DROP_IN_PIRATE_DELAY_TICKS;
    expect(game.ticks()).toBeLessThan(ready);
    run(game, {
      type: "embrace_piracy",
      clientID: "late1",
      tile: game.ref(12, 8),
    });
    expect(late.isPirate()).toBe(false);
    expect(late.units(UnitType.Warship)).toHaveLength(0);

    while (game.ticks() < ready) game.executeNextTick();
    run(game, {
      type: "embrace_piracy",
      clientID: "late1",
      tile: game.ref(12, 8),
    });
    expect(late.isPirate()).toBe(true);
    expect(late.units(UnitType.Warship)).toHaveLength(1);
  });

  test("a player in the round from the start who never spawned may pirate too", async () => {
    const game = await setup(
      "half_land_half_ocean",
      { piracy: { enabled: true } },
      HUMANS(),
    );
    const idle = game.player("south");
    expect(idle.hasSpawned()).toBe(false);
    const ready = game.roundStartTick()! + DROP_IN_PIRATE_DELAY_TICKS;
    while (game.ticks() < ready) game.executeNextTick();
    game.addExecution(new EmbracePiracyExecution(idle, game.ref(12, 8)));
    executeTicks(game, 2);
    expect(idle.isPirate()).toBe(true);
  });

  test("never with piracy off", async () => {
    const game = await setup("half_land_half_ocean", {}, HUMANS());
    run(game, join("late1"));
    const late = game.playerByClientID("late1")!;
    const ready = game.roundStartTick()! + DROP_IN_PIRATE_DELAY_TICKS;
    while (game.ticks() < ready) game.executeNextTick();
    run(game, {
      type: "embrace_piracy",
      clientID: "late1",
      tile: game.ref(12, 8),
    });
    expect(late.isPirate()).toBe(false);
  });

  test("a returning player keeps their own player: no second one (L42)", async () => {
    const game = await setup(
      "half_land_half_ocean",
      { piracy: { enabled: true } },
      HUMANS(),
    );
    const before = game.allPlayers().length;
    run(game, join("client1", "Impostor"));
    expect(game.allPlayers()).toHaveLength(before);
    expect(game.playerByClientID("client1")!.name()).toBe("north");
    run(game, join("late1"), join("late1"));
    expect(game.allPlayers()).toHaveLength(before + 1);
  });

  test("a round already won takes nobody", async () => {
    const game = await setup("half_land_half_ocean", {}, HUMANS());
    game.setWinner(game.player("north"), game.stats().stats());
    run(game, join("late1"));
    expect(game.playerByClientID("late1")).toBeNull();
  });

  test("every client makes the same player on the same tick", async () => {
    const make = async () => {
      const game = await setup("half_land_half_ocean", {}, HUMANS());
      executeTicks(game, 7);
      run(game, join("late1"), join("late2"));
      return game;
    };
    const a = await make();
    const b = await make();
    const ids = (g: Game) =>
      ["late1", "late2"].map((c) => g.playerByClientID(c)!.id());
    expect(ids(a)).toEqual(ids(b));
    expect(new Set([...ids(a), "north", "south"]).size).toBe(4);
    expect(a.playerByClientID("late2")!.smallID()).toBe(
      b.playerByClientID("late2")!.smallID(),
    );
  });

  test("rides the binary wire spelled out, its clientID outside the roster", () => {
    // Real clientIDs are 8 to 10 letters and digits.
    const intent = join("LaTe0001", "Ada");
    expect(StampedIntentSchema.safeParse(intent).success).toBe(true);
    const msg: ServerMessage = {
      type: "turn",
      turn: { turnNumber: 12, intents: [intent] },
    };
    const ctx = createGameWireContext([{ clientID: "client1" }]);
    expect(decodeServerMessage(encodeServerMessage(msg, ctx), ctx)).toEqual(
      msg,
    );
  });
});

describe("Teams balance latecomers (L37)", () => {
  test("a newcomer joins the team with the fewest players", async () => {
    const game = await setup(
      "half_land_half_ocean",
      { gameMode: GameMode.Team, playerTeams: 2 },
      [
        new PlayerInfo("a", PlayerType.Human, "c1", "a"),
        new PlayerInfo("b", PlayerType.Human, "c2", "b"),
        new PlayerInfo("c", PlayerType.Human, "c3", "c"),
      ],
    );
    const counts = () => {
      const m = new Map<string, number>();
      for (const p of game.allPlayers()) {
        if (p.team() !== null) m.set(p.team()!, (m.get(p.team()!) ?? 0) + 1);
      }
      return m;
    };
    const before = counts();
    const smallest = [...before.entries()].sort((x, y) => x[1] - y[1])[0][0];
    run(game, join("late1"));
    expect(game.playerByClientID("late1")!.team()).toBe(smallest);
    // Now level: the next one goes to the first team in order.
    const sizes = [...counts().values()];
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    run(game, join("late2"), join("late3"));
    const after = [...counts().values()];
    expect(after.reduce((a, b) => a + b, 0)).toBe(6);
    expect(Math.max(...after) - Math.min(...after)).toBeLessThanOrEqual(1);
  });

  test("an FFA newcomer has no team", async () => {
    const game = await setup("half_land_half_ocean", {}, HUMANS());
    run(game, join("late1"));
    expect(game.playerByClientID("late1")!.team()).toBeNull();
  });
});

describe("A drop-in pirate who lands (L36, PR8)", () => {
  test("has their first spawn where they come ashore", async () => {
    const game = await setup(
      "half_land_half_ocean",
      { piracy: { enabled: true } },
      HUMANS(),
    );
    settle(game, game.player("north"), 0, 8);
    const cfg = game.config().piracyConfig();
    game.config().piracyConfig = () => ({ ...cfg, landingTiles: 20 });
    run(game, join("late1"));
    const late = game.playerByClientID("late1")!;
    const ready = game.roundStartTick()! + DROP_IN_PIRATE_DELAY_TICKS;
    while (game.ticks() < ready) game.executeNextTick();
    run(game, {
      type: "embrace_piracy",
      clientID: "late1",
      tile: game.ref(10, 8),
    });
    expect(late.isPirate()).toBe(true);
    // The neutral nebula south of the north's land.
    game.addExecution(new PirateLandingExecution(late, game.ref(3, 10)));
    for (let i = 0; i < 100 && late.isPirate(); i++) game.executeNextTick();
    expect(late.isPirate()).toBe(false);
    expect(late.isAlive()).toBe(true);
    expect(late.hasSpawned()).toBe(true);
  });
});
