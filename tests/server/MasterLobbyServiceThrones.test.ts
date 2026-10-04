import EventEmitter from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MasterLobbyService } from "../../src/server/MasterLobbyService";
import { startPolling } from "../../src/server/PollingLoop";
import { ServerEnv } from "../../src/server/ServerEnv";
import { ThroneRegistry } from "../../src/server/ThroneRegistry";

vi.mock("../../src/server/Logger", () => ({
  logger: { child: () => ({ error: vi.fn(), info: vi.fn() }) },
}));
vi.mock("../../src/server/PollingLoop", () => ({ startPolling: vi.fn() }));

// Under a Dark Star, T1 (docs/DarkStar-Lobbies.md §5.2, §5.7, §5.8): the
// master schedules thrones instead of the per-type queues. Boot opens one
// lobby per throne; a countdown is sent only once two humans are in and is
// withdrawn when they leave; a round's end opens the successor before anyone
// has picked anything and tells the finished game; stale reports of finished
// rounds are not advertised; running rounds sort last.

const T0 = 1_700_000_000_000;
const COUNTDOWN = 120_000;
const WINDOW = 30_000;
const NAMES = ["Vega", "Sirius", "Altair", "Deneb"];

function createMockWorker() {
  const emitter = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
  };
  emitter.send = vi.fn();
  return emitter;
}

function schedulerTask(): () => Promise<void> {
  const call = vi
    .mocked(startPolling)
    .mock.calls.find(([, intervalMs]) => intervalMs === 1000);
  if (call === undefined) throw new Error("scheduler loop was not started");
  return call[0];
}

function broadcastTask(): () => Promise<void> {
  const call = vi
    .mocked(startPolling)
    .mock.calls.find(([, intervalMs]) => intervalMs === 500);
  if (call === undefined) throw new Error("broadcast loop was not started");
  return call[0];
}

function sent(worker: ReturnType<typeof createMockWorker>, type: string) {
  return worker.send.mock.calls
    .map(([msg]) => msg)
    .filter((msg) => msg.type === type);
}

function last<T>(items: T[]): T {
  return items[items.length - 1];
}

function throneEntry(
  gameID: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    gameID,
    publicGameType: "throne",
    numClients: 0,
    createdAt: 1,
    throne: {
      throneID: "throne-01",
      name: "Vega",
      type: "ffa",
      reign: 0,
      seat: "open",
    },
    ...extra,
  };
}

