import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Duos, GameMode, GameType, Trios } from "../../src/core/game/Game";
import { GameConfig, TeamCountConfig } from "../../src/core/Schemas";
import { Client } from "../../src/server/Client";
import { GameServer } from "../../src/server/GameServer";
import {
  cid,
  makeClient,
  makeGame,
  mockLogger,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// Under a Dark Star: in a private team lobby a player clicks a team's card to
// join it. The pick rides PlayerInfo.teamIndex into the simulation; public
// lobbies take no picks and always balance at the start.
describe("GameServer - team picks", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const teamGame = (
    playerTeams: TeamCountConfig,
    config: Partial<GameConfig> = {},
  ) =>
    makeGame({
      log: mockLogger(),
      config: {
        gameType: GameType.Private,
        gameMode: GameMode.Team,
        playerTeams,
        nations: "disabled",
        ...config,
      },
    });

  const join = (game: GameServer, ...ids: string[]): Client[] =>
    ids.map((id) => {
      const c = makeClient({ clientID: cid(id) });
      game.joinClient(c);
      return c;
    });

  const pick = (c: Client, teamIndex: number) =>
    mockWsOf(c).emit({ type: "team_pick", teamIndex });

  const lobbyTeam = (game: GameServer, id: string) =>
    game.gameInfo().clients?.find((c) => c.clientID === cid(id))?.teamIndex;

  const startTeams = (game: GameServer, observer: Client) => {
    startGame(game);
    const start = mockWsOf(observer)
      .sent()
      .find((m) => m.type === "start");
    if (start?.type !== "start") throw new Error("no start message");
    return new Map(
      start.gameStartInfo.players.map((p) => [p.clientID, p.teamIndex]),
    );
  };

  it("pins the picked team into the start info", async () => {
    const game = teamGame(2);
    const [a, b] = join(game, "a", "b", "c");
    await pick(a, 1);
    await pick(b, 1);
    const teams = startTeams(game, a);
    expect(teams.get(cid("a"))).toBe(1);
    expect(teams.get(cid("b"))).toBe(1);
    // Nobody picked for c: the balancer places them at the start.
    expect(teams.get(cid("c"))).toBeUndefined();
  });

  it("shows the pick on the lobby roster for the team preview", async () => {
    const game = teamGame(2);
    const [a] = join(game, "a", "b");
    await pick(a, 1);
    expect(lobbyTeam(game, "a")).toBe(1);
    expect(lobbyTeam(game, "b")).toBeUndefined();
  });

  it("lets a player move to another team", async () => {
    const game = teamGame(2);
    const [a] = join(game, "a", "b");
    await pick(a, 0);
    await pick(a, 1);
    expect(lobbyTeam(game, "a")).toBe(1);
  });

  it("refuses a fourth player on a Trios team", async () => {
    const game = teamGame(Trios);
    const players = join(game, "a", "b", "c", "d", "e", "f");
    for (const p of players.slice(0, 4)) await pick(p, 0);
    expect(lobbyTeam(game, "c")).toBe(0);
    expect(lobbyTeam(game, "d")).toBeUndefined();
    // Room on the other team.
    await pick(players[3], 1);
    expect(lobbyTeam(game, "d")).toBe(1);
  });

  it("has no size cap when the mode sets a team count", async () => {
    const game = teamGame(2);
    const players = join(game, "a", "b", "c", "d");
    for (const p of players) await pick(p, 0);
    for (const id of ["a", "b", "c", "d"]) expect(lobbyTeam(game, id)).toBe(0);
  });

  it("refuses a team that does not exist", async () => {
    const game = teamGame(2);
    const [a] = join(game, "a", "b");
    await pick(a, 2);
    expect(lobbyTeam(game, "a")).toBeUndefined();
  });

  it("takes no picks in a public lobby", async () => {
    const game = teamGame(2, { gameType: GameType.Public });
    const [a] = join(game, "a", "b");
    await pick(a, 1);
    expect(lobbyTeam(game, "a")).toBeUndefined();
  });

  it("takes no picks in Humans vs Lords or FFA", async () => {
    const hvn = teamGame("Humans Vs Nations");
    const [a] = join(hvn, "a", "b");
    await pick(a, 0);
    expect(lobbyTeam(hvn, "a")).toBeUndefined();

    const ffa = teamGame(2, { gameMode: GameMode.FFA });
    const [f] = join(ffa, "f", "g");
    await pick(f, 0);
    expect(lobbyTeam(ffa, "f")).toBeUndefined();
  });

  it("takes no pick from a spectator", async () => {
    const game = teamGame(2);
    join(game, "a");
    const cast = makeClient({ clientID: cid("cast"), spectator: true });
    game.joinClient(cast);
    await pick(cast, 0);
    expect(lobbyTeam(game, "cast")).toBeUndefined();
  });

  it("takes no pick from the seated Hegemon", async () => {
    const game = teamGame(2, {
      hegemon: { enabled: true, seat: cid("king") },
    });
    const [king] = join(game, "king", "a", "b");
    await pick(king, 0);
    expect(lobbyTeam(game, "king")).toBeUndefined();
  });

  it("drops picks when the host changes the team split", async () => {
    const game = teamGame(2);
    const [a] = join(game, "a", "b");
    await pick(a, 1);
    game.updateGameConfig({ playerTeams: 3 });
    expect(lobbyTeam(game, "a")).toBeUndefined();
  });

  it("drops the pick of a player who goes to watch", async () => {
    // Kept, it would come back on reseating ahead of the pair who filled
    // the duo meanwhile.
    const game = teamGame(Duos);
    const [a, b, c] = join(game, "a", "b", "c", "d");
    await pick(a, 0);
    await mockWsOf(a).emit({ type: "spectate", spectator: true });
    await pick(b, 0);
    await pick(c, 0);
    await mockWsOf(a).emit({ type: "spectate", spectator: false });
    expect(lobbyTeam(game, "b")).toBe(0);
    expect(lobbyTeam(game, "c")).toBe(0);
    expect(lobbyTeam(game, "a")).toBeUndefined();
  });

  it("drops the pick of a player seated on the throne", async () => {
    const game = teamGame(2, { hegemon: { enabled: true } });
    const [a] = join(game, "a", "b", "c");
    await pick(a, 0);
    game.updateGameConfig({ hegemon: { enabled: true, seat: cid("a") } });
    game.updateGameConfig({ hegemon: { enabled: true } });
    expect(lobbyTeam(game, "a")).toBeUndefined();
  });

  it("keeps a full team full when picks race", async () => {
    // The cap is checked when picks are read too, oldest pick first, so a
    // pick can never overfill a team even if it slipped past the check.
    const game = teamGame(Duos);
    const [a, b, c] = join(game, "a", "b", "c", "d");
    await pick(a, 0);
    await pick(b, 0);
    await pick(c, 0);
    expect(lobbyTeam(game, "c")).toBeUndefined();
  });

  it("ignores picks after the start", async () => {
    const game = teamGame(2);
    const [a] = join(game, "a", "b");
    startGame(game);
    await pick(a, 1);
    expect(lobbyTeam(game, "a")).toBeUndefined();
  });
});
