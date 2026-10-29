import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PublicGameInfo,
  PublicGames,
  ThroneType,
} from "../../../../src/core/Schemas";

// The public-list socket stand-in: keep the update callback so snapshots can
// be pushed into the win screen, and count starts and stops.
const { lobbiesCallbackRef, socketLog } = vi.hoisted(() => ({
  lobbiesCallbackRef: { current: null as ((g: PublicGames) => void) | null },
  socketLog: [] as string[],
}));

vi.mock("../../../../src/client/LobbySocket", () => ({
  PublicLobbySocket: class {
    constructor(onUpdate: (g: PublicGames) => void) {
      lobbiesCallbackRef.current = onUpdate;
    }
    start(): void {
      socketLog.push("start");
    }
    stop(): void {
      socketLog.push("stop");
    }
  },
}));

vi.mock("../../../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/client/Utils")>()),
  translateText: (key: string, args?: Record<string, string | number>) =>
    args ? `${key}:${Object.values(args).join(",")}` : key,
  homeHref: () => "/",
}));

vi.mock("../../../../src/client/ClientEnv", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../../../../src/client/ClientEnv")>();
  return {
    ...real,
    ClientEnv: new Proxy(real.ClientEnv, {
      get: (target, key) =>
        key === "gamePath"
          ? (id: string) => `/game/${id}`
          : Reflect.get(target, key),
    }),
  };
});

vi.mock("../../../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => null),
}));

import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";
import {
  setCurrentThrone,
  setHeldForNextRound,
} from "../../../../src/client/ThroneState";
import { NewLobbyEvent } from "../../../../src/client/Transport";
import type { GameView } from "../../../../src/client/view";
import { EventBus } from "../../../../src/core/EventBus";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";

// Under a Dark Star (docs/DarkStar-Lobbies.md L36, L44, L46, L47, L48, §14.7):
// the win and death screens of a room's round. At the round's end a
// non-winner stays for the room's next round or goes to another room before
// the winner's window closes, or is sent home; a watcher held for the next
// round is placed in it at once; a winner who lets the window run out is
// sent home too. Eliminated mid-round, or arrived after the spawn phase, the
// screen lists the other rooms beside piracy. A drop-in who lands the
// killing blow ends a void round. A private lobby keeps its plain Join.

const VEGA = {
  throneID: "throne-vega",
  name: "Vega",
  type: "ffa" as ThroneType,
  reign: 0,
  seat: "open" as const,
};

function room(
  gameID: string,
  name: string,
  extra: Partial<NonNullable<PublicGameInfo["throne"]>> = {},
  lobby: Partial<PublicGameInfo> = {},
): PublicGameInfo {
  return {
    gameID,
    numClients: 1,
    publicGameType: "throne",
    gameConfig: { maxPlayers: 50 } as PublicGameInfo["gameConfig"],
    throne: {
      throneID: `throne-${name.toLowerCase()}`,
      name,
      type: "ffa",
      reign: 0,
      seat: "open",
      ...extra,
    },
    ...lobby,
  };
}

interface GameOpts {
  alive?: boolean;
  spawned?: boolean;
  piracy?: boolean;
  clientID?: string;
  joinedAfterStart?: (clientID: string) => boolean;
  updates?: unknown;
}

function game(opts: GameOpts = {}): GameView {
  const me = {
    isAlive: () => opts.alive ?? false,
    isPirate: () => false,
    isLobbyCreator: () => false,
    isHegemon: () => false,
    hasSpawned: () => opts.spawned ?? true,
    type: () => "HUMAN",
    clientID: () => opts.clientID ?? "me000000",
    team: () => null,
    pirateRespawnAt: () => 0,
  };
  return {
    myPlayer: () => me,
    config: () => ({
      piracyConfig: () => ({ enabled: opts.piracy ?? false }),
    }),
    inSpawnPhase: () => false,
    inOpening: () => false,
    ticks: () => 1000,
    roundStartTick: () => 300,
    joinedAfterStart: opts.joinedAfterStart ?? (() => false),
    playerByClientID: (id: string) => ({
      isPlayer: () => true,
      clientID: () => id,
      isHegemon: () => false,
      displayName: () => `name-${id}`,
      team: () => null,
    }),
    playerViews: () => [],
    updatesSinceLastTick: () => opts.updates ?? {},
  } as unknown as GameView;
}

