import EventEmitter from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GamePhase, GameServer } from "../../src/server/GameServer";
import { ThroneAssignment } from "../../src/server/IPCBridgeSchema";
import { WorkerLobbyService } from "../../src/server/WorkerLobbyService";
import {
  makeClient,
  makeGame,
  mockLogger,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";
import { testGameConfig } from "../util/Wire";

// Under a Dark Star, T1 (docs/DarkStar-Lobbies.md §5.2, §5.3): the worker's
// side of the throne IPC. createGame carries the throne onto the GameServer,
// updateLobby with a null startsAt holds the lobby, successorCreated reaches
// the finished game as new_lobby, lobby reports count players (not
// spectators) and include running throne rounds, and a round's result goes
// back to the master.

const VEGA: ThroneAssignment = {
  throneID: "throne-01",
  name: "Vega",
  type: "ffa",
  reign: 0,
  minPlayers: 2,
};

describe("WorkerLobbyService thrones", () => {
  let service: WorkerLobbyService;
  let gm: Record<string, ReturnType<typeof vi.fn>>;
  let sendToMaster: ReturnType<typeof vi.fn>;
  const games = new Map<string, GameServer>();

  function makeThroneGame(id: string, throne = VEGA): GameServer {
    const game = makeGame({
      id,
      publicGameType: "throne",
      config: { gameType: "Public" as any, maxPlayers: 10 },
    });
    game.setThrone(throne);
    games.set(id, game);
    return game;
  }

  beforeEach(() => {
    games.clear();
    gm = {
      publicLobbies: vi.fn(() =>
        [...games.values()].filter((g) => g.phase() === GamePhase.Lobby),
      ),
      listedLobbies: vi.fn().mockReturnValue([]),
      throneGames: vi.fn(() =>
        [...games.values()].filter((g) => g.throne() !== null),
      ),
      game: vi.fn((id: string) => games.get(id) ?? null),
      createGame: vi.fn((id: string, config, _creator, _startsAt, type) => {
        const game = makeGame({ id, publicGameType: type, config });
        games.set(id, game);
        return game;
      }),
      activeGames: vi.fn(() => games.size),
      setThroneRoundListener: vi.fn(),
      setThronePickListener: vi.fn(),
    };
    const server = new EventEmitter();
    service = new WorkerLobbyService(
      server as any,
      { handleUpgrade: vi.fn() } as any,
      gm as any,
      mockLogger(),
    );
    sendToMaster = vi.fn();
    (service as any).sendToMaster = sendToMaster;
  });

  function dispatch(msg: unknown) {
    (service as any).handleMasterMessage(msg);
  }

  function lastLobbyList(): any {
    const lists = sendToMaster.mock.calls
      .map((c) => c[0])
      .filter((m) => m.type === "lobbyList");
    return lists[lists.length - 1];
  }

  function broadcast() {
    dispatch({
      type: "lobbiesBroadcast",
      publicGames: { serverTime: 1, games: {} },
      active: true,
    });
  }

  it("creates a throne game with its assignment on the GameServer", () => {
    const config = testGameConfig();
    dispatch({
      type: "createGame",
      gameID: "g01",
      gameConfig: config,
      publicGameType: "throne",
      throne: VEGA,
    });
    expect(gm.createGame).toHaveBeenCalledWith(
      "g01",
      config,
      undefined,
      undefined,
      "throne",
    );
    const game = games.get("g01")!;
    expect(game.throne()).toEqual(VEGA);
    expect(game.gameInfo().throne).toEqual({
      throneID: "throne-01",
      name: "Vega",
      type: "ffa",
      reign: 0,
      seat: "open",
      running: undefined,
      startedAt: undefined,
    });
  });

  it("holds a lobby on updateLobby startsAt: null and resumes on a number", () => {
    const game = makeThroneGame("g01");
    dispatch({ type: "updateLobby", gameID: "g01", startsAt: 123_456 });
    expect(game.gameInfo().startsAt).toBe(123_456);
    dispatch({ type: "updateLobby", gameID: "g01", startsAt: null });
    expect(game.gameInfo().startsAt).toBeUndefined();
    expect(game.phase()).toBe(GamePhase.Lobby);
  });

  it("announces the successor to the finished game as new_lobby", () => {
    const game = makeThroneGame("g01");
    const a = makeClient();
    const b = makeClient();
    game.joinClient(a);
    game.joinClient(b);
    startGame(game);
    dispatch({ type: "successorCreated", gameID: "g01", successorID: "g02" });
    expect(game.successorLobby()).toBe("g02");
    for (const c of [a, b]) {
      const msg = mockWsOf(c)
        .sent()
        .find((m) => m.type === "new_lobby");
      expect(msg).toMatchObject({ type: "new_lobby", gameID: "g02" });
    }
    // Unknown game: logged, not thrown.
    expect(() =>
      dispatch({
        type: "successorCreated",
        gameID: "nope",
        successorID: "g03",
      }),
    ).not.toThrow();
  });

  it("reports throne lobbies with the throne and the player count, spectators excluded", () => {
    const game = makeThroneGame("g01");
    game.joinClient(makeClient());
    game.joinClient(makeClient({ spectator: true }));
    broadcast();
    const list = lastLobbyList();
    expect(list.lobbies).toHaveLength(1);
    expect(list.lobbies[0]).toMatchObject({
      gameID: "g01",
      publicGameType: "throne",
      numClients: 2,
      numPlayers: 1,
      throne: { throneID: "throne-01", name: "Vega", seat: "open" },
    });
    expect(list.lobbies[0].throne.running).toBeUndefined();
  });

  it("keeps reporting a throne round in progress, flagged running", () => {
    const lobby = makeThroneGame("g01");
    lobby.joinClient(makeClient());
    const running = makeThroneGame("g02", { ...VEGA, throneID: "throne-02" });
    running.joinClient(makeClient());
    running.joinClient(makeClient());
    startGame(running);
    expect(running.phase()).not.toBe(GamePhase.Lobby);

    broadcast();
    const list = lastLobbyList();
    expect(list.lobbies.map((l: any) => l.gameID).sort()).toEqual([
      "g01",
      "g02",
    ]);
    const reported = list.lobbies.find((l: any) => l.gameID === "g02");
    expect(reported).toMatchObject({
      publicGameType: "throne",
      numPlayers: 2,
      throne: { throneID: "throne-02", running: true },
    });
    expect(reported.throne.startedAt).toBeTypeOf("number");
    expect(reported.startsAt).toBeUndefined();
  });

  it("forwards a round's result to the master", () => {
    expect(gm.setThroneRoundListener).toHaveBeenCalledOnce();
    const listener = gm.setThroneRoundListener.mock.calls[0][0];
    listener({
      throneID: "throne-01",
      gameID: "g01",
      outcome: "timer",
      winner: { persistentID: "p-1", name: "Ada" },
    });
    expect(sendToMaster).toHaveBeenCalledWith({
      type: "throneRound",
      throneID: "throne-01",
      gameID: "g01",
      outcome: "timer",
      winner: { persistentID: "p-1", name: "Ada" },
    });
  });

  // --- T2: the seat ---

  it("seats the heir named in the assignment as they join", () => {
    dispatch({
      type: "createGame",
      gameID: "g01",
      gameConfig: testGameConfig({ hegemon: { enabled: true } }),
      publicGameType: "throne",
      throne: {
        ...VEGA,
        heir: { persistentID: "ada-pid", name: "Ada" },
        reservationUntil: 123,
      },
    });
    const game = games.get("g01")!;
    expect(game.hegemonHeirID()).toBe("ada-pid");
    game.joinClient(makeClient({ persistentID: "ada-pid" }));
    expect(game.gameInfo().throne?.seat).toBe("seated");
  });

  it("applies a pick: the config patch and the seat, without touching the countdown", () => {
    const game = makeThroneGame("g01", {
      ...VEGA,
      heir: { persistentID: "ada-pid", name: "Ada" },
    });
    dispatch({ type: "updateLobby", gameID: "g01", startsAt: 5000 });
    dispatch({
      type: "updateLobby",
      gameID: "g01",
      gameConfig: { gameMap: "Event Horizon", maxPlayers: 7 },
      throne: { heir: { persistentID: "ada-pid", name: "Ada" }, reign: 2 },
    });
    expect(game.gameInfo().startsAt).toBe(5000);
    expect(game.gameConfig.gameMap).toBe("Event Horizon");
    expect(game.gameConfig.maxPlayers).toBe(7);
    expect(game.gameInfo().throne).toMatchObject({
      reign: 2,
      seat: "reserved",
    });

    dispatch({
      type: "updateLobby",
      gameID: "g01",
      throne: { heir: null, reign: 0 },
    });
    expect(game.hegemonHeirID()).toBeNull();
    expect(game.gameInfo().throne?.seat).toBe("open");
  });

  it("forwards the winner's pick to the master", () => {
    expect(gm.setThronePickListener).toHaveBeenCalledOnce();
    const listener = gm.setThronePickListener.mock.calls[0][0];
    listener({
      throneID: "throne-01",
      gameID: "g01",
      persistentID: "ada-pid",
      gameMap: "Event Horizon",
      stay: true,
    });
    expect(sendToMaster).toHaveBeenCalledWith({
      type: "thronePick",
      throneID: "throne-01",
      gameID: "g01",
      persistentID: "ada-pid",
      gameMap: "Event Horizon",
      stay: true,
    });
  });

  it("tells the finished game's win screen about the winner's window", () => {
    const game = makeThroneGame("g01");
    const a = makeClient();
    game.joinClient(a);
    game.joinClient(makeClient());
    startGame(game);
    dispatch({
      type: "successorCreated",
      gameID: "g01",
      successorID: "g02",
      reservationUntil: 777_000,
    });
    const msg = mockWsOf(a)
      .sent()
      .find((m) => m.type === "new_lobby");
    expect(msg).toEqual({
      type: "new_lobby",
      gameID: "g02",
      throne: { reservationUntil: 777_000 },
    });
  });
});
