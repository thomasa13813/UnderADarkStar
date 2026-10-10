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

// Under a Dark Star (docs/DarkStar-Lobbies.md §5.2, §5.7, §5.8, L16-L27): the
// master schedules thrones instead of the per-type queues. Boot opens one
// lobby per throne; a countdown is sent only to the head of a line once two
// humans are in and is withdrawn when they leave; a round's start opens a new
// throne to keep the floor; a round's end opens the successor before anyone
// has picked anything and tells the finished game; stale reports of finished
// rounds are not advertised; thrones are advertised in launch order with
// their place, running rounds last; a retired throne's lobby is closed.

const T0 = 1_700_000_000_000;
const COUNTDOWN = 120_000;
const WINDOW = 30_000;
const CULL = 60_000;
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
      floor: { ffa: 2, team: 0, special: 1 },
      minPlayers: 2,
      countdownMs: COUNTDOWN,
      windowMs: WINDOW,
      vanishGraceMs: 10_000,
      cullGraceMs: CULL,
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

  // T5 (§5.9): a team line's thrones roll team games, nothing pinned.
  it("rolls a team throne's round as a team game", async () => {
    vi.mocked(startPolling).mockClear();
    let n = 0;
    const teamRegistry = new ThroneRegistry({
      names: NAMES,
      floor: { ffa: 0, team: 2, special: 0 },
      minPlayers: 2,
      countdownMs: COUNTDOWN,
      windowMs: WINDOW,
      vanishGraceMs: 10_000,
      cullGraceMs: CULL,
      mintGameID: () => `t${String(++n).padStart(2, "0")}`,
    });
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as any;
    const teamService = new MasterLobbyService(
      playlist as any,
      log,
      false,
      teamRegistry,
    );
    const teamWorker = createMockWorker();
    teamService.registerWorker(0, teamWorker as any);
    teamWorker.emit("message", { type: "workerReady", workerId: 0 });
    await schedulerTask()();
    const creates = sent(teamWorker, "createGame");
    expect(creates.map((m) => m.throne.type)).toEqual(["team", "team"]);
    expect(playlist.gameConfig).toHaveBeenCalledWith("team", { throne: true });
    expect(playlist.gameConfig).not.toHaveBeenCalledWith(
      "team",
      expect.objectContaining({ mode: expect.anything() }),
    );
    expect(creates[0].gameConfig).toEqual({
      gameMap: "map-for-team",
      hegemon: { enabled: true },
    });
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
    // The playlist rolls the throne's type, marked as a throne round (the
    // Hegemon on, the Lords kept); a special throne is pinned to FFA; a
    // throne is never trusted-only (L3).
    expect(playlist.gameConfig).toHaveBeenCalledWith("ffa", { throne: true });
    expect(playlist.gameConfig).toHaveBeenCalledWith("special", {
      throne: true,
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
    // The round's start already opened throne-04 (g04) to keep the FFA
    // line at its floor of two.
    expect(sent(worker, "createGame")).toHaveLength(4);
    expect(sent(worker, "createGame")[3].throne).toMatchObject({
      throneID: "throne-04",
      name: "Deneb",
      type: "ffa",
    });
    await vi.waitFor(() => expect(sent(worker, "createGame")).toHaveLength(5));
    const successor = sent(worker, "createGame")[4];
    expect(successor.gameID).toBe("g05");
    expect(successor.throne.throneID).toBe("throne-01");
    expect(sent(worker, "successorCreated")).toEqual([
      {
        type: "successorCreated",
        gameID: "g01",
        successorID: "g05",
        reservationUntil: T0 + WINDOW,
      },
    ]);
    expect(registry.get("throne-01")?.gameID).toBe("g05");

    // The worker still reports the finished round while its win screen is
    // up; the broadcast advertises only the successor.
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [
        throneEntry("g01", {
          throne: { ...(throneEntry("g01").throne as object), running: true },
        }),
        throneEntry("g05"),
        throneEntry("g04"),
        throneEntry("g02"),
        throneEntry("g03"),
      ],
    });
    await broadcastTask()();
    const broadcast = last(sent(worker, "lobbiesBroadcast"));
    expect(
      broadcast.publicGames.games.throne.map((l: any) => l.gameID).sort(),
    ).toEqual(["g02", "g03", "g04", "g05"]);
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

  it("advertises thrones in launch order with their place: each line's head first, running last", async () => {
    await schedulerTask()();
    // throne-02 (g02) has the minimum, so it is the FFA head ahead of
    // throne-01; throne-03 (g03) is the special line's only throne.
    const entries = (g03Running: boolean) => [
      throneEntry("g01"),
      throneEntry("g02", { numClients: 2, numPlayers: 2 }),
      throneEntry("g03", {
        throne: {
          ...(throneEntry("g03").throne as object),
          throneID: "throne-03",
          type: "special",
          ...(g03Running ? { running: true } : {}),
        },
      }),
    ];
    worker.emit("message", { type: "lobbyList", lobbies: entries(false) });
    await schedulerTask()();
    await broadcastTask()();
    const listed = () =>
      last(sent(worker, "lobbiesBroadcast")).publicGames.games.throne.map(
        (l: any) => [l.gameID, l.throne.place],
      );
    expect(listed()).toEqual([
      ["g02", 1],
      ["g03", 1],
      ["g01", 2],
    ]);

    // The special round starts: it leaves its line and sorts last.
    worker.emit("message", { type: "lobbyList", lobbies: entries(true) });
    await schedulerTask()();
    await broadcastTask()();
    expect(listed()).toEqual([
      ["g02", 1],
      ["g01", 2],
      ["g03", undefined],
    ]);
  });

  it("closes the lobby of a surplus throne nobody is in (L20)", async () => {
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
    // throne-01 runs: throne-04 (g04) opens to keep the FFA floor of two.
    await schedulerTask()();
    worker.emit("message", {
      type: "throneRound",
      throneID: "throne-01",
      gameID: "g01",
      outcome: "ai",
    });
    // The AI held it: throne-01 returns to the back of the line as g05,
    // one more than the floor.
    await vi.waitFor(() => expect(sent(worker, "createGame")).toHaveLength(5));
    const empty = {
      type: "lobbyList",
      lobbies: [
        throneEntry("g02"),
        throneEntry("g03"),
        throneEntry("g04"),
        throneEntry("g05"),
      ],
    };
    worker.emit("message", empty);
    await schedulerTask()();
    expect(sent(worker, "updateLobby")).toHaveLength(0);

    // A second past the grace: waiting for the successor above moved the
    // fake clock a little, and every surplus throne must be eligible so the
    // last in line is the one that goes.
    vi.setSystemTime(T0 + CULL + 1000);
    worker.emit("message", empty);
    await schedulerTask()();
    expect(sent(worker, "updateLobby")).toEqual([
      { type: "updateLobby", gameID: "g05", retire: true },
    ]);
    expect(registry.get("throne-01")).toBeUndefined();
    // Once: the line is back at its floor.
    await schedulerTask()();
    expect(sent(worker, "updateLobby")).toHaveLength(1);
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
    // The fourth create was throne-04, opened when throne-01's round started
    // (the floor); the fifth is throne-01's successor lobby, g05.
    await vi.waitFor(() => expect(sent(worker, "createGame")).toHaveLength(5));
    return sent(worker, "createGame")[4];
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
        gameID: "g05",
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
        gameID: "g05",
        gameConfig: undefined,
        throne: { heir: null, reign: 0 },
      },
    ]);
  });

  it("keeps the winner seated on a random map when the window runs out (L4)", async () => {
    await winRound();
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [
        throneEntry("g05"),
        throneEntry("g02"),
        throneEntry("g03"),
        throneEntry("g04"),
      ],
    });
    vi.setSystemTime(T0 + WINDOW + 1);
    await schedulerTask()();
    expect(sent(worker, "updateLobby")).toEqual([
      {
        type: "updateLobby",
        gameID: "g05",
        gameConfig: undefined,
        throne: { heir: ADA, reign: 1 },
      },
    ]);
    expect(registry.get("throne-01")).toMatchObject({
      seat: "seated",
      holder: ADA,
      reign: 1,
    });
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
        successorID: "g05",
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
    // The fourth create kept the special line's floor when g03 started; the
    // fifth is throne-03's successor lobby.
    await vi.waitFor(() => expect(sent(worker, "createGame")).toHaveLength(5));
    expect(sent(worker, "createGame")[3].throne.type).toBe("special");
    expect(sent(worker, "createGame")[4].throne).toMatchObject({
      throneID: "throne-03",
      type: "special",
    });
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
