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

vi.mock("../../../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => null),
}));

import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";
import { setCurrentThrone } from "../../../../src/client/ThroneState";
import { NewLobbyEvent } from "../../../../src/client/Transport";
import type { GameView } from "../../../../src/client/view";
import { EventBus } from "../../../../src/core/EventBus";

// Under a Dark Star (docs/DarkStar-Lobbies.md L27, §10.7): a non-winner's
// choice after a throne round. Stay with this throne, shown its place in line
// as the public list reports it, or join the head of the same line. The
// panel reads the list live over its own feed, which runs only while it is
// on screen. Doing nothing stays (the lobby the Stay button leads to is the
// successor the server announced). A successor that vanishes after being
// listed was retired (L20): only the head is offered. Eliminated while the
// round goes on (L31), the death screen carries the same panel with the head
// alone: there is no successor yet, and staying is Spectate.

const VEGA = {
  throneID: "throne-vega",
  name: "Vega",
  type: "ffa" as ThroneType,
  reign: 0,
  seat: "open" as const,
};

function throne(
  gameID: string,
  name: string,
  type: ThroneType,
  extra: Partial<NonNullable<PublicGameInfo["throne"]>> = {},
): PublicGameInfo {
  return {
    gameID,
    numClients: 1,
    publicGameType: "throne",
    throne: {
      throneID: `throne-${name.toLowerCase()}`,
      name,
      type,
      reign: 0,
      seat: "open",
      ...extra,
    },
  };
}

