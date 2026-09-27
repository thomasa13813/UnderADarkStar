import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCosmetics } from "../../../../src/client/Cosmetics";
import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";
import { SendWinnerEvent } from "../../../../src/client/Transport";
import type { GameView } from "../../../../src/client/view";
import { EventBus } from "../../../../src/core/EventBus";
import { GameType } from "../../../../src/core/game/Game";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  getGamesPlayed: vi.fn(() => 10),
  isInIframe: vi.fn(() => false),
  homeHref: vi.fn(() => "/"),
  TUTORIAL_VIDEO_URL: "https://example.com/tutorial",
}));

vi.mock("../../../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => null),
}));

vi.mock("../../../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../src/client/Cosmetics")
  >()),
  fetchCosmetics: vi.fn(async () => null),
  resolveCosmetics: vi.fn(() => []),
}));

type Winner = ["team", string] | ["player", string] | undefined;

function makeGame(opts: {
  winner: Winner;
  myTeam?: string;
  myClientID?: string;
  gameID?: string;
  // Defaults to a game the server archives -- a public multiplayer match,
  // not a replay of one -- because that is the only kind with achievements
  // to sync.
  gameType?: GameType;
  isReplay?: boolean;
  // How many Win updates a single tick carries. Defaults to one; 0 is a tick
  // with no win at all.
  winUpdateCount?: number;
  winnerPlayer?: {
    isPlayer: () => boolean;
    isHegemon: () => boolean;
    clientID: () => string | null;
    displayName: () => string;
  };
}): GameView {
  const winUpdate = { winner: opts.winner, allPlayersStats: {} };
  const winUpdates = Array.from(
    { length: opts.winUpdateCount ?? 1 },
    () => winUpdate,
  );
  return {
    myPlayer: () => ({
      isAlive: () => true,
      isHegemon: () => false,
      hasSpawned: () => true,
      team: () => opts.myTeam ?? null,
      clientID: () => opts.myClientID ?? null,
    }),
    inSpawnPhase: () => false,
    updatesSinceLastTick: () => ({ [GameUpdateType.Win]: winUpdates }),
    playerByClientID: () => opts.winnerPlayer,
    config: () => ({
      gameConfig: () => ({
        rankedType: undefined,
        gameType: opts.gameType ?? GameType.Public,
      }),
      isReplay: () => opts.isReplay ?? false,
    }),
    gameID: () => opts.gameID ?? "game-abc-123",
  } as unknown as GameView;
}

describe("WinModal tick win handling", () => {
  let modal: WinModal | undefined;

  function setup(game: GameView) {
    const eventBus = new EventBus();
    const winnerEvents: SendWinnerEvent[] = [];
    eventBus.on(SendWinnerEvent, (e) => winnerEvents.push(e));
    modal = document.createElement("win-modal") as WinModal;
    modal.game = game;
    modal.eventBus = eventBus;
    return winnerEvents;
  }

  afterEach(() => {
    modal?.remove();
    modal = undefined;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("emits the winner when my team wins", async () => {
    const events = setup(
      makeGame({ winner: ["team", "Blue"], myTeam: "Blue" }),
    );
    modal!.tick();

    expect(events).toHaveLength(1);
    expect(events[0].winner).toEqual(["team", "Blue"]);
    await vi.waitFor(() => expect(modal!.isVisible).toBe(true));
  });

  it("emits the winner when another team wins", async () => {
    const events = setup(makeGame({ winner: ["team", "Red"], myTeam: "Blue" }));
    modal!.tick();

    expect(events).toHaveLength(1);
    expect(events[0].winner).toEqual(["team", "Red"]);
    await vi.waitFor(() => expect(modal!.isVisible).toBe(true));
  });

  it("emits a player winner resolved through playerByClientID", async () => {
    const events = setup(
      makeGame({
        winner: ["player", "winner-client"],
        myClientID: "my-client",
        winnerPlayer: {
          isPlayer: () => true,
          isHegemon: () => false,
          clientID: () => "winner-client",
          displayName: () => "Bob",
        },
      }),
    );
    modal!.tick();

    expect(events).toHaveLength(1);
    expect(events[0].winner).toEqual(["player", "winner-client"]);
    await vi.waitFor(() => expect(modal!.isVisible).toBe(true));
  });

  it("emits the winner when the winning client is me", async () => {
    setup(
      makeGame({
        winner: ["player", "my-client"],
        myClientID: "my-client",
        winnerPlayer: {
          isPlayer: () => true,
          isHegemon: () => false,
          clientID: () => "my-client",
          displayName: () => "Me",
        },
      }),
    );
    modal!.tick();

    await vi.waitFor(() => expect(modal!.isVisible).toBe(true));
  });

  it("emits a winnerless result when the match is cancelled", async () => {
    const events = setup(makeGame({ winner: undefined }));
    modal!.tick();

    expect(events).toHaveLength(1);
    expect(events[0].winner).toBeUndefined();
    await vi.waitFor(() => expect(modal!.isVisible).toBe(true));
  });

  it("shows the buttons as soon as show() runs, before the cosmetics fetch settles", async () => {
    // jsdom has no ResizeObserver.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.mocked(fetchCosmetics).mockReturnValueOnce(new Promise(() => {}));
    setup(makeGame({ winner: ["team", "Blue"], myTeam: "Blue" }));
    document.body.appendChild(modal!);

    void modal!.show();
    await modal!.updateComplete;

    expect(modal!.isVisible).toBe(true);
    const exit = modal!.querySelector(
      "o-button[translationKey='win_modal.exit']",
    );
    expect(exit).not.toBeNull();
    expect(exit!.parentElement!.classList.contains("hidden")).toBe(false);
  });

  it("ignores a player win whose winner is not a known player", () => {
    const events = setup(
      makeGame({ winner: ["player", "gone"], winnerPlayer: undefined }),
    );
    modal!.tick();

    expect(events).toHaveLength(0);
    expect(modal!.isVisible).toBe(false);
  });
});
