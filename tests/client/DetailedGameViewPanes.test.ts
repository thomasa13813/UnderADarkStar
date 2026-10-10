import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameMapType, GameMode } from "../../src/core/game/Game";
import type {
  GameConfig,
  PublicGameInfo,
  PublicGames,
  ThroneType,
} from "../../src/core/Schemas";

// Same socket stand-in as PlayJoinsHero: keep the update callback so a lobby
// snapshot can be pushed in and the panes rendered.
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

import "../../src/client/components/DetailedGameViewModal";
import type { DetailedGameViewModal } from "../../src/client/components/DetailedGameViewModal";

// jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

type Modal = DetailedGameViewModal & {
  updateComplete: Promise<unknown>;
  modalConfig(): { tabs?: { key: string }[] };
};

function throne(gameID: string, type: ThroneType): PublicGameInfo {
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
    },
    gameConfig: {
      gameMap: GameMapType.EventHorizon,
      gameMode: GameMode.FFA,
      maxPlayers: 8,
    } as unknown as GameConfig,
  };
}

function queued(gameID: string, type: "ffa" | "team" | "special") {
  return { ...throne(gameID, "ffa"), publicGameType: type, throne: undefined };
}

let modal: Modal;

async function push(games: PublicGames["games"]): Promise<void> {
  lobbiesCallbackRef.current?.({ serverTime: Date.now(), games });
  await modal.updateComplete;
}

const paneKeys = () =>
  Array.from(modal.querySelectorAll("[data-pane]")).map((el) =>
    el.getAttribute("data-pane"),
  );
const tabKeys = () => (modal.modalConfig().tabs ?? []).map((t) => t.key);
const cardIDs = () =>
  Array.from(modal.querySelectorAll("[data-lobby-slot]")).map((el) =>
    el.getAttribute("data-lobby-slot"),
  );

beforeEach(async () => {
  lobbiesCallbackRef.current = null;
  // Parsed rather than created: the modal's constructor sets its id, which
  // the custom-element spec forbids on the createElement path (jsdom throws
  // "Unexpected attributes") but allows when upgrading parsed markup, which
  // is how the page mounts it. The body renders whether or not it is open.
  document.body.innerHTML = "<detailed-view-modal></detailed-view-modal>";
  modal = document.querySelector("detailed-view-modal") as Modal;
  await modal.updateComplete;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("DetailedGameViewModal panes (L29)", () => {
  it("files thrones by type, with no Thrones pane and no empty pane", async () => {
    // Launch shape: an FFA line and a special line, no team line yet (L25).
    await push({
      throne: [
        throne("f1", "ffa"),
        throne("s1", "special"),
        throne("f2", "ffa"),
      ],
      ffa: [],
      team: [],
      special: [],
    });
    // Strings render as their keys here: no translations are loaded.
    expect(paneKeys()).toEqual(["ffa", "special"]);
    expect(tabKeys()).toEqual(["ffa", "special", "all"]);
    expect(modal.querySelector("[data-pane='ffa']")?.textContent).not.toContain(
      "detailed_view.pane_empty",
    );
  });

  it("shows the team pane as soon as a team throne exists", async () => {
    await push({
      throne: [throne("f1", "ffa"), throne("t1", "team")],
    });
    expect(paneKeys()).toEqual(["ffa", "team"]);
    expect(tabKeys()).toEqual(["ffa", "team", "all"]);
  });

  it("keeps a lone line as a single pane with no placeholders", async () => {
    await push({ throne: [throne("f1", "ffa")] });
    expect(paneKeys()).toEqual(["ffa"]);
    expect(modal.textContent).not.toContain("detailed_view.spawning");
  });

  it("pads only the per-type queues, when the server runs those instead", async () => {
    await push({ ffa: [queued("q1", "ffa")], team: [], special: [] });
    // Every queue refills to six, so all three panes stand with placeholders.
    expect(paneKeys()).toEqual(["ffa", "team", "special"]);
    expect(cardIDs()).toEqual(["q1"]);
  });

  it("lists one line's thrones on its tab", async () => {
    await push({
      throne: [
        throne("f1", "ffa"),
        throne("s1", "special"),
        throne("f2", "ffa"),
      ],
    });
    modal.setActiveTab("special");
    await modal.updateComplete;
    expect(cardIDs()).toEqual(["s1"]);
  });

  it("falls back to the overview when the open tab's line empties", async () => {
    await push({ throne: [throne("f1", "ffa"), throne("s1", "special")] });
    modal.setActiveTab("special");
    await modal.updateComplete;
    expect(cardIDs()).toEqual(["s1"]);
    // The special throne retires (L20): the tab is gone, so the overview shows.
    await push({ throne: [throne("f1", "ffa")] });
    expect(tabKeys()).toEqual(["ffa", "all"]);
    expect(paneKeys()).toEqual(["ffa"]);
    expect(cardIDs()).toEqual(["f1"]);
  });

  it("says there are no lobbies at all rather than blaming the filters", async () => {
    await push({ throne: [], ffa: [], team: [], special: [] });
    expect(paneKeys()).toEqual([]);
    expect(modal.textContent).toContain("detailed_view.pane_empty");
    expect(modal.textContent).not.toContain("detailed_view.no_lobbies");
  });
});
