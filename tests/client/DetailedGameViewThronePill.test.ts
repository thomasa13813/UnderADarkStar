import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameMapType, GameMode } from "../../src/core/game/Game";
import type {
  GameConfig,
  PublicGameInfo,
  PublicGames,
} from "../../src/core/Schemas";

// Same socket stand-in as DetailedGameViewPanes: keep the update callback so
// a lobby snapshot can be pushed in and the cards rendered.
const { lobbiesCallbackRef } = vi.hoisted(() => ({
  lobbiesCallbackRef: { current: null as ((g: PublicGames) => void) | null },
}));

vi.mock("../../src/client/LobbySocket", () => ({
  PublicLobbySocket: class {
    constructor(onUpdate: (g: PublicGames) => void) {
      lobbiesCallbackRef.current = onUpdate;
    }
    start(): void {}
    stop(): void {}
  },
}));

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, args?: Record<string, string | number>) =>
    args ? `${key}:${Object.values(args).join(",")}` : key,
}));

import "../../src/client/components/DetailedGameViewModal";
import type { DetailedGameViewModal } from "../../src/client/components/DetailedGameViewModal";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

type Modal = DetailedGameViewModal & { updateComplete: Promise<unknown> };

// Under a Dark Star (docs/DarkStar-Lobbies.md §14): a room card's pill in the
// lobby browser. A room waits for players, then counts down (L34); one whose
// winner is still choosing says so; a running round is watched. No place in
// line (§14.7).

function throne(
  gameID: string,
  extra: Partial<NonNullable<PublicGameInfo["throne"]>> = {},
  startsAt?: number,
): PublicGameInfo {
  return {
    gameID,
    numClients: 3,
    publicGameType: "throne",
    startsAt,
    throne: {
      throneID: gameID,
      name: gameID,
      type: "ffa",
      reign: 0,
      seat: "open",
      ...extra,
    },
    gameConfig: {
      gameMap: GameMapType.EventHorizon,
      gameMode: GameMode.FFA,
      maxPlayers: 8,
    } as unknown as GameConfig,
  };
}

let modal: Modal;

async function push(games: PublicGames["games"]): Promise<void> {
  lobbiesCallbackRef.current?.({ serverTime: Date.now(), games });
  await modal.updateComplete;
}

const cardText = (gameID: string) =>
  modal
    .querySelector(`[data-lobby-slot="${gameID}"]`)
    ?.textContent?.replace(/\s+/g, " ") ?? "";

beforeEach(async () => {
  lobbiesCallbackRef.current = null;
  document.body.innerHTML = "<detailed-view-modal></detailed-view-modal>";
  modal = document.querySelector("detailed-view-modal") as Modal;
  await modal.updateComplete;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("room cards in the lobby browser", () => {
  it("rooms wait for players, a deciding one says so, none has a place", async () => {
    await push({
      throne: [
        throne("first"),
        throne("second"),
        throne("deciding", { reservationUntil: Date.now() + 20_000 }),
      ],
    });
    expect(cardText("first")).toContain("public_lobby.waiting_for_players");
    expect(cardText("second")).toContain("public_lobby.waiting_for_players");
    expect(cardText("deciding")).toContain("throne.choosing");
  });

  it("a counting-down room shows its countdown, a running round its Watch", async () => {
    await push({
      throne: [
        throne("counting", {}, Date.now() + 90_000),
        throne("running", { running: true }),
      ],
    });
    expect(cardText("counting")).not.toContain("waiting_for_players");
    expect(cardText("running")).toContain("throne.watch");
  });
});