// jsdom has neither observer; the winner's map picker wants both.
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let modal: WinModal;
let bus: EventBus;
let location: { href: string; origin: string; pathname: string };
const realLocation = window.location;

async function push(games: PublicGames["games"]): Promise<void> {
  lobbiesCallbackRef.current?.({ serverTime: Date.now(), games });
  await modal.updateComplete;
}

const panel = () => modal.querySelector("[data-rooms-panel]");
const mode = () => panel()?.getAttribute("data-rooms-mode") ?? null;
const roomButtons = () =>
  [...modal.querySelectorAll("[data-room]")].map((b) =>
    b.getAttribute("data-room"),
  );
const hint = () =>
  modal.querySelector("[data-rooms-panel] p")?.textContent?.trim() ?? null;
const title = () => modal.querySelector("h2")?.textContent?.trim() ?? "";

async function mount(opts: GameOpts = {}) {
  modal?.remove();
  modal = document.createElement("win-modal") as WinModal;
  modal.game = game(opts);
  modal.eventBus = bus;
  modal.init();
  document.body.append(modal);
  await modal.updateComplete;
}

beforeEach(async () => {
  vi.useFakeTimers();
  lobbiesCallbackRef.current = null;
  socketLog.length = 0;
  location = {
    href: "http://test/game/g-old",
    origin: "http://test",
    pathname: "/game/g-old",
  };
  Object.defineProperty(window, "location", {
    value: location,
    configurable: true,
  });
  vi.spyOn(history, "replaceState").mockImplementation(() => {});
  bus = new EventBus();
  await mount();
});

