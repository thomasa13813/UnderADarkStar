import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isOnCrazyGames } = vi.hoisted(() => ({
  isOnCrazyGames: vi.fn(() => false),
}));
vi.mock("../../src/core/AssetUrls", () => ({
  assetUrl: (path: string) => path,
}));

// Rendering play-page mounts its children too (cosmetic background, …), and
// some reach for browser APIs jsdom doesn't ship.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

import { PlayPage } from "../../src/client/components/PlayPage";

describe("play-page mobile top bar", () => {
  let el: PlayPage;

  async function mount() {
    if (!customElements.get("play-page")) {
      customElements.define("play-page", PlayPage);
    }
    el = document.createElement("play-page") as PlayPage;
    document.body.appendChild(el);
    await el.updateComplete;
  }

  afterEach(() => {
    el?.remove();
    vi.clearAllMocks();
    isOnCrazyGames.mockReturnValue(false);
  });

  // The bar is a flex row: menu button, title, then the right slot.
  const rightSlot = () =>
    Array.from(
      el.querySelector("#hamburger-btn")!.parentElement!.lastElementChild!
        .children,
    ).map((c) => c.tagName.toLowerCase());

  describe("off CrazyGames", () => {
    beforeEach(mount);

    it("puts the help and settings icons in the right slot", () => {
      expect(rightSlot()).toEqual(["nav-utility-icons"]);
    });
  });

  describe("on CrazyGames", () => {
    beforeEach(async () => {
      isOnCrazyGames.mockReturnValue(true);
      await mount();
    });

    it("renders the same controls", () => {
      expect(rightSlot()).toEqual(["nav-utility-icons"]);
    });
  });
});
