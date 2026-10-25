import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../src/client/hud/layers/GameRightSidebar";
import type { GameRightSidebar } from "../../src/client/hud/layers/GameRightSidebar";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";

type TestSidebar = GameRightSidebar & { updateComplete: Promise<unknown> };

function fakeGame(): GameView {
  const config = {
    gameConfig: () => ({ maxTimerValue: undefined }),
    doomsdayClockConfig: () => ({ enabled: false }),
    overtimeConfig: () => ({ enabled: false, startMinutes: 0 }),
    isReplay: () => false,
    listed: true,
  };
  return {
    config: () => config,
    inSpawnPhase: () => false,
    elapsedGameSeconds: () => 0,
    myPlayer: () => undefined,
    // The Dark Star panel is embedded in the sidebar template; no throne here.
    hegemon: () => null,
    darkStar: () => null,
    gameID: () => "test-game",
  } as unknown as GameView;
}

async function mount(): Promise<TestSidebar> {
  const el = document.createElement("game-right-sidebar") as TestSidebar;
  el.game = fakeGame();
  el.eventBus = new EventBus();
  document.body.appendChild(el);
  await flush(el);
  return el;
}

async function flush(el: TestSidebar): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await el.updateComplete;
}

function fullscreenButton(el: TestSidebar): HTMLImageElement | undefined {
  const images = [
    ...el.renderRoot.querySelectorAll<HTMLImageElement>("img"),
  ].filter((img) => img.alt !== "settings" && img.alt !== "exit");
  return images[0];
}

function clickFullscreen(el: TestSidebar): void {
  fullscreenButton(el)!.parentElement!.dispatchEvent(
    new MouseEvent("click", { bubbles: true }),
  );
}

// Elements mounted by a test are removed by the global DOM teardown in
// tests/domTeardown.ts, which runs after this file's own hooks. Only the
// globals this file installs need undoing here.
afterEach(() => {
  vi.useRealTimers();
});

describe("GameRightSidebar fullscreen button", () => {
  let requestFullscreen: ReturnType<typeof vi.fn>;
  let exitFullscreen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    requestFullscreen = vi.fn(async () => undefined);
    exitFullscreen = vi.fn(async () => undefined);
    // jsdom implements neither, and the sidebar's web path gates its own
    // rendering on fullscreenEnabled.
    Object.defineProperty(document, "fullscreenEnabled", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(document, "fullscreenElement", {
      value: null,
      writable: true,
      configurable: true,
    });
    document.documentElement.requestFullscreen =
      requestFullscreen as unknown as HTMLElement["requestFullscreen"];
    document.exitFullscreen =
      exitFullscreen as unknown as Document["exitFullscreen"];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses HTML fullscreen", async () => {
    const el = await mount();

    clickFullscreen(el);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it("leaves HTML fullscreen the same way", async () => {
    const el = await mount();
    (document as { fullscreenElement: Element | null }).fullscreenElement =
      document.documentElement;

    clickFullscreen(el);
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("tracks HTML fullscreen changes", async () => {
    const el = await mount();
    expect(fullscreenButton(el)!.src).not.toContain("ExitFullscreen");

    (document as { fullscreenElement: Element | null }).fullscreenElement =
      document.documentElement;
    document.dispatchEvent(new Event("fullscreenchange"));
    await flush(el);
    expect(fullscreenButton(el)!.src).toContain("ExitFullscreen");
  });
});

describe("GameRightSidebar speaker", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("sits immediately right of the settings gear", async () => {
    const el = await mount();
    const gear = el.renderRoot.querySelector<HTMLImageElement>(
      'img[alt="settings"]',
    )!.parentElement!;
    const next = gear.nextElementSibling!;
    expect(next.tagName).toBe("SOUND-TOGGLE");
    await (next as unknown as TestSidebar).updateComplete;
    expect(next.querySelector("button svg")).not.toBeNull();
  });
});