afterEach(() => {
  document.body.innerHTML = "";
  setCurrentThrone(undefined);
  setHeldForNextRound(false);
  Object.defineProperty(window, "location", {
    value: realLocation,
    configurable: true,
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the round's end in a room (L47)", () => {
  it("offers stay or another room, live, until the winner's window closes", async () => {
    setCurrentThrone(VEGA);
    bus.emit(new NewLobbyEvent("g-next", Date.now() + 30_000));
    await modal.updateComplete;

    expect(mode()).toBe("round_end");
    expect(modal.querySelector("[data-join-next]")).toBeNull();
    expect(socketLog).toEqual(["start"]);
    expect(
      (modal.querySelector("[data-rooms-stay]") as any)?.title ?? null,
    ).toBe("rooms.stay:Vega");
    expect(hint()).toBe("rooms.end_hint");

    await push({
      throne: [
        room("g-next", "Vega"),
        room("g-team", "Canopus", { running: true, startedAt: 1 }),
        room("g-full", "Deneb", {}, { numClients: 50 }),
        room("g-soon", "Altair", {}, { startsAt: Date.now() + 10_000 }),
      ],
    });
    // Our own room is Stay; a full room is not offered; steering order.
    expect(roomButtons()).toEqual(["g-soon", "g-team"]);

    (modal.querySelector('[data-room="g-team"]') as HTMLElement).click();
    expect(location.href).toBe("http://test/game/g-team");
  });

  it("sends a player who never answers home", async () => {
    setCurrentThrone(VEGA);
    bus.emit(new NewLobbyEvent("g-next", Date.now() + 30_000));
    await modal.updateComplete;
    vi.advanceTimersByTime(29_000);
    expect(location.href).toBe("http://test/game/g-old");
    vi.advanceTimersByTime(2_000);
    expect(location.href).toBe("/");
  });

  it("gives an AI or void round's end the same 30 s", async () => {
    setCurrentThrone(VEGA);
    bus.emit(new NewLobbyEvent("g-next"));
    await modal.updateComplete;
    expect(mode()).toBe("round_end");
    vi.advanceTimersByTime(31_000);
    expect(location.href).toBe("/");
  });

  it("places a watcher held for the next round in it at once (L48)", async () => {
    setCurrentThrone(VEGA);
    setHeldForNextRound(true);
    bus.emit(new NewLobbyEvent("g-next", Date.now() + 30_000));
    expect(location.href).toBe("http://test/game/g-next");
  });

  it("sends a winner who lets the window run out home", async () => {
    setCurrentThrone(VEGA);
    (modal as any).wonRound = true;
    bus.emit(new NewLobbyEvent("g-next", Date.now() + 30_000));
    await modal.updateComplete;
    expect(modal.querySelector("[data-throne-panel]")).not.toBeNull();
    expect(panel()).toBeNull();
    vi.advanceTimersByTime(31_000);
    expect(location.href).toBe("/");
  });

  it("keeps the plain Join button for a private lobby's successor", async () => {
    bus.emit(new NewLobbyEvent("g-private-next"));
    await modal.updateComplete;
    expect(panel()).toBeNull();
    expect(modal.querySelector("[data-join-next]")).not.toBeNull();
    expect(socketLog).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(location.href).toBe("http://test/game/g-old");
  });

  it("closes the feed with the panel", async () => {
    setCurrentThrone(VEGA);
    bus.emit(new NewLobbyEvent("g-next", Date.now() + 30_000));
    await modal.updateComplete;
    modal.hide();
    expect(socketLog).toEqual(["start", "stop"]);
  });
});

describe("the death screen in a room (L46)", () => {
  it("lists the other rooms beside piracy, Spectate and Exit", async () => {
    setCurrentThrone(VEGA);
    await mount({ piracy: true });
    modal.tick();
    await modal.updateComplete;
    expect(title()).toBe("win_modal.died");
    expect(mode()).toBe("fallen");
    expect(modal.querySelector("[data-piracy-panel]")).not.toBeNull();
    expect(hint()).toBe("rooms.fallen_hint_alone");
    await push({
      throne: [
        room("g-old", "Vega", { running: true }),
        room("g-team", "Canopus"),
      ],
    });
    expect(roomButtons()).toEqual(["g-team"]);
    expect(hint()).toBe("rooms.fallen_hint");
  });

  it("is the plain death screen off a room", async () => {
    modal.tick();
    await modal.updateComplete;
    expect(title()).toBe("win_modal.died");
    expect(panel()).toBeNull();
  });
});

describe("arriving after the spawn phase (L36)", () => {
  it("opens the arrival screen with piracy for a player who never spawned", async () => {
    setCurrentThrone(VEGA);
    await mount({ piracy: true, spawned: false });
    modal.tick();
    await modal.updateComplete;
    expect(title()).toBe("rooms.arrived_title");
    expect(modal.querySelector("[data-piracy-panel]")).not.toBeNull();
    expect(
      modal.querySelector("[data-piracy-panel] p")?.textContent?.trim(),
    ).toBe("rooms.arrived_hint");
    expect(mode()).toBe("fallen");
  });

  it("stays shut with piracy off", async () => {
    await mount({ piracy: false, spawned: false });
    modal.tick();
    await modal.updateComplete;
    expect(modal.isVisible).toBe(false);
  });
});

describe("a drop-in's killing blow (L44)", () => {
  const win = (winner: string) => ({
    [GameUpdateType.Win]: [{ winner: ["player", winner], allPlayersStats: {} }],
  });

  it("tells the drop-in their round is void, with no winner's panel", async () => {
    setCurrentThrone(VEGA);
    await mount({
      alive: true,
      clientID: "late0000",
      joinedAfterStart: (id) => id === "late0000",
      updates: win("late0000"),
    });
    modal.tick();
    await modal.updateComplete;
    expect(title()).toBe("rooms.void_you");
    expect((modal as any).wonRound).toBe(false);
    // The server reserves no seat: the successor arrives as anyone's.
    bus.emit(new NewLobbyEvent("g-next"));
    await modal.updateComplete;
    expect(modal.querySelector("[data-throne-panel]")).toBeNull();
    expect(mode()).toBe("round_end");
  });

  it("tells everyone else who it was", async () => {
    setCurrentThrone(VEGA);
    await mount({
      alive: true,
      joinedAfterStart: (id) => id === "late0000",
      updates: win("late0000"),
    });
    modal.tick();
    await modal.updateComplete;
    expect(title()).toBe("rooms.void_other:name-late0000");
  });
});
