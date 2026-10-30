import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameMapType } from "../../src/core/game/Game";
import { ServerPrestartMessage } from "../../src/core/Schemas";
import { applyGameConfigPatch } from "../../src/server/ConfigPatch";
import { GameManager } from "../../src/server/GameManager";
import {
  makeClient,
  makeGame,
  mockLogger,
  mockWsOf,
} from "../util/GameServerHarness";
import { testGameConfig } from "../util/Wire";

// Under a Dark Star: the throne is the game. No lobby can turn it off, and a
// random map is the server's pick at prestart so the host and the guests see
// the same "Random" until then.
describe("the throne is always on", () => {
  it("cannot be turned off by a host's patch", () => {
    const target = testGameConfig({ hegemon: { enabled: true } });
    applyGameConfigPatch(target, { hegemon: { enabled: false } });
    expect(target.hegemon).toEqual({ enabled: true });
    applyGameConfigPatch(target, { hegemon: { enabled: false, seat: "c1" } });
    expect(target.hegemon).toEqual({ enabled: true, seat: "c1" });
    // A patch without a seat clears one.
    applyGameConfigPatch(target, { hegemon: { enabled: true } });
    expect(target.hegemon).toEqual({ enabled: true });
  });

  it("is on, and timed, in every new private lobby", () => {
    const gm = new GameManager(mockLogger());
    const game = gm.createGame("aTestGame1", undefined, "creator-pid");
    expect(game?.gameConfig.hegemon).toEqual({ enabled: true });
    expect(game?.gameConfig.maxTimerValue).toBe(15);
  });
});

describe("a random map", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it("is picked by the server at prestart and told to the clients", () => {
    const game = makeGame({
      config: { gameMap: GameMapType.EventHorizon, randomMap: true },
    });
    const client = makeClient();
    game.joinClient(client);
    const maps = Object.values(GameMapType);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    game.prestart();
    const picked = maps[Math.floor(0.5 * maps.length)];
    expect(game.gameConfig.gameMap).toBe(picked);
    const prestart = mockWsOf(client)
      .sent()
      .find((m): m is ServerPrestartMessage => m.type === "prestart");
    expect(prestart?.gameMap).toBe(picked);
  });

  it("leaves a chosen map alone", () => {
    const game = makeGame({
      config: { gameMap: GameMapType.EventHorizon, randomMap: false },
    });
    game.joinClient(makeClient());
    game.prestart();
    expect(game.gameConfig.gameMap).toBe(GameMapType.EventHorizon);
  });
});
