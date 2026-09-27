import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameMode } from "../../src/core/game/Game";
import { GameConfig, ServerStartGameMessage } from "../../src/core/Schemas";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// Under a Dark Star, P0: in a private lobby the creator seats one player on
// the throne (gameConfig.hegemon.seat, a clientID). At start that player, and
// only that player, carries isHegemon into the game start info — the sim's
// seat (GameImpl.seatHegemon). Nobody seated, or the seated client gone, means
// the AI holds it (R6).
describe("GameServer - the Hegemon seat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  function startPlayers(config: Partial<GameConfig>, clientIDs: string[]) {
    const game = makeGame({ config });
    const clients = clientIDs.map((clientID) => makeClient({ clientID }));
    for (const c of clients) game.joinClient(c);
    startGame(game);
    const start = mockWsOf(clients[0])
      .sent()
      .find((m): m is ServerStartGameMessage => m.type === "start");
    expect(start).toBeDefined();
    return start!.gameStartInfo.players;
  }

  it("flags the seated client, and only them", () => {
    const throne = cid("throne");
    const other = cid("other");
    const players = startPlayers({ hegemon: { enabled: true, seat: throne } }, [
      other,
      throne,
    ]);
    expect(players.map((p) => [p.clientID, p.isHegemon ?? false])).toEqual([
      [other, false],
      [throne, true],
    ]);
  });

  it("seats nobody when no seat was chosen or the seated client left", () => {
    const a = cid("a");
    const b = cid("b");
    for (const hegemon of [
      { enabled: true },
      { enabled: true, seat: cid("gone") },
    ]) {
      const players = startPlayers({ hegemon }, [a, b]);
      expect(players.every((p) => p.isHegemon !== true)).toBe(true);
    }
  });

  it("ignores the seat when the throne is off or the mode is not FFA", () => {
    const a = cid("a");
    const b = cid("b");
    const off = startPlayers({ hegemon: { enabled: false, seat: a } }, [a, b]);
    expect(off.every((p) => p.isHegemon !== true)).toBe(true);
    const team = startPlayers(
      {
        hegemon: { enabled: true, seat: a },
        gameMode: GameMode.Team,
        playerTeams: 2,
      },
      [a, b],
    );
    expect(team.every((p) => p.isHegemon !== true)).toBe(true);
  });
});
