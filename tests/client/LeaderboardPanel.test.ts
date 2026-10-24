import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LeaderboardEntry,
  LeaderboardResponse,
  LeaderboardSort,
} from "../../src/core/ApiSchemas";

// The API stand-in: one answer per sort, settable per test, and a log of
// what was asked for.
const { answers, asked } = vi.hoisted(() => ({
  answers: {} as Partial<Record<string, LeaderboardResponse | null>>,
  asked: [] as string[],
}));

vi.mock("../../src/client/LeaderboardApi", () => ({
  fetchLeaderboard: vi.fn(async (sort: LeaderboardSort) => {
    asked.push(sort);
    const answer = answers[sort];
    return answer === undefined ? null : answer;
  }),
}));

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, args?: Record<string, string | number>) =>
    args ? `${key}:${Object.values(args).join(",")}` : key,
}));

import type { LeaderboardPanel } from "../../src/client/components/LeaderboardPanel";
import {
  PANEL_REFRESH_MS,
  PANEL_ROWS,
} from "../../src/client/components/LeaderboardPanel";

// Under a Dark Star (docs/DarkStar-Accounts.md §6, 2026-10-20): the
// leaderboard card on the home page. The top ten under the chosen sort with
// that sort's number, the own row highlighted or pinned, the guest and
// unranked hints, the API being away, the link to the full page, and when it
// reads the list again.

function entry(
  rank: number,
  name: string,
  victories = 0,
  reigns = 0,
  longest = 0,
): LeaderboardEntry {
  return {
    rank,
    publicId: name.toLowerCase(),
    username: `${name}.0001`,
    victories,
    reigns,
    longestReign: longest,
  };
}

function answer(
  sort: LeaderboardSort,
  entries: LeaderboardEntry[],
  me: LeaderboardResponse["me"] = null,
): LeaderboardResponse {
  return { sort, generatedAt: 1_000, entries, me };
}

type Panel = LeaderboardPanel & { updateComplete: Promise<unknown> };

let panel: Panel;

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  await panel.updateComplete;
}

async function mount(): Promise<void> {
  panel = document.createElement("leaderboard-panel") as Panel;
  document.body.appendChild(panel);
  await settle();
}

const rows = () =>
  Array.from(panel.querySelectorAll("tbody tr[data-rank]")).map((tr) => {
    const cells = Array.from(tr.querySelectorAll("td")).map((td) =>
      td.textContent?.trim(),
    );
    return {
      rank: tr.getAttribute("data-rank"),
      name: tr.querySelector("td:nth-child(2) span")?.textContent?.trim(),
      figures: cells.slice(2),
      mine: tr.hasAttribute("data-mine"),
      pinned: tr.hasAttribute("data-pinned"),
    };
  });

const select = () => panel.querySelector("select") as HTMLSelectElement;

function chooseSort(sort: LeaderboardSort): void {
  select().value = sort;
  select().dispatchEvent(new Event("change", { bubbles: true }));
}

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => entry(i + 1, `P${i + 1}`, 100 - i));

describe("the home-page leaderboard panel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    for (const key of Object.keys(answers)) delete answers[key];
    asked.length = 0;
  });

  afterEach(() => {
    panel?.remove();
    vi.useRealTimers();
  });

  it("shows only the top ten, each row with all three numbers", async () => {
    answers.victories = answer("victories", [
      entry(1, "Ada", 7, 2, 1),
      ...many(25).slice(1),
    ]);
    await mount();
    const shown = rows();
    expect(shown).toHaveLength(PANEL_ROWS);
    expect(shown[0]).toMatchObject({
      rank: "1",
      name: "Ada.0001",
      figures: ["7", "2", "1"],
    });
    expect(shown[9].rank).toBe("10");
    expect(asked).toEqual(["victories"]);
  });

  it("switches sort with the dropdown, emphasising that column, and asks once per sort", async () => {
    answers.victories = answer("victories", [entry(1, "Ada", 7, 2, 1)]);
    answers.reigns = answer("reigns", [entry(1, "Bo", 1, 9, 4)]);
    await mount();
    expect(select().value).toBe("victories");
    chooseSort("reigns");
    await settle();
    expect(rows()[0]).toMatchObject({
      name: "Bo.0001",
      figures: ["1", "9", "4"],
    });
    const emphasised = panel.querySelector(
      "tbody tr td:nth-child(4)[data-sorted]",
    );
    expect(emphasised?.textContent?.trim()).toBe("9");
    chooseSort("victories");
    await settle();
    expect(rows()[0].name).toBe("Ada.0001");
    expect(asked).toEqual(["victories", "reigns"]);
  });

  it("highlights the own row inside the top ten", async () => {
    const me = entry(3, "P3", 98);
    answers.victories = answer("victories", many(12), me);
    await mount();
    const mine = rows().filter((r) => r.mine);
    expect(mine).toEqual([
      expect.objectContaining({ rank: "3", pinned: false }),
    ]);
  });

  it("pins the own row under the top ten when ranked below them", async () => {
    const me = entry(42, "Zed", 3);
    answers.victories = answer("victories", many(50), me);
    await mount();
    const shown = rows();
    expect(shown).toHaveLength(PANEL_ROWS + 1);
    expect(shown[shown.length - 1]).toMatchObject({
      rank: "42",
      mine: true,
      pinned: true,
    });
  });

  it("tells a guest to sign in, and an unranked player how to get on", async () => {
    answers.victories = answer("victories", many(3));
    await mount();
    expect(panel.querySelector("[data-panel-guest]")).not.toBeNull();
    panel.remove();

    answers.victories = answer("victories", many(3), {
      ...entry(1, "New"),
      rank: null,
    });
    await mount();
    expect(panel.querySelector("[data-panel-guest]")).toBeNull();
    expect(
      panel.querySelector("[data-panel-unranked]")?.textContent?.trim(),
    ).toBe("leaderboard.unranked:New.0001");
  });

  it("says when the API is away", async () => {
    await mount();
    expect(panel.querySelector("[data-panel-error]")).not.toBeNull();
  });

  it("opens the full page from its link", async () => {
    answers.victories = answer("victories", many(3));
    await mount();
    const showPage = vi.fn();
    window.showPage = showPage;
    panel.querySelector<HTMLElement>("[data-panel-full]")!.click();
    expect(showPage).toHaveBeenCalledWith("page-leaderboard");
  });

  it("reads again on a return home after a minute, and on an account change", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    answers.victories = answer("victories", many(3));
    await mount();
    const home = () =>
      window.dispatchEvent(
        new CustomEvent("showPage", { detail: "page-play" }),
      );

    home();
    await settle();
    expect(asked).toEqual(["victories"]);

    vi.setSystemTime(Date.now() + PANEL_REFRESH_MS);
    home();
    await settle();
    expect(asked).toEqual(["victories", "victories"]);

    document.dispatchEvent(new CustomEvent("session-cleared"));
    await settle();
    expect(asked).toEqual(["victories", "victories", "victories"]);
  });
});
