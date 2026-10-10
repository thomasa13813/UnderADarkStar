import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameMapType } from "../../src/core/game/Game";
import { Intent, ServerStartGameMessage } from "../../src/core/Schemas";
import { GameServer } from "../../src/server/GameServer";
import {
  ThroneAssignment,
  ThronePickReport,
} from "../../src/server/IPCBridgeSchema";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// Under a Dark Star, T2 (docs/DarkStar-Lobbies.md §5.5, §5.6): the seat in a
// throne lobby. Any player may claim an open seat and give it up again;
// spectators, a taken seat and a standing reservation are refused; the
// heir is seated as they arrive and unseated when the master says they
// stepped down; a claimed seat is stamped isHegemon at start. And on the
// finished game, the winner's pick is accepted from the winner only, once.

const T0 = 1_700_000_000_000;
const VEGA: ThroneAssignment = {
  throneID: "throne-01",
  name: "Vega",
  type: "ffa",
  reign: 0,
  minPlayers: 2,
};
const HEIR = { persistentID: "heir-pid", name: "Ada" };

function throneLobby(throne: ThroneAssignment = VEGA): GameServer {
  const game = makeGame({
    publicGameType: "throne",
    config: { hegemon: { enabled: true } },
  });
  game.setThrone(throne);
  return game;
}

function intent(game: GameServer, clientID: string, type: Intent["type"]) {
  return game.handleIntent({ type } as Intent, {
    clientID,
    isLobbyCreator: false,
    isAdmin: false,
    isAdminBot: false,
  });
}

