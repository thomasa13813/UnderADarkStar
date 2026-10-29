import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GamePhase } from "../../src/server/GameServer";
import {
  ThroneAssignment,
  ThroneRoundReport,
} from "../../src/server/IPCBridgeSchema";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// Under a Dark Star, T1 (docs/DarkStar-Lobbies.md §5.7, §5.8): what a
// GameServer does for the throne it runs. It will not start short of the
// minimum even past startsAt (the worker's own guard behind the master's
// hold), it shows the throne on its lobby info, and when the winner vote
// resolves it reports the round's outcome, with the winner's identity, for
// the master.

const T0 = 1_700_000_000_000;
const VEGA: ThroneAssignment = {
  throneID: "throne-01",
  name: "Vega",
  type: "ffa",
  reign: 0,
  minPlayers: 2,
};

describe("GameServer on a throne", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stays a lobby past startsAt until the minimum is in", () => {
    const game = makeGame({ startsAt: T0 + 5000, publicGameType: "throne" });
    game.setThrone(VEGA);
    game.joinClient(makeClient());
    game.joinClient(makeClient({ spectator: true }));
    vi.setSystemTime(T0 + 6000);
    expect(game.phase()).toBe(GamePhase.Lobby);
    game.joinClient(makeClient());
    expect(game.phase()).toBe(GamePhase.Active);
  });

  it("is not held without a throne", () => {
    const game = makeGame({ startsAt: T0 + 5000 });
    game.joinClient(makeClient());
    vi.setSystemTime(T0 + 6000);
    expect(game.phase()).toBe(GamePhase.Active);
  });

  it("shows the throne on lobby info: seat, then running once started", () => {
    const seat = cid("seat");
    const game = makeGame({
      publicGameType: "throne",
      config: { hegemon: { enabled: true } },
    });
    expect(game.gameInfo().throne).toBeUndefined();
    game.setThrone(VEGA);
    expect(game.gameInfo().throne).toMatchObject({
      throneID: "throne-01",
      name: "Vega",
      type: "ffa",
      reign: 0,
      seat: "open",
    });
    game.updateGameConfig({ hegemon: { enabled: true, seat } });
    expect(game.gameInfo().throne?.seat).toBe("seated");

    game.joinClient(makeClient({ clientID: seat }));
    game.joinClient(makeClient());
    startGame(game);
    const info = game.gameInfo().throne!;
    expect(info.running).toBe(true);
    expect(info.startedAt).toBe(T0);
  });

  // Two voters on two IPs: both votes make the majority and resolve the round.
  async function playRound(
    seatOnThrone: boolean,
    vote: (throne: string, other: string) => any,
  ): Promise<ThroneRoundReport[]> {
    const reports: ThroneRoundReport[] = [];
    const throne = cid("throne");
    const other = cid("other");
    const game = makeGame({
      publicGameType: "throne",
      config: {
        hegemon: seatOnThrone
          ? { enabled: true, seat: throne }
          : { enabled: true },
      },
      deps: { throneRound: (r) => reports.push(r) },
    });
    game.setThrone(VEGA);
    const a = makeClient({
      clientID: throne,
      persistentID: "pid-throne",
      username: "Ada",
    });
    const b = makeClient({
      clientID: other,
      persistentID: "pid-other",
      username: "Bob",
    });
    game.joinClient(a);
    game.joinClient(b);
    startGame(game);
    const winner = vote(throne, other);
    const msg = { type: "winner", winner, allPlayersStats: {} } as const;
    await mockWsOf(a).emit(msg as any);
    await mockWsOf(b).emit(msg as any);
    return reports;
  }

  it("reports a Hegemon who held the timer", async () => {
    const reports = await playRound(true, (throne) => ["player", throne]);
    expect(reports).toEqual([
      {
        throneID: "throne-01",
        gameID: expect.any(String),
        outcome: "timer",
        winner: { persistentID: "pid-throne", name: "Ada" },
      },
    ]);
  });

  it("reports a challenger who overthrew the Hegemon", async () => {
    const reports = await playRound(true, (_throne, other) => [
      "player",
      other,
    ]);
    expect(reports[0]).toMatchObject({
      outcome: "overthrown",
      winner: { persistentID: "pid-other", name: "Bob" },
    });
  });

  it("reports an AI winner without a holder, and a void round", async () => {
    const ai = await playRound(false, () => ["nation", "Dark Star"]);
    expect(ai[0]).toEqual({
      throneID: "throne-01",
      gameID: expect.any(String),
      outcome: "ai",
    });
    const none = await playRound(false, () => undefined);
    expect(none[0]).toMatchObject({ outcome: "void" });
    expect(none[0].winner).toBeUndefined();
  });

  // Lobbies L44: a drop-in (anyone not in the start roster) who lands the
  // killing blow wins nothing; the round is void and the seat opens.
  it("reports a void round when the winner joined after the start", async () => {
    const reports = await playRound(true, () => ["player", cid("dropin")]);
    expect(reports[0]).toMatchObject({ outcome: "void" });
    expect(reports[0].winner).toBeUndefined();
  });

  it("reports once per round, and nothing for a game off the thrones", async () => {
    const reports: ThroneRoundReport[] = [];
    const game = makeGame({
      deps: { throneRound: (r) => reports.push(r) },
    });
    const a = makeClient();
    const b = makeClient();
    game.joinClient(a);
    game.joinClient(b);
    startGame(game);
    const msg = {
      type: "winner",
      winner: ["player", a.clientID],
      allPlayersStats: {},
    } as const;
    await mockWsOf(a).emit(msg as any);
    await mockWsOf(b).emit(msg as any);
    await game.end();
    expect(reports).toEqual([]);
  });
});