describe("MasterLobbyService thrones", () => {
  let worker: ReturnType<typeof createMockWorker>;
  let service: MasterLobbyService;
  let registry: ThroneRegistry;
  let playlist: {
    gameConfig: ReturnType<typeof vi.fn>;
    maxPlayersForMap?: ReturnType<typeof vi.fn>;
    throneSpecialConfig?: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.mocked(startPolling).mockClear();
    vi.stubEnv("DOMAIN", "localhost");
    vi.spyOn(ServerEnv, "numWorkers").mockReturnValue(1);
    let n = 0;
    registry = new ThroneRegistry({
      names: NAMES,
      count: 3,
      mix: { ffa: 2, team: 0, special: 1 },
      minPlayers: 2,
      countdownMs: COUNTDOWN,
      windowMs: WINDOW,
      vanishGraceMs: 10_000,
      mintGameID: () => `g${String(++n).padStart(2, "0")}`,
    });
    // The playlist's roll, trusted-only as every seventh public game is.
    playlist = {
      gameConfig: vi.fn(async (type: string) => ({
        gameMap: `map-for-${type}`,
        trusted: true,
        hegemon: { enabled: true },
      })),
    };
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as any;
    service = new MasterLobbyService(playlist as any, log, false, registry);
    worker = createMockWorker();
    service.registerWorker(0, worker as any);
    worker.emit("message", { type: "workerReady", workerId: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("opens one lobby per throne at boot and no queue lobbies", async () => {
    await schedulerTask()();
    const creates = sent(worker, "createGame");
    expect(creates).toHaveLength(3);
    expect(creates.map((m) => m.publicGameType)).toEqual([
      "throne",
      "throne",
      "throne",
    ]);
    expect(creates.map((m) => m.throne)).toEqual([
      {
        throneID: "throne-01",
        name: "Vega",
        type: "ffa",
        reign: 0,
        minPlayers: 2,
      },
      {
        throneID: "throne-02",
        name: "Sirius",
        type: "ffa",
        reign: 0,
        minPlayers: 2,
      },
      {
        throneID: "throne-03",
        name: "Altair",
        type: "special",
        reign: 0,
        minPlayers: 2,
      },
    ]);
    // The playlist rolls an FFA config, or an FFA special game for a special
    // throne; a throne is never trusted-only (L3).
    expect(playlist.gameConfig).toHaveBeenCalledWith("ffa", {
      mode: "Free For All",
    });
    expect(playlist.gameConfig).toHaveBeenCalledWith("special", {
      mode: "Free For All",
    });
    expect(creates[2].gameConfig.gameMap).toBe("map-for-special");
    expect(creates[0].gameConfig).toEqual({
      gameMap: "map-for-ffa",
      hegemon: { enabled: true },
    });
    // No countdown yet: nobody is in.
    expect(sent(worker, "updateLobby")).toHaveLength(0);

    // A second pass creates nothing more.
    await schedulerTask()();
    expect(sent(worker, "createGame")).toHaveLength(3);
  });

  it("sends startsAt only at two players, withdraws it on a dip, resumes without reset", async () => {
    await schedulerTask()();
    const report = (numPlayers: number) =>
      worker.emit("message", {
        type: "lobbyList",
        lobbies: [
          throneEntry("g01", { numClients: numPlayers, numPlayers }),
          throneEntry("g02"),
          throneEntry("g03"),
        ],
      });

    report(1);
    await schedulerTask()();
    expect(sent(worker, "updateLobby")).toHaveLength(0);

    report(2);
    await schedulerTask()();
    expect(sent(worker, "updateLobby")).toEqual([
      { type: "updateLobby", gameID: "g01", startsAt: T0 + COUNTDOWN },
    ]);

    vi.setSystemTime(T0 + 45_000);
    report(1);
    await schedulerTask()();
    expect(sent(worker, "updateLobby")[1]).toEqual({
      type: "updateLobby",
      gameID: "g01",
      startsAt: null,
    });

    vi.setSystemTime(T0 + 300_000);
    report(2);
    await schedulerTask()();
    expect(sent(worker, "updateLobby")[2]).toEqual({
      type: "updateLobby",
      gameID: "g01",
      startsAt: T0 + 300_000 + (COUNTDOWN - 45_000),
    });
  });

  it("counts players, not spectators", async () => {
    await schedulerTask()();
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [
        throneEntry("g01", { numClients: 3, numPlayers: 1 }),
        throneEntry("g02"),
        throneEntry("g03"),
      ],
    });
    await schedulerTask()();
    expect(sent(worker, "updateLobby")).toHaveLength(0);
  });

  it("opens the successor when a round ends and tells the finished game", async () => {
    await schedulerTask()();
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [
        throneEntry("g01", {
          throne: { ...(throneEntry("g01").throne as object), running: true },
        }),
        throneEntry("g02"),
        throneEntry("g03"),
      ],
    });
    await schedulerTask()();

    worker.emit("message", {
      type: "throneRound",
      throneID: "throne-01",
      gameID: "g01",
      outcome: "overthrown",
      winner: { persistentID: "p-1", name: "Ada" },
    });
    await vi.waitFor(() => expect(sent(worker, "createGame")).toHaveLength(4));
    const successor = sent(worker, "createGame")[3];
    expect(successor.gameID).toBe("g04");
    expect(successor.throne.throneID).toBe("throne-01");
    expect(sent(worker, "successorCreated")).toEqual([
      {
        type: "successorCreated",
        gameID: "g01",
        successorID: "g04",
        reservationUntil: T0 + WINDOW,
      },
    ]);
    expect(registry.get("throne-01")?.gameID).toBe("g04");

    // The worker still reports the finished round while its win screen is
    // up; the broadcast advertises only the successor.
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [
        throneEntry("g01", {
          throne: { ...(throneEntry("g01").throne as object), running: true },
        }),
        throneEntry("g04"),
        throneEntry("g02"),
        throneEntry("g03"),
      ],
    });
    await broadcastTask()();
    const broadcast = last(sent(worker, "lobbiesBroadcast"));
    expect(
      broadcast.publicGames.games.throne.map((l: any) => l.gameID).sort(),
    ).toEqual(["g02", "g03", "g04"]);
    expect(broadcast.publicGames.games.ffa).toEqual([]);
  });

  it("recycles a throne whose game vanished from the reports", async () => {
    await schedulerTask()();
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [throneEntry("g01"), throneEntry("g02"), throneEntry("g03")],
    });
    await schedulerTask()();
    // g03 is gone (reaped empty after the 3-hour cap, say).
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [throneEntry("g01"), throneEntry("g02")],
    });
    vi.setSystemTime(T0 + 5000);
    await schedulerTask()();
    expect(sent(worker, "createGame")).toHaveLength(3);
    vi.setSystemTime(T0 + 20_000);
    await schedulerTask()();
    const creates = sent(worker, "createGame");
    expect(creates).toHaveLength(4);
    expect(creates[3].throne.throneID).toBe("throne-03");
    expect(creates[3].gameID).toBe("g04");
    expect(sent(worker, "successorCreated")).toHaveLength(0);
  });

  it("opens no lobby on an inactive deployment, and finishes running ones", async () => {
    service.setActive(false);
    await schedulerTask()();
    expect(sent(worker, "createGame")).toHaveLength(0);
    service.setActive(true);
    await schedulerTask()();
    expect(sent(worker, "createGame")).toHaveLength(3);
    service.setActive(false);
    worker.emit("message", {
      type: "throneRound",
      throneID: "throne-01",
      gameID: "g01",
      outcome: "void",
    });
    await Promise.resolve();
    expect(sent(worker, "createGame")).toHaveLength(3);
    expect(sent(worker, "successorCreated")).toHaveLength(0);
  });

  it("advertises thrones soonest-first: countdowns, then the fullest open lobby, running last", async () => {
    await schedulerTask()();
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [
        throneEntry("g01", {
          throne: { ...(throneEntry("g01").throne as object), running: true },
        }),
        throneEntry("g02", { numClients: 1, numPlayers: 1 }),
        throneEntry("g03", {
          numClients: 2,
          numPlayers: 2,
          startsAt: T0 + 50_000,
        }),
      ],
    });
    await broadcastTask()();
    const broadcast = last(sent(worker, "lobbiesBroadcast"));
    expect(
      broadcast.publicGames.games.throne.map((l: any) => l.gameID),
    ).toEqual(["g03", "g02", "g01"]);
  });

  it("keeps the per-type queues when built without a registry", async () => {
    vi.mocked(startPolling).mockClear();
    const log = { info: vi.fn(), error: vi.fn() } as any;
    const queue = new MasterLobbyService(playlist as any, log, false, null);
    const w = createMockWorker();
    queue.registerWorker(0, w as any);
    w.emit("message", { type: "workerReady", workerId: 0 });
    await schedulerTask()();
    const types = new Set(sent(w, "createGame").map((m) => m.publicGameType));
    expect(types).toEqual(new Set(["ffa", "team", "special"]));
  });

  // --- T2: the seat ---

  const ADA = { persistentID: "ada-pid", name: "Ada" };

  async function winRound() {
    await schedulerTask()();
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [
        throneEntry("g01", {
          throne: { ...(throneEntry("g01").throne as object), running: true },
        }),
        throneEntry("g02"),
        throneEntry("g03"),
      ],
    });
    await schedulerTask()();
    worker.emit("message", {
      type: "throneRound",
      throneID: "throne-01",
      gameID: "g01",
      outcome: "overthrown",
      winner: ADA,
    });
    await vi.waitFor(() => expect(sent(worker, "createGame")).toHaveLength(4));
    return sent(worker, "createGame")[3];
  }

  it("reserves the seat for the winner in the successor's assignment", async () => {
    const successor = await winRound();
    expect(successor.throne).toMatchObject({
      throneID: "throne-01",
      heir: ADA,
      reservationUntil: T0 + WINDOW,
      reign: 0,
    });
  });

  it("applies the winner's pick: map with a recomputed cap, heir kept, reign set", async () => {
    playlist.maxPlayersForMap = vi.fn(async () => 42);
    await winRound();
    worker.emit("message", {
      type: "thronePick",
      throneID: "throne-01",
      gameID: "g01",
      persistentID: ADA.persistentID,
      gameMap: "Event Horizon",
      stay: true,
    });
    await vi.waitFor(() =>
      expect(sent(worker, "updateLobby").length).toBeGreaterThan(0),
    );
    expect(sent(worker, "updateLobby")).toEqual([
      {
        type: "updateLobby",
        gameID: "g04",
        gameConfig: { gameMap: "Event Horizon", maxPlayers: 42 },
        throne: { heir: ADA, reign: 1 },
      },
    ]);
    expect(playlist.maxPlayersForMap).toHaveBeenCalledWith(
      "Event Horizon",
      expect.objectContaining({ gameMap: "map-for-ffa" }),
    );
  });

  it("keeps the random map on an unknown map name, and honours step down", async () => {
    await winRound();
    worker.emit("message", {
      type: "thronePick",
      throneID: "throne-01",
      gameID: "g01",
      persistentID: ADA.persistentID,
      gameMap: "Not A Map",
      stay: false,
    });
    await vi.waitFor(() =>
      expect(sent(worker, "updateLobby").length).toBeGreaterThan(0),
    );
    expect(sent(worker, "updateLobby")).toEqual([
      {
        type: "updateLobby",
        gameID: "g04",
        gameConfig: undefined,
        throne: { heir: null, reign: 0 },
      },
    ]);
  });

  it("opens the seat on the successor when the window runs out", async () => {
    await winRound();
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [throneEntry("g04"), throneEntry("g02"), throneEntry("g03")],
    });
    vi.setSystemTime(T0 + WINDOW + 1);
    await schedulerTask()();
    expect(sent(worker, "updateLobby")).toEqual([
      { type: "updateLobby", gameID: "g04", throne: { heir: null, reign: 0 } },
    ]);
    // Too late now.
    worker.emit("message", {
      type: "thronePick",
      throneID: "throne-01",
      gameID: "g01",
      persistentID: ADA.persistentID,
      stay: true,
    });
    await Promise.resolve();
    expect(sent(worker, "updateLobby")).toHaveLength(1);
  });

  it("passes the window to the finished game with the successor id", async () => {
    await winRound();
    expect(sent(worker, "successorCreated")).toEqual([
      {
        type: "successorCreated",
        gameID: "g01",
        successorID: "g04",
        reservationUntil: T0 + WINDOW,
      },
    ]);
  });

  // --- T4: special thrones ---

  async function winSpecialRound() {
    await schedulerTask()();
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [
        throneEntry("g01"),
        throneEntry("g02"),
        throneEntry("g03", {
          throne: {
            ...(throneEntry("g03").throne as object),
            throneID: "throne-03",
            type: "special",
            running: true,
          },
        }),
      ],
    });
    await schedulerTask()();
    worker.emit("message", {
      type: "throneRound",
      throneID: "throne-03",
      gameID: "g03",
      outcome: "overthrown",
      winner: ADA,
    });
    await vi.waitFor(() => expect(sent(worker, "createGame")).toHaveLength(4));
    expect(sent(worker, "createGame")[3].throne.type).toBe("special");
  }

  it("rebuilds a special round from the winner's modifiers and map", async () => {
    playlist.throneSpecialConfig = vi.fn(
      async (map: string, mods: string[]) => ({
        gameMap: map,
        maxPlayers: 30,
        gameMode: "Free For All",
        publicGameModifiers: { isCompact: mods.includes("isCompact") },
        startingGold: mods.includes("startingGold5M") ? 5_000_000 : undefined,
        hegemon: { enabled: true },
        gameType: "Public",
      }),
    );
    await winSpecialRound();
    worker.emit("message", {
      type: "thronePick",
      throneID: "throne-03",
      gameID: "g03",
      persistentID: ADA.persistentID,
      gameMap: "Event Horizon",
      modifiers: ["isCompact", "startingGold5M"],
      stay: true,
    });
    await vi.waitFor(() =>
      expect(sent(worker, "updateLobby").length).toBeGreaterThan(0),
    );
    expect(playlist.throneSpecialConfig).toHaveBeenCalledWith("Event Horizon", [
      "isCompact",
      "startingGold5M",
    ]);
    const update = sent(worker, "updateLobby")[0];
    expect(update.gameConfig).toMatchObject({
      gameMap: "Event Horizon",
      maxPlayers: 30,
      publicGameModifiers: { isCompact: true },
      startingGold: 5_000_000,
    });
    expect("gameType" in update.gameConfig).toBe(false);
    expect(update.throne).toEqual({ heir: ADA, reign: 1 });
  });

  it("keeps the rolled modifiers when the winner picks only a map on a special throne", async () => {
    playlist.gameConfig = vi.fn(async (type: string) => ({
      gameMap: `map-for-${type}`,
      hegemon: { enabled: true },
      publicGameModifiers:
        type === "special"
          ? { isPeaceTime: true, goldMultiplier: 2 }
          : undefined,
    }));
    playlist.throneSpecialConfig = vi.fn(async (map: string) => ({
      gameMap: map,
      hegemon: { enabled: true },
    }));
    await winSpecialRound();
    worker.emit("message", {
      type: "thronePick",
      throneID: "throne-03",
      gameID: "g03",
      persistentID: ADA.persistentID,
      gameMap: "Event Horizon",
      stay: false,
    });
    await vi.waitFor(() =>
      expect(sent(worker, "updateLobby").length).toBeGreaterThan(0),
    );
    const [, mods] = playlist.throneSpecialConfig.mock.calls[0];
    expect([...mods].sort()).toEqual(["goldMultiplier", "isPeaceTime"]);
  });

  it("drops modifiers off the whitelist, in excess, or on an FFA throne", async () => {
    playlist.throneSpecialConfig = vi.fn(async (map: string) => ({
      gameMap: map,
      hegemon: { enabled: true },
    }));
    await winRound(); // throne-01, FFA
    worker.emit("message", {
      type: "thronePick",
      throneID: "throne-01",
      gameID: "g01",
      persistentID: ADA.persistentID,
      modifiers: ["isCompact"],
      stay: true,
    });
    await vi.waitFor(() =>
      expect(sent(worker, "updateLobby").length).toBeGreaterThan(0),
    );
    // No map, modifiers ignored: the seat answer alone.
    expect(sent(worker, "updateLobby")[0].gameConfig).toBeUndefined();
    expect(playlist.throneSpecialConfig).not.toHaveBeenCalled();
  });
});
