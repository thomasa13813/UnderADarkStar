import { afterEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../../../src/core/game/Game";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";

vi.mock("../../../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/client/Utils")>()),
  translateText: (key: string) => key,
  homeHref: () => "/",
}));

vi.mock("../../../../src/client/Auth", () => ({
  isLoggedIn: vi.fn(async () => false),
}));

vi.mock("../../../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => false),
  fetchUserMeUncached: vi.fn(async () => false),
}));

vi.mock("../../../../src/client/LobbySocket", () => ({
  PublicLobbySocket: class {
    start(): void {}
    stop(): void {}
  },
}));

import type { ReignPrompt } from "../../../../src/client/hud/layers/ReignPrompt";
import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";
import { setCurrentThrone } from "../../../../src/client/ThroneState";
import type { GameView } from "../../../../src/client/view";
import { EventBus } from "../../../../src/core/EventBus";

// Under a Dark Star (docs/DarkStar-Accounts.md §6, accounts step B5): the
// win screen carries the reign prompt for the player the round credits, on
// a throne round only: the slayer, or the Hegemon holding to the timer. The
// overthrown Hegemon, a bystander, a slayer's teammate and anyone off a
// throne round get none.

const VEGA = {
  throneID: "throne-vega",
  name: "Vega",
  type: "ffa" as const,
  reign: 0,
  seat: "open" as const,
};

function game(opts: {
  winner: string;
  me: string;
  meHegemon?: boolean;
  winnerHegemon?: boolean;
  meAlive?: boolean;
  myTeam?: string | null;
  winnerTeam?: string | null;
}): GameView {
  const winUpdate = {
    winner: ["player", opts.winner] as ["player", string],
    allPlayersStats: {},
  };
  return {
    myPlayer: () => ({
      isAlive: () => opts.meAlive ?? true,
      isHegemon: () => opts.meHegemon ?? false,
      hasSpawned: () => true,
      isLobbyCreator: () => false,
      team: () => opts.myTeam ?? null,
      clientID: () => opts.me,
    }),
    inSpawnPhase: () => false,
    updatesSinceLastTick: () => ({ [GameUpdateType.Win]: [winUpdate] }),
    playerByClientID: () => ({
      isPlayer: () => true,
      isHegemon: () => opts.winnerHegemon ?? false,
      clientID: () => opts.winner,
      displayName: () => "Winner",
      team: () => opts.winnerTeam ?? null,
    }),
    config: () => ({
      gameConfig: () => ({ gameType: GameType.Public }),
      isReplay: () => false,
    }),
    gameID: () => "game-1",
  } as unknown as GameView;
}

let modal: WinModal | undefined;

async function winScreen(view: GameView): Promise<ReignPrompt> {
  modal = document.createElement("win-modal") as WinModal;
  modal.game = view;
  modal.eventBus = new EventBus();
  modal.init();
  document.body.append(modal);
  modal.tick();
  await modal.updateComplete;
  return modal.querySelector("reign-prompt") as ReignPrompt;
}

afterEach(() => {
  modal?.remove();
  modal = undefined;
  setCurrentThrone(undefined);
});

describe("the win screen's reign prompt", () => {
  it("is active for the slayer on a throne round", async () => {
    setCurrentThrone(VEGA);
    const prompt = await winScreen(game({ winner: "me", me: "me" }));
    expect(modal!.isVisible).toBe(true);
    expect(prompt.active).toBe(true);
  });

  it("is active for the Hegemon who held to the timer", async () => {
    setCurrentThrone(VEGA);
    const prompt = await winScreen(
      game({ winner: "me", me: "me", meHegemon: true, winnerHegemon: true }),
    );
    expect(prompt.active).toBe(true);
  });

  it("is not for the overthrown Hegemon or a bystander", async () => {
    setCurrentThrone(VEGA);
    const overthrown = await winScreen(
      game({ winner: "them", me: "me", meHegemon: true, meAlive: false }),
    );
    expect(overthrown.active).toBe(false);
    modal!.remove();
    const bystander = await winScreen(game({ winner: "them", me: "me" }));
    expect(bystander.active).toBe(false);
  });

  it("is not for the slayer's teammate on a team throne", async () => {
    setCurrentThrone({ ...VEGA, type: "team" });
    const teammate = await winScreen(
      game({ winner: "them", me: "me", myTeam: "Blue", winnerTeam: "Blue" }),
    );
    expect(modal!.isVisible).toBe(true);
    expect(teammate.active).toBe(false);
  });

  it("is not for a win off a throne round", async () => {
    const prompt = await winScreen(game({ winner: "me", me: "me" }));
    expect(modal!.isVisible).toBe(true);
    expect(prompt.active).toBe(false);
  });
});
