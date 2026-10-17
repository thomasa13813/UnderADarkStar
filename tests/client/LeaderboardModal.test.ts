import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LeaderboardEntry,
  LeaderboardResponse,
  LeaderboardSort,
} from "../../src/core/ApiSchemas";

// The API stand-in: one answer per sort, settable per test, and a log of
// what was asked for.
const { answers, asked } = vi.hoisted(() => ({
  answers: {} as Partial<
    Record<string, LeaderboardResponse | null | Promise<LeaderboardResponse>>
  >,
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

import "../../src/client/LeaderboardModal";
import type { LeaderboardModal } from "../../src/client/LeaderboardModal";

// Under a Dark Star (docs/DarkStar-Accounts.md §6, accounts step B5, one
// list since 2026-10-17): the leaderboard page. One list with a sort
// control over three numbers, the top 100 as rows, the caller's own row
// highlighted or pinned, the hints for a guest and for a player with nothing
// recorded, the empty list, and the API being away.

function entry(
  rank: number,
  name: string,
  victories: number,
  reigns: number,
  longest: number,
  publicId = name.toLowerCase(),
): LeaderboardEntry {
  return {
    rank,
    publicId,
    username: `${name}.0001`,
    victories,
    reigns,
    longestReign: longest,
  };
}

function answer(
  sort: LeaderboardSort,
  entries: LeaderboardEntry[],
  me?: LeaderboardResponse["me"],
): LeaderboardResponse {
  return { sort, generatedAt: 1_000, entries, me: me ?? null };
}

type Modal = LeaderboardModal & { updateComplete: Promise<unknown> };

let modal: Modal;

async function settle(): Promise<void> {
  // The load is one awaited fetch; a couple of microtask turns settle it.
  for (let i = 0; i < 4; i++) await Promise.resolve();
  await modal.updateComplete;
}

const rows = () =>
  Array.from(modal.querySelectorAll("tbody tr[data-rank]")).map((tr) => ({
    rank: tr.getAttribute("data-rank"),
    name: tr.querySelector("td:nth-child(2) span")?.textContent?.trim(),
    mine: tr.hasAttribute("data-mine"),
    pinned: tr.hasAttribute("data-pinned"),
  }));
// The three numbers of one row, as shown.
const numbers = (row: number) =>
  Array.from(
    modal.querySelectorAll(
      `tbody tr[data-rank]:nth-of-type(${row}) td:nth-child(n+3)`,
    ),
  ).map((td) => td.textContent?.trim());
const select = () => modal.querySelector("select") as HTMLSelectElement;
const currentSort = () =>
  modal.querySelector("[data-sort]")?.getAttribute("data-sort");

// The player picks a sort from the control.
async function pick(sort: LeaderboardSort): Promise<void> {
  select().value = sort;
  select().dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}

beforeEach(async () => {
  for (const key of Object.keys(answers)) delete answers[key];
  asked.length = 0;
  // Mount through innerHTML: the element's constructor sets attributes,
  // which jsdom refuses on a createElement'd custom element.
  document.body.innerHTML =
    '<leaderboard-modal id="page-leaderboard" inline></leaderboard-modal>';
  modal = document.querySelector("leaderboard-modal") as Modal;
  await modal.updateComplete;
});

afterEach(() => {
  modal.close();
  document.body.innerHTML = "";
});

describe("the leaderboard page", () => {
  it("opens sorted by victories and lists the rows with all three numbers", async () => {
    answers.victories = answer("victories", [
      entry(1, "Alpha", 3, 2, 2),
      entry(1, "Bravo", 3, 0, 0),
      entry(3, "Charlie", 2, 1, 1),
    ]);
    modal.open();
    expect(modal.isOpen()).toBe(true);
    await settle();

    expect(asked).toEqual(["victories"]);
    expect(currentSort()).toBe("victories");
    expect(select().value).toBe("victories");
    expect(
      Array.from(select().options).map((o) => [o.value, o.textContent?.trim()]),
    ).toEqual([
      ["victories", "leaderboard.col_victories"],
      ["reigns", "leaderboard.col_reigns"],
      ["longest", "leaderboard.col_longest"],
    ]);
    expect(rows()).toEqual([
      { rank: "1", name: "Alpha.0001", mine: false, pinned: false },
      { rank: "1", name: "Bravo.0001", mine: false, pinned: false },
      { rank: "3", name: "Charlie.0001", mine: false, pinned: false },
    ]);
    expect(numbers(1)).toEqual(["3", "2", "2"]);
    expect(numbers(2)).toEqual(["3", "0", "0"]);
    expect(
      modal.querySelector("thead th:nth-child(3)")?.textContent?.trim(),
    ).toBe("leaderboard.col_victories");
    // A guest is told to sign in to see their standing.
    expect(modal.querySelector("[data-list-guest]")).not.toBeNull();
    expect(modal.querySelector("[data-list-unranked]")).toBeNull();
  });

  it("reads the list again under a sort when it is picked, once per opening", async () => {
    answers.victories = answer("victories", [entry(1, "Alpha", 3, 2, 2)]);
    answers.longest = answer("longest", [
      entry(1, "Alpha", 3, 2, 2),
      entry(2, "Charlie", 2, 1, 1),
    ]);
    modal.open();
    await settle();

    await pick("longest");
    expect(asked).toEqual(["victories", "longest"]);
    expect(currentSort()).toBe("longest");
    expect(rows().map((r) => r.name)).toEqual(["Alpha.0001", "Charlie.0001"]);

    // Back and forth within one opening asks nothing more.
    await pick("victories");
    await pick("longest");
    expect(asked).toEqual(["victories", "longest"]);

    // A reopen reads afresh, under the sort last picked.
    modal.close();
    modal.open();
    await settle();
    expect(asked).toEqual(["victories", "longest", "longest"]);
    expect(select().value).toBe("longest");
  });

  it("highlights the caller's row when they are in the list", async () => {
    answers.victories = answer(
      "victories",
      [entry(1, "Alpha", 3, 2, 2), entry(2, "Bravo", 2, 1, 1)],
      entry(2, "Bravo", 2, 1, 1),
    );
    modal.open();
    await settle();

    expect(rows()).toEqual([
      { rank: "1", name: "Alpha.0001", mine: false, pinned: false },
      { rank: "2", name: "Bravo.0001", mine: true, pinned: false },
    ]);
    expect(
      modal.querySelector("[data-mine] td:nth-child(2)")?.textContent,
    ).toContain("leaderboard.you");
    expect(modal.querySelector("[data-list-guest]")).toBeNull();
    expect(modal.querySelector("[data-list-unranked]")).toBeNull();
  });

  it("pins the caller's row under the list when they are ranked beyond it", async () => {
    answers.victories = answer(
      "victories",
      [entry(1, "Alpha", 3, 2, 2), entry(2, "Bravo", 2, 1, 1)],
      entry(140, "Zed", 1, 0, 0),
    );
    modal.open();
    await settle();

    expect(rows()).toEqual([
      { rank: "1", name: "Alpha.0001", mine: false, pinned: false },
      { rank: "2", name: "Bravo.0001", mine: false, pinned: false },
      { rank: "140", name: "Zed.0001", mine: true, pinned: true },
    ]);
  });

  it("tells a signed-in player with nothing recorded how to get on the list", async () => {
    answers.victories = answer("victories", [entry(1, "Alpha", 3, 2, 2)], {
      ...entry(0, "Echo", 0, 0, 0),
      rank: null,
    });
    modal.open();
    await settle();

    expect(rows()).toHaveLength(1);
    expect(
      modal.querySelector("[data-list-unranked]")?.textContent?.trim(),
    ).toBe("leaderboard.unranked:Echo.0001");
    expect(modal.querySelector("[data-list-guest]")).toBeNull();
  });

  it("says so when nothing has been recorded yet", async () => {
    answers.victories = answer("victories", []);
    modal.open();
    await settle();

    expect(modal.querySelector("[data-list-table]")).toBeNull();
    expect(modal.querySelector("[data-list-empty]")).not.toBeNull();
    // The sort control stays, for when there is something to sort.
    expect(select()).not.toBeNull();
  });

  it("offers a retry when the API is away, and recovers", async () => {
    modal.open();
    await settle();
    expect(modal.querySelector("[data-list-error]")).not.toBeNull();
    expect(modal.querySelector("[data-list-table]")).toBeNull();

    answers.victories = answer("victories", [entry(1, "Alpha", 3, 2, 2)]);
    (modal.querySelector("[data-list-error] o-button") as HTMLElement).click();
    await settle();
    expect(asked).toEqual(["victories", "victories"]);
    expect(modal.querySelector("[data-list-error]")).toBeNull();
    expect(rows().map((r) => r.name)).toEqual(["Alpha.0001"]);
  });

  it("drops an answer that arrives after the page was closed", async () => {
    let resolve!: (r: LeaderboardResponse) => void;
    answers.victories = new Promise<LeaderboardResponse>((r) => {
      resolve = r;
    });
    modal.open();
    await settle();
    modal.close();
    resolve(answer("victories", [entry(1, "Alpha", 3, 2, 2)]));
    await settle();

    // Reopened, the page asks again rather than showing the stale answer.
    answers.victories = answer("victories", []);
    modal.open();
    await settle();
    expect(asked).toEqual(["victories", "victories"]);
    expect(modal.querySelector("[data-list-empty]")).not.toBeNull();
  });
});
