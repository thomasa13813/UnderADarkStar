import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/client/Utils")>()),
  translateText: (key: string, args?: Record<string, string | number>) =>
    args ? `${key}:${Object.values(args).join(",")}` : key,
}));

import "../../../../src/client/hud/layers/RoomWatchBar";
import type { RoomWatchBar } from "../../../../src/client/hud/layers/RoomWatchBar";
import {
  setCurrentThrone,
  setHeldForNextRound,
} from "../../../../src/client/ThroneState";
import { SendSpectateEvent } from "../../../../src/client/Transport";
import type { GameView } from "../../../../src/client/view";
import { EventBus } from "../../../../src/core/EventBus";
import { GameType } from "../../../../src/core/game/Game";

// Under a Dark Star (docs/DarkStar-Lobbies.md L43, L48): a watcher of a
// room's round may join it as a pirate; in its last 3 minutes nobody joins;
// a watcher held for the next round is told so.

const VEGA = {
  throneID: "throne-vega",
  name: "Vega",
  type: "ffa" as const,
  reign: 0,
  seat: "open" as const,
};

function game(opts: { ticks?: number; player?: boolean } = {}): GameView {
  const config = {
    gameType: GameType.Public,
    maxTimerValue: 20,
    gameMap: "Event Horizon",
    gameMode: "Free For All",
  };
  return {
    config: () => ({
      gameConfig: () => config,
      piracyConfig: () => ({ enabled: true }),
    }),
    myClientID: () => "watch000",
    myPlayer: () => (opts.player ? {} : null),
    gameOver: () => false,
    ticks: () => opts.ticks ?? 3_000,
  } as unknown as GameView;
}

async function bar(g: GameView, bus = new EventBus()): Promise<RoomWatchBar> {
  const el = document.createElement("room-watch-bar") as RoomWatchBar;
  el.game = g;
  el.eventBus = bus;
  document.body.append(el);
  el.tick();
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  setCurrentThrone(undefined);
  setHeldForNextRound(false);
});

describe("the watcher's bar in a room", () => {
  it("offers to join as a pirate, once", async () => {
    setCurrentThrone(VEGA);
    const bus = new EventBus();
    const sent: boolean[] = [];
    bus.on(SendSpectateEvent, (e) => sent.push(e.spectator));
    const el = await bar(game(), bus);
    expect(el.textContent).toContain("rooms.watching:Vega");
    const button = el.querySelector("[data-watch-join]") as HTMLButtonElement;
    button.click();
    await el.updateComplete;
    expect(sent).toEqual([false]);
    expect(button.disabled).toBe(true);
  });

  it("closes in the round's last 3 minutes", async () => {
    setCurrentThrone(VEGA);
    const el = await bar(game({ ticks: 200 + 17 * 600 }));
    expect(el.textContent).toContain("rooms.watch_cutoff");
    expect(el.querySelector("[data-watch-join]")).toBeNull();
  });

  it("tells a held watcher they go to the next round", async () => {
    setCurrentThrone(VEGA);
    setHeldForNextRound(true);
    const el = await bar(game());
    expect(el.textContent).toContain("rooms.held_hint");
  });

  it("is not shown to a player, nor off a room", async () => {
    setCurrentThrone(VEGA);
    expect((await bar(game({ player: true }))).textContent?.trim()).toBe("");
    setCurrentThrone(undefined);
    expect((await bar(game())).textContent?.trim()).toBe("");
  });
});
