import { beforeEach, describe, expect, it } from "vitest";

import "../../src/client/components/DesktopNavBar";
import "../../src/client/components/MobileNavBar";
import "../../src/client/components/NavUtilityIcons";

// jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

type Mountable = HTMLElement & { updateComplete: Promise<unknown> };

async function mount(tag: string): Promise<Mountable> {
  const el = document.createElement(tag) as Mountable;
  document.body.appendChild(el);
  await el.updateComplete;
  const child = el.querySelector("nav-utility-icons") as Mountable | null;
  if (child !== null) await child.updateComplete;
  return el;
}

const pages = (root: ParentNode) =>
  Array.from(
    root.querySelectorAll<HTMLElement>(".nav-menu-item[data-page]"),
  ).map((el) => el.dataset.page);

// Under a Dark Star (docs/DarkStar-Accounts.md §6, accounts step B5): the
// leaderboard page sits beside Play in both nav bars. Navigation.ts routes
// any .nav-menu-item[data-page] click through showPage(), and index.html
// carries <leaderboard-modal id="page-leaderboard" inline>.
describe("the Leaderboard nav item", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.currentPageId = "page-play";
  });

  it("follows Play in the desktop bar and carries the live-translation hooks", async () => {
    const bar = await mount("desktop-nav-bar");
    expect(pages(bar).slice(0, 2)).toEqual(["page-play", "page-leaderboard"]);
    const item = bar.querySelector<HTMLElement>(
      '.nav-menu-item[data-page="page-leaderboard"]',
    )!;
    expect(item.getAttribute("data-i18n-title")).toBe("main.leaderboard");
    expect(item.querySelector("[data-i18n]")?.getAttribute("data-i18n")).toBe(
      "main.leaderboard",
    );
    expect(item.classList.contains("active")).toBe(false);
  });

  it("follows Play in the mobile menu", async () => {
    const bar = await mount("mobile-nav-bar");
    expect(pages(bar).slice(0, 2)).toEqual(["page-play", "page-leaderboard"]);
    const item = bar.querySelector<HTMLElement>(
      '.nav-menu-item[data-page="page-leaderboard"]',
    )!;
    expect(item.getAttribute("data-i18n")).toBe("main.leaderboard");
  });

  it("highlights when its page is shown", async () => {
    const bar = await mount("desktop-nav-bar");
    window.dispatchEvent(
      new CustomEvent("showPage", { detail: "page-leaderboard" }),
    );
    const item = bar.querySelector<HTMLElement>(
      '.nav-menu-item[data-page="page-leaderboard"]',
    )!;
    expect(item.classList.contains("active")).toBe(true);
    expect(
      bar
        .querySelector<HTMLElement>('.nav-menu-item[data-page="page-play"]')!
        .classList.contains("active"),
    ).toBe(false);
  });
});
