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

// Under a Dark Star (docs/DarkStar-Lobbies.md L16-L19, §10.7): a throne
// card's pill in the lobby browser reads its place in the launch line. The
// head waits for players (then counts down as before); the thrones behind it
// say how many are ahead; one whose winner is still choosing says so.

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

describe("throne cards read their place in line", () => {
  it("head waits, the rest count thrones ahead, a deciding throne says so", async () => {
    await push({
      throne: [
        throne("head", { place: 1 }),
        throne("second", { place: 2 }),
        throne("fourth", { place: 4 }),
        throne("deciding", { reservationUntil: Date.now() + 20_000 }),
      ],
    });
    expect(cardText("head")).toContain("public_lobby.waiting_for_players");
    expect(cardText("second")).toContain("throne.place_ahead:1");
    expect(cardText("fourth")).toContain("throne.place_ahead:3");
    expect(cardText("deciding")).toContain("throne.choosing");
    expect(cardText("deciding")).not.toContain("place_ahead");
  });

  it("a counting-down head shows its countdown, a running round its Watch", async () => {
    await push({
      throne: [
        throne("head", { place: 1 }, Date.now() + 90_000),
        throne("running", { running: true }),
      ],
    });
    expect(cardText("head")).not.toContain("waiting_for_players");
    expect(cardText("head")).not.toContain("place_ahead");
    expect(cardText("running")).toContain("throne.watch");
  });
});