describe("GameServer - claiming the throne", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("gives an open seat to the first player who claims it", () => {
    const game = throneLobby();
    const a = makeClient();
    const b = makeClient();
    game.joinClient(a);
    game.joinClient(b);
    expect(game.gameInfo().throne?.seat).toBe("open");

    expect(intent(game, a.clientID, "claim_seat").status).toBe(200);
    expect(game.gameConfig.hegemon?.seat).toBe(a.clientID);
    expect(game.gameInfo().throne).toMatchObject({
      seat: "seated",
      holderName: a.username,
    });
    // Second claimant: the seat is taken.
    expect(intent(game, b.clientID, "claim_seat").status).toBe(409);
    expect(game.gameConfig.hegemon?.seat).toBe(a.clientID);
    // Everyone learns of the change at once.
    const infos = mockWsOf(b)
      .sent()
      .filter((m) => m.type === "lobby_info");
    expect(infos.length).toBeGreaterThanOrEqual(1);
    const latest = infos[infos.length - 1] as any;
    expect(latest.lobby.throne.seat).toBe("seated");
  });

  it("lets the holder give the seat up, and nobody else", () => {
    const game = throneLobby();
    const a = makeClient();
    const b = makeClient();
    game.joinClient(a);
    game.joinClient(b);
    intent(game, a.clientID, "claim_seat");
    expect(intent(game, b.clientID, "leave_seat").status).toBe(409);
    expect(intent(game, a.clientID, "leave_seat").status).toBe(200);
    expect(game.gameConfig.hegemon?.seat).toBeUndefined();
    expect(game.gameInfo().throne?.seat).toBe("open");
    // And it is open to the other player now.
    expect(intent(game, b.clientID, "claim_seat").status).toBe(200);
  });

  it("refuses spectators, started games and lobbies off the thrones", () => {
    const game = throneLobby();
    const watcher = makeClient({ spectator: true });
    const player = makeClient();
    game.joinClient(watcher);
    game.joinClient(player);
    expect(intent(game, watcher.clientID, "claim_seat").status).toBe(403);

    const plain = makeGame({ config: { hegemon: { enabled: true } } });
    const p = makeClient();
    plain.joinClient(p);
    expect(intent(plain, p.clientID, "claim_seat").status).toBe(400);

    game.joinClient(makeClient());
    startGame(game);
    expect(intent(game, player.clientID, "claim_seat").status).toBe(409);
  });

  it("refuses the admin bot", () => {
    const game = throneLobby();
    const outcome = game.handleIntent(
      { type: "claim_seat" },
      {
        clientID: "ADMINBOT",
        isLobbyCreator: false,
        isAdmin: true,
        isAdminBot: true,
      },
    );
    expect(outcome.status).toBe(403);
  });

  it("keeps a reserved seat for the heir, and seats them as they arrive", () => {
    const game = throneLobby({
      ...VEGA,
      heir: HEIR,
      reservationUntil: T0 + 30_000,
    });
    const other = makeClient();
    game.joinClient(other);
    expect(game.gameInfo().throne).toMatchObject({
      seat: "reserved",
      holderName: "Ada",
      reservationUntil: T0 + 30_000,
    });
    expect(intent(game, other.clientID, "claim_seat").status).toBe(409);

    const heir = makeClient({ persistentID: HEIR.persistentID });
    game.joinClient(heir);
    expect(game.gameConfig.hegemon?.seat).toBe(heir.clientID);
    expect(game.gameInfo().throne?.seat).toBe("seated");
    // The window is shown only while it is open.
    vi.setSystemTime(T0 + 31_000);
    expect(game.gameInfo().throne?.reservationUntil).toBeUndefined();
  });

  it("opens the seat when the master says the heir stepped down or the window ran out", () => {
    const game = throneLobby({
      ...VEGA,
      heir: HEIR,
      reservationUntil: T0 + 30_000,
    });
    const heir = makeClient({ persistentID: HEIR.persistentID });
    const other = makeClient();
    game.joinClient(heir);
    game.joinClient(other);
    expect(game.gameConfig.hegemon?.seat).toBe(heir.clientID);

    game.updateThrone({ heir: null, reign: 0 });
    expect(game.gameConfig.hegemon?.seat).toBeUndefined();
    expect(game.hegemonHeirID()).toBeNull();
    expect(game.gameInfo().throne).toMatchObject({ seat: "open", reign: 0 });
    expect(game.gameInfo().throne?.holderName).toBeUndefined();
    // Anyone may claim now, the former heir included.
    expect(intent(game, other.clientID, "claim_seat").status).toBe(200);
  });

  it("keeps the heir seated with their reign when the master says they stay", () => {
    const game = throneLobby({
      ...VEGA,
      heir: HEIR,
      reservationUntil: T0 + 30_000,
    });
    const heir = makeClient({ persistentID: HEIR.persistentID });
    game.joinClient(heir);
    game.updateThrone({ heir: HEIR, reign: 3 });
    expect(game.gameConfig.hegemon?.seat).toBe(heir.clientID);
    expect(game.gameInfo().throne).toMatchObject({
      seat: "seated",
      reign: 3,
      holderName: heir.username,
    });
    expect(game.gameInfo().throne?.reservationUntil).toBeUndefined();
    // A seated-but-away heir still blocks claims (they are reseated on
    // return, SuccessorLobby tests), so nobody else may take it.
    const other = makeClient();
    game.joinClient(other);
    expect(intent(game, other.clientID, "claim_seat").status).toBe(409);
  });

  it("lets a heir who leaves the seat give up the reservation too", () => {
    const game = throneLobby({ ...VEGA, heir: HEIR });
    const heir = makeClient({ persistentID: HEIR.persistentID });
    const other = makeClient();
    game.joinClient(heir);
    game.joinClient(other);
    expect(intent(game, heir.clientID, "leave_seat").status).toBe(200);
    expect(game.hegemonHeirID()).toBeNull();
    expect(game.gameInfo().throne?.seat).toBe("open");
    expect(intent(game, other.clientID, "claim_seat").status).toBe(200);
  });

  it("stamps isHegemon from a claimed seat at start", () => {
    const game = throneLobby();
    const a = makeClient({ clientID: cid("a") });
    const b = makeClient({ clientID: cid("b") });
    game.joinClient(a);
    game.joinClient(b);
    intent(game, b.clientID, "claim_seat");
    startGame(game);
    const start = mockWsOf(a)
      .sent()
      .find((m): m is ServerStartGameMessage => m.type === "start");
    expect(
      start!.gameStartInfo.players.map((p) => [
        p.clientID,
        p.isHegemon ?? false,
      ]),
    ).toEqual([
      [a.clientID, false],
      [b.clientID, true],
    ]);
  });
});

