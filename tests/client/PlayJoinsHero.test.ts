import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import { GameMapType, GameMode } from "../../src/core/game/Game";
import type {
  GameConfig,
  PublicGameInfo,
  PublicGames,
  ThroneType,
} from "../../src/core/Schemas";

// Same socket stand-in as TrustedJoinGate: keep the update callback so a
// lobby snapshot can be pushed in and the hero card rendered.
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

// Registers <game-mode-selector>, <desktop-nav-bar> and <mobile-nav-bar> as
// side effects. The selector's class is only used as a type below, so the
// bare import is what actually loads (and registers) it.
import "../../src/client/components/DesktopNavBar";
import "../../src/client/components/MobileNavBar";
import "../../src/client/components/NavUtilityIcons";
import "../../src/client/GameModeSelector";
import type { GameModeSelector } from "../../src/client/GameModeSelector";
import { initNavigation } from "../../src/client/Navigation";

// jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

type Mountable = HTMLElement & { updateComplete: Promise<unknown> };

function throne(
  gameID: string,
  running = false,
  type: ThroneType = "ffa",
): PublicGameInfo {
  return {
    gameID,
    numClients: 3,
    publicGameType: "throne",
    throne: {
      throneID: gameID,
      name: gameID,
      type,
      reign: 0,
      seat: "open",
      running,
    },
    gameConfig: {
      gameMap: GameMapType.EventHorizon,
      gameMode: GameMode.FFA,
      maxPlayers: 8,
    } as unknown as GameConfig,
  };
}

let selector: GameModeSelector;
let joinLobby: ReturnType<typeof vi.fn>;

async function mount(tag: string): Promise<Mountable> {
  const el = document.createElement(tag) as Mountable;
  document.body.appendChild(el);
  await el.updateComplete;
  const child = el.querySelector("nav-utility-icons") as Mountable | null;
  if (child !== null) await child.updateComplete;
  return el;
}

async function pushThrones(...thrones: PublicGameInfo[]): Promise<void> {
  lobbiesCallbackRef.current?.({
    serverTime: Date.now(),
    games: { throne: thrones },
  });
  await selector.updateComplete;
}

const joinedGameId = () =>
  (joinLobby.mock.calls[0]?.[0] as CustomEvent | undefined)?.detail?.gameID;

beforeEach(async () => {
  window.BOOTSTRAP_CONFIG = {
    gameEnv: "dev",
    numWorkers: 1,
    turnstileSiteKey: "",
    jwtAudience: "test",
    instanceId: "test",
    gitCommit: "test",
  };
  ClientEnv.reset();
  window.currentPageId = "page-play";
  joinLobby = vi.fn();
  document.addEventListener("join-lobby", joinLobby as EventListener);
  lobbiesCallbackRef.current = null;
  selector = (await mount("game-mode-selector")) as unknown as GameModeSelector;
});

afterEach(() => {
  document.removeEventListener("join-lobby", joinLobby as EventListener);
  document.body.innerHTML = "";
  window.BOOTSTRAP_CONFIG = undefined;
  ClientEnv.reset();
  vi.restoreAllMocks();
});

describe("GameModeSelector.joinHeroLobby", () => {
  it("joins the throne the hero card shows", async () => {
    await pushThrones(throne("first"), throne("second"));
    expect(selector.joinHeroLobby()).toBe(true);
    expect(joinLobby).toHaveBeenCalledTimes(1);
    expect(joinedGameId()).toBe("first");
  });

  // L38: the steering button. Rooms about to launch first, then the round
  // running longest (dropped into as a pirate), then lobbies with players.
  it("prefers a room about to launch, then the round running longest (L38)", async () => {
    const counting = { ...throne("counting"), startsAt: Date.now() + 30_000 };
    await pushThrones(throne("running", true), counting, throne("open"));
    expect(selector.joinHeroLobby()).toBe(true);
    expect(joinedGameId()).toBe("counting");
    joinLobby.mockClear();
    await pushThrones(throne("open"), throne("running", true));
    expect(selector.joinHeroLobby()).toBe(true);
    expect(joinedGameId()).toBe("running");
  });

  it("does nothing before any throne is on screen", () => {
    expect(selector.joinHeroLobby()).toBe(false);
    expect(joinLobby).not.toHaveBeenCalled();
  });

  it("steers across modes, the team room included", async () => {
    await pushThrones(throne("team-room", false, "team"));
    expect(selector.joinHeroLobby()).toBe(true);
    expect(joinedGameId()).toBe("team-room");
  });

  it("never steers into a full room", async () => {
    const full = { ...throne("full"), numClients: 8 };
    await pushThrones(full);
    expect(selector.joinHeroLobby()).toBe(false);
    expect(joinLobby).not.toHaveBeenCalled();
  });
});

// The nav bar's Play item is routed by Navigation.ts like every other
// .nav-menu-item[data-page]; data-join-hero is what makes it also hop into
// the top game once home (2026-10-08).
describe("the nav bar's Play item", () => {
  beforeEach(() => {
    initNavigation();
  });

  for (const tag of ["desktop-nav-bar", "mobile-nav-bar"]) {
    it(`${tag}: joins the hero throne on click`, async () => {
      const bar = await mount(tag);
      await pushThrones(throne("top"));
      const play = bar.querySelector<HTMLElement>(
        '.nav-menu-item[data-page="page-play"][data-join-hero]',
      );
      expect(play).not.toBeNull();
      play!.click();
      await selector.updateComplete;
      expect(joinedGameId()).toBe("top");
      // Still a nav item: routing home happened too.
      expect(window.currentPageId).toBe("page-play");
    });
  }

  it("routes home without joining when no throne is on screen", async () => {
    const bar = await mount("desktop-nav-bar");
    bar
      .querySelector<HTMLElement>('.nav-menu-item[data-page="page-play"]')!
      .click();
    await selector.updateComplete;
    expect(joinLobby).not.toHaveBeenCalled();
    expect(window.currentPageId).toBe("page-play");
  });
});