function game(opts: { alive?: boolean; spawned?: boolean } = {}): GameView {
  return {
    myPlayer: () => ({
      isAlive: () => opts.alive ?? false,
      isPirate: () => false,
      isLobbyCreator: () => false,
      hasSpawned: () => opts.spawned ?? true,
    }),
    config: () => ({ piracyConfig: () => ({ enabled: false }) }),
    inSpawnPhase: () => false,
    updatesSinceLastTick: () => ({}),
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

async function push(games: PublicGames["games"]): Promise<void> {
  lobbiesCallbackRef.current?.({ serverTime: Date.now(), games });
  await modal.updateComplete;
}

const panel = () => modal.querySelector("[data-line-panel]");
const stayTitle = () =>
  (modal.querySelector("[data-line-stay] o-button") as any)?.title ?? null;
const headTitle = () =>
  (modal.querySelector("[data-line-head] o-button") as any)?.title ?? null;
const place = () =>
  modal.querySelector("[data-line-place]")?.textContent?.trim() ?? null;
const hint = () =>
  modal.querySelector("[data-line-panel] p")?.textContent?.trim() ?? null;
const mode = () => panel()?.getAttribute("data-line-mode") ?? null;

beforeEach(async () => {
  lobbiesCallbackRef.current = null;
  socketLog.length = 0;
  bus = new EventBus();
  modal = document.createElement("win-modal") as WinModal;
  modal.game = game();
  modal.eventBus = bus;
  modal.init();
  document.body.append(modal);
  await modal.updateComplete;
});

afterEach(() => {
  document.body.innerHTML = "";
  setCurrentThrone(undefined);
});

describe("the win screen's line panel (L27)", () => {
  it("offers a non-winner their throne with its place, and the head of the line, live", async () => {
    setCurrentThrone(VEGA);
    bus.emit(new NewLobbyEvent("g-next"));
    await modal.updateComplete;

    expect(modal.isVisible).toBe(true);
    expect(panel()).not.toBeNull();
    expect(modal.querySelector("[data-join-next]")).toBeNull();
    expect(socketLog).toEqual(["start"]);
    // Before the list arrives: Stay without a place, no head yet.
    expect(stayTitle()).toBe("throne.line_stay:Vega");
    expect(place()).toBeNull();
    expect(headTitle()).toBeNull();

    await push({
      throne: [
        throne("g-old", "Vega", "ffa", { running: true }),
        throne("g-head", "Altair", "ffa", { place: 1 }),
        throne("g-next", "Vega", "ffa", { place: 3 }),
        throne("g-mid", "Deneb", "ffa", { place: 2 }),
        throne("g-special", "Rigel", "special", { place: 1 }),
      ],
    });
    expect(place()).toBe("throne.line_place_ahead:2");
    expect(headTitle()).toBe("throne.line_head:Altair");
    expect(hint()).toBe("throne.line_hint");

    // Altair launches; the line moves up under us.
    await push({
      throne: [
        throne("g-head", "Altair", "ffa", { running: true }),
        throne("g-mid", "Deneb", "ffa", { place: 1 }),
        throne("g-next", "Vega", "ffa", { place: 2 }),
      ],
    });
    expect(place()).toBe("throne.line_place_ahead:1");
    expect(headTitle()).toBe("throne.line_head:Deneb");
  });

  it("offers only Stay when our throne is the head", async () => {
    setCurrentThrone(VEGA);
    bus.emit(new NewLobbyEvent("g-next"));
    await push({
      throne: [
        throne("g-next", "Vega", "ffa", { place: 1 }),
        throne("g-mid", "Deneb", "ffa", { place: 2 }),
      ],
    });
    expect(stayTitle()).toBe("throne.line_stay:Vega");
    expect(place()).toBe("throne.line_place_next");
    expect(headTitle()).toBeNull();
    expect(hint()).toBe("throne.line_is_head");
  });

  it("offers only the head once our throne was retired under us", async () => {
    setCurrentThrone(VEGA);
    bus.emit(new NewLobbyEvent("g-next"));
    await push({
      throne: [
        throne("g-head", "Altair", "ffa", { place: 1 }),
        throne("g-next", "Vega", "ffa", { place: 2 }),
      ],
    });
    expect(stayTitle()).toBe("throne.line_stay:Vega");

    await push({ throne: [throne("g-head", "Altair", "ffa", { place: 1 })] });
    expect(stayTitle()).toBeNull();
    expect(headTitle()).toBe("throne.line_head:Altair");
    expect(hint()).toBe("throne.line_retired");
  });

  it("closes the feed with the panel", async () => {
    setCurrentThrone(VEGA);
    bus.emit(new NewLobbyEvent("g-next"));
    await modal.updateComplete;
    expect(socketLog).toEqual(["start"]);

    modal.hide();
    expect(socketLog).toEqual(["start", "stop"]);
    void modal.show();
    expect(socketLog).toEqual(["start", "stop", "start"]);
    modal.remove();
    expect(socketLog).toEqual(["start", "stop", "start", "stop"]);
  });

  it("keeps the plain Join button for a private lobby's successor", async () => {
    bus.emit(new NewLobbyEvent("g-private-next"));
    await modal.updateComplete;

    expect(panel()).toBeNull();
    expect(modal.querySelector("[data-join-next]")).not.toBeNull();
    expect(socketLog).toEqual([]);
  });

  it("gives the winner the Next-round panel, not the line panel", async () => {
    setCurrentThrone(VEGA);
    (modal as any).wonRound = true;
    bus.emit(new NewLobbyEvent("g-next", Date.now() + 30_000));
    await modal.updateComplete;

    expect(modal.querySelector("[data-throne-panel]")).not.toBeNull();
    expect(panel()).toBeNull();
    expect(socketLog).toEqual([]);
  });
});

describe("the death screen's line panel (L31)", () => {
  it("offers a player eliminated mid-round the head of the line alone, live", async () => {
    setCurrentThrone(VEGA);
    modal.tick();
    await modal.updateComplete;

    expect(modal.isVisible).toBe(true);
    expect(panel()).not.toBeNull();
    expect(mode()).toBe("fallen");
    expect(modal.querySelector("[data-join-next]")).toBeNull();
    expect(socketLog).toEqual(["start"]);
    // Before the list arrives: no Stay (our throne's next round does not
    // exist yet), no head yet.
    expect(stayTitle()).toBeNull();
    expect(headTitle()).toBeNull();
    expect(hint()).toBe("throne.line_fallen_empty");

    await push({
      throne: [
        throne("g-ours", "Vega", "ffa", { running: true }),
        throne("g-head", "Altair", "ffa", { place: 1 }),
        throne("g-mid", "Deneb", "ffa", { place: 2 }),
        throne("g-special", "Rigel", "special", { place: 1 }),
      ],
    });
    expect(stayTitle()).toBeNull();
    expect(headTitle()).toBe("throne.line_head:Altair");
    expect(hint()).toBe("throne.line_fallen");
    expect(
      modal.querySelector("[data-line-head] o-button")?.getAttribute("variant"),
    ).toBe("primary");

    // Altair launches; Deneb is the head now.
    await push({
      throne: [
        throne("g-ours", "Vega", "ffa", { running: true }),
        throne("g-head", "Altair", "ffa", { running: true }),
        throne("g-mid", "Deneb", "ffa", { place: 1 }),
      ],
    });
    expect(headTitle()).toBe("throne.line_head:Deneb");

    // Spectate closes the panel and its feed; the death screen opens once.
    modal.hide();
    expect(socketLog).toEqual(["start", "stop"]);
    modal.tick();
    await modal.updateComplete;
    expect(modal.isVisible).toBe(false);
  });

  it("says so when nothing of this mode is gathering", async () => {
    setCurrentThrone({ ...VEGA, type: "special" });
    modal.tick();
    await push({
      throne: [
        throne("g-ours", "Vega", "special", { running: true }),
        throne("g-head", "Altair", "ffa", { place: 1 }),
      ],
    });
    expect(mode()).toBe("fallen");
    expect(headTitle()).toBeNull();
    expect(hint()).toBe("throne.line_fallen_empty");
  });

  it("grows into the full panel when the round ends and the successor arrives", async () => {
    setCurrentThrone(VEGA);
    modal.tick();
    await push({
      throne: [
        throne("g-ours", "Vega", "ffa", { running: true }),
        throne("g-head", "Altair", "ffa", { place: 1 }),
      ],
    });
    expect(mode()).toBe("fallen");

    bus.emit(new NewLobbyEvent("g-next"));
    await push({
      throne: [
        throne("g-head", "Altair", "ffa", { place: 1 }),
        throne("g-next", "Vega", "ffa", { place: 2 }),
      ],
    });
    expect(mode()).toBe("successor");
    expect(stayTitle()).toBe("throne.line_stay:Vega");
    expect(place()).toBe("throne.line_place_ahead:1");
    expect(headTitle()).toBe("throne.line_head:Altair");
    expect(hint()).toBe("throne.line_hint");
    // One feed the whole way: the panel never left the screen.
    expect(socketLog).toEqual(["start"]);
  });

  it("gives a death off a throne round the plain death screen", async () => {
    modal.tick();
    await modal.updateComplete;

    expect(modal.isVisible).toBe(true);
    expect(panel()).toBeNull();
    expect(socketLog).toEqual([]);
  });

  it("does not open for a player still alive, or one who never spawned", async () => {
    setCurrentThrone(VEGA);
    modal.game = game({ alive: true });
    modal.tick();
    await modal.updateComplete;
    expect(modal.isVisible).toBe(false);

    modal.game = game({ spawned: false });
    modal.tick();
    await modal.updateComplete;
    expect(modal.isVisible).toBe(false);
    expect(panel()).toBeNull();
    expect(socketLog).toEqual([]);
  });
});
