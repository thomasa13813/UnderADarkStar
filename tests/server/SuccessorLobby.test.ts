import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameMapType, GameMode } from "../../src/core/game/Game";
import { successorConfig } from "../../src/server/SuccessorLobby";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";
import { testGameConfig } from "../util/Wire";

// Under a Dark Star, P0 step 2: "New lobby" from the win screen inherits the
// round's settings and seats the round's winner (the heir) on the throne as
// they arrive.
describe("successorConfig", () => {
  it("keeps the round's settings but not the old lobby's identities", () => {
    const previous = testGameConfig({
      gameMap: GameMapType.EventHorizon,
      gameMode: GameMode.FFA,
      maxTimerValue: 25,
      bots: 12,
      anonymizeNames: true,
      nameReveals: ["c1000000"],
      hegemon: { enabled: true, seat: "c1000000" },
    });
    const next = successorConfig(previous);
    expect(next.gameMap).toBe(GameMapType.EventHorizon);
    expect(next.maxTimerValue).toBe(25);
    expect(next.bots).toBe(12);
    expect(next.anonymizeNames).toBe(true);
    expect(next.nameReveals).toBeUndefined();
    expect(next.hegemon).toEqual({ enabled: true });
  });

  it("carries no throne when the round had none", () => {
    expect(successorConfig(testGameConfig()).hegemon).toBeUndefined();
  });
});

describe("GameServer - the heir to the throne", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it("names the winning client, and nobody when a nation won", async () => {
    const game = makeGame();
    const alice = makeClient({ persistentID: "alice-pid", ip: "1.1.1.1" });
    const bob = makeClient({ persistentID: "bob-pid", ip: "2.2.2.2" });
    game.joinClient(alice);
    game.joinClient(bob);
    startGame(game);
    expect(game.winnerPersistentID()).toBeNull();
    for (const c of [alice, bob]) {
      await mockWsOf(c).emit({
        type: "winner",
        winner: ["player", bob.clientID],
        allPlayersStats: {},
      });
    }
    expect(game.winnerPersistentID()).toBe("bob-pid");

    const aiRound = makeGame();
    const carol = makeClient({ persistentID: "carol-pid", ip: "3.3.3.3" });
    aiRound.joinClient(carol);
    startGame(aiRound);
    await mockWsOf(carol).emit({
      type: "winner",
      winner: ["nation", "The Hegemon"],
      allPlayersStats: {},
    });
    expect(aiRound.winnerPersistentID()).toBeNull();
  });

  it("seats the heir as they arrive, and nobody else", () => {
    const game = makeGame({ config: { hegemon: { enabled: true } } });
    game.setHegemonHeir("heir-pid");
    const other = makeClient({ persistentID: "other-pid" });
    game.joinClient(other);
    expect(game.gameConfig.hegemon?.seat).toBeUndefined();
    const heir = makeClient({ persistentID: "heir-pid" });
    game.joinClient(heir);
    expect(game.gameConfig.hegemon?.seat).toBe(heir.clientID);
  });

  it("does not displace a player the creator already seated", () => {
    const game = makeGame({ config: { hegemon: { enabled: true } } });
    game.setHegemonHeir("heir-pid");
    const chosen = makeClient({ persistentID: "chosen-pid" });
    game.joinClient(chosen);
    game.updateGameConfig({
      hegemon: { enabled: true, seat: chosen.clientID },
    });
    const heir = makeClient({ persistentID: "heir-pid" });
    game.joinClient(heir);
    expect(game.gameConfig.hegemon?.seat).toBe(chosen.clientID);
  });

  it("is not seated when the throne is off", () => {
    const game = makeGame({ config: { hegemon: { enabled: false } } });
    game.setHegemonHeir("heir-pid");
    game.joinClient(makeClient({ persistentID: "heir-pid" }));
    expect(game.gameConfig.hegemon?.seat).toBeUndefined();
  });

  it("unseats a player who left, and re-seats a returning heir", async () => {
    const game = makeGame({ config: { hegemon: { enabled: true } } });
    game.setHegemonHeir("heir-pid");
    game.joinClient(makeClient({ persistentID: "host-pid" }));
    const heir = makeClient({ persistentID: "heir-pid" });
    game.joinClient(heir);
    expect(game.gameConfig.hegemon?.seat).toBe(heir.clientID);

    await mockWsOf(heir).trigger("close");
    vi.advanceTimersByTime(1000); // the next lobby info reconciles the seat
    expect(game.gameConfig.hegemon?.seat).toBeUndefined();

    const back = makeClient({
      clientID: cid("back"),
      persistentID: "heir-pid",
    });
    game.joinClient(back);
    expect(game.gameConfig.hegemon?.seat).toBe(back.clientID);
  });
});