describe("GameServer - the winner's pick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  async function finishedRound() {
    const picks: ThronePickReport[] = [];
    const game = makeGame({
      publicGameType: "throne",
      config: { hegemon: { enabled: true } },
      deps: { thronePick: (p) => picks.push(p) },
    });
    game.setThrone(VEGA);
    const winner = makeClient({ persistentID: "winner-pid" });
    const loser = makeClient({ persistentID: "loser-pid" });
    game.joinClient(winner);
    game.joinClient(loser);
    startGame(game);
    const vote = {
      type: "winner",
      winner: ["player", winner.clientID],
      allPlayersStats: {},
    } as const;
    await mockWsOf(winner).emit(vote as any);
    await mockWsOf(loser).emit(vote as any);
    return { game, winner, loser, picks };
  }

  it("relays the winner's pick once, with their identity", async () => {
    const { game, winner, picks } = await finishedRound();
    await mockWsOf(winner).emit({
      type: "throne_pick",
      gameMap: GameMapType.EventHorizon,
      stay: true,
    });
    expect(picks).toEqual([
      {
        throneID: "throne-01",
        gameID: game.id,
        persistentID: "winner-pid",
        gameMap: GameMapType.EventHorizon,
        stay: true,
      },
    ]);
    // Changing their mind is not allowed: the first answer stands.
    await mockWsOf(winner).emit({ type: "throne_pick", stay: false });
    expect(picks).toHaveLength(1);
  });

  it("ignores a pick from anyone but the winner, and before the vote resolves", async () => {
    const { loser, picks } = await finishedRound();
    await mockWsOf(loser).emit({ type: "throne_pick", stay: true });
    expect(picks).toEqual([]);

    const early: ThronePickReport[] = [];
    const game = makeGame({
      publicGameType: "throne",
      deps: { thronePick: (p) => early.push(p) },
    });
    game.setThrone(VEGA);
    const a = makeClient();
    game.joinClient(a);
    game.joinClient(makeClient());
    startGame(game);
    await mockWsOf(a).emit({ type: "throne_pick", stay: true });
    expect(early).toEqual([]);
  });

  it("does nothing for a game off the thrones", async () => {
    const picks: ThronePickReport[] = [];
    const game = makeGame({ deps: { thronePick: (p) => picks.push(p) } });
    const a = makeClient();
    const b = makeClient();
    game.joinClient(a);
    game.joinClient(b);
    startGame(game);
    const vote = {
      type: "winner",
      winner: ["player", a.clientID],
      allPlayersStats: {},
    } as const;
    await mockWsOf(a).emit(vote as any);
    await mockWsOf(b).emit(vote as any);
    await mockWsOf(a).emit({ type: "throne_pick", stay: true });
    expect(picks).toEqual([]);
  });

  // L30: the team split rides the pick like the modifiers do; the master
  // decides whether the throne may set it.
  it("forwards the team split of a team pick", async () => {
    const { winner, picks } = await finishedRound();
    await mockWsOf(winner).emit({
      type: "throne_pick",
      playerTeams: "Duos",
      stay: true,
    });
    expect(picks[0]).toMatchObject({ playerTeams: "Duos", stay: true });
  });

  it("forwards the modifiers of a special pick", async () => {
    const { winner, picks } = await finishedRound();
    await mockWsOf(winner).emit({
      type: "throne_pick",
      modifiers: ["isCompact", "goldMultiplier"],
      stay: true,
    });
    expect(picks[0]).toMatchObject({
      modifiers: ["isCompact", "goldMultiplier"],
      stay: true,
    });
  });
});
