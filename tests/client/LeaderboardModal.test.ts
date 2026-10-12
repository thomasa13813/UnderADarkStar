import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LeaderboardBoard,
  LeaderboardEntry,
  LeaderboardResponse,
} from "../../src/core/ApiSchemas";

// The API stand-in: one answer per board, settable per test, and a log of
// what was asked for.
const { answers, asked } = vi.hoisted(() => ({
  answers: {} as Partial<
    Record<string, LeaderboardResponse | null | Promise<LeaderboardResponse>>
  >,
  asked: [] as string[],
}));

vi.mock("../../src/client/LeaderboardApi", () => ({
  fetchLeaderboard: vi.fn(async (board: LeaderboardBoard) => {
    asked.push(board);
    const answer = answers[board];
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

// Under a Dark Star (docs/DarkStar-Accounts.md §6, accounts step B5): the
// leaderboard page. Two tabs over two boards, the top 100 as rows, the
// caller's own row highlighted or pinned, the hints for a guest and for a
// player without a reign, the empty board, and the API being away.

function entry(
  rank: number,
  name: string,
  reigns: number,
  longest: number,
  publicId = name.toLowerCase(),
): LeaderboardEntry {
  return {
    rank,
    publicId,
    username: `${name}.0001`,
    reigns,
    longestReign: longest,
    thronesTaken: reigns - 1,
    roundsHeld: 1,
  };
}

function answer(
  board: LeaderboardBoard,
  entries: LeaderboardEntry[],
  me?: LeaderboardResponse["me"],
): LeaderboardResponse {
  return { board, generatedAt: 1_000, entries, me: me ?? null };
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
// The tab strip is the o-modal shell's, in its shadow root; the body is
// slotted light DOM.
const tabs = () =>
  Array.from(
    modal
      .querySelector("o-modal")
      ?.shadowRoot?.querySelectorAll('[role="tab"]') ?? [],
  ).map((t) => ({
    key: t.getAttribute("data-key"),
    active: t.getAttribute("aria-selected") === "true",
  }));

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
  it("opens on the Reigns board and lists its rows with the split", async () => {
    answers.reigns = answer("reigns", [
      entry(1, "Alpha", 3, 3),
      entry(1, "Bravo", 3, 1),
      entry(3, "Charlie", 2, 2),
    ]);
    modal.open();
    expect(modal.isOpen()).toBe(true);
    await settle();

    expect(asked).toEqual(["reigns"]);
    expect(tabs()).toEqual([
      { key: "reigns", active: true },
      { key: "longest", active: false },
    ]);
    expect(rows()).toEqual([
      { rank: "1", name: "Alpha.0001", mine: false, pinned: false },
      { rank: "1", name: "Bravo.0001", mine: false, pinned: false },
      { rank: "3", name: "Charlie.0001", mine: false, pinned: false },
    ]);
    const split = modal.querySelector("tbody tr td:last-child");
    expect(split?.textContent?.trim()).toBe("leaderboard.split:2,1");
    // A guest is told to sign in to see their standing.
    expect(modal.querySelector("[data-board-guest]")).not.toBeNull();
    expect(modal.querySelector("[data-board-unranked]")).toBeNull();
  });

  it("loads the Longest reign board when its tab is chosen, once", async () => {
    answers.reigns = answer("reigns", [entry(1, "Alpha", 3, 3)]);
    answers.longest = answer("longest", [
      entry(1, "Alpha", 3, 3),
      entry(2, "Charlie", 2, 2),
    ]);
    modal.open();
    await settle();

    modal.setActiveTab("longest");
    await settle();
    expect(asked).toEqual(["reigns", "longest"]);
    expect(
      modal.querySelector("[data-board]")?.getAttribute("data-board"),
    ).toBe("longest");
    expect(rows().map((r) => r.name)).toEqual(["Alpha.0001", "Charlie.0001"]);

    // Back and forth within one opening asks nothing more.
    modal.setActiveTab("reigns");
    await settle();
    modal.setActiveTab("longest");
    await settle();
    expect(asked).toEqual(["reigns", "longest"]);

    // A reopen reads afresh.
    modal.close();
    modal.open();
    await settle();
    expect(asked).toEqual(["reigns", "longest", "longest"]);
  });

  it("highlights the caller's row when they are in the list", async () => {
    answers.reigns = answer(
      "reigns",
      [entry(1, "Alpha", 3, 3), entry(2, "Bravo", 2, 1)],
      entry(2, "Bravo", 2, 1),
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
    expect(modal.querySelector("[data-board-guest]")).toBeNull();
    expect(modal.querySelector("[data-board-unranked]")).toBeNull();
  });

  it("pins the caller's row under the list when they are ranked beyond it", async () => {
    answers.reigns = answer(
      "reigns",
      [entry(1, "Alpha", 3, 3), entry(2, "Bravo", 2, 1)],
      entry(140, "Zed", 1, 1),
    );
    modal.open();
    await settle();

    expect(rows()).toEqual([
      { rank: "1", name: "Alpha.0001", mine: false, pinned: false },
      { rank: "2", name: "Bravo.0001", mine: false, pinned: false },
      { rank: "140", name: "Zed.0001", mine: true, pinned: true },
    ]);
  });

  it("tells a signed-in player without a reign how to get one", async () => {
    answers.reigns = answer("reigns", [entry(1, "Alpha", 3, 3)], {
      ...entry(0, "Echo", 0, 0),
      rank: null,
    });
    modal.open();
    await settle();

    expect(rows()).toHaveLength(1);
    expect(
      modal.querySelector("[data-board-unranked]")?.textContent?.trim(),
    ).toBe("leaderboard.unranked:Echo.0001");
    expect(modal.querySelector("[data-board-guest]")).toBeNull();
  });

  it("says so when no reign has been recorded yet", async () => {
    answers.reigns = answer("reigns", []);
    modal.open();
    await settle();

    expect(modal.querySelector("[data-board-table]")).toBeNull();
    expect(modal.querySelector("[data-board-empty]")).not.toBeNull();
  });

  it("offers a retry when the API is away, and recovers", async () => {
    modal.open();
    await settle();
    expect(modal.querySelector("[data-board-error]")).not.toBeNull();
    expect(modal.querySelector("[data-board-table]")).toBeNull();

    answers.reigns = answer("reigns", [entry(1, "Alpha", 3, 3)]);
    (modal.querySelector("[data-board-error] o-button") as HTMLElement).click();
    await settle();
    expect(asked).toEqual(["reigns", "reigns"]);
    expect(modal.querySelector("[data-board-error]")).toBeNull();
    expect(rows().map((r) => r.name)).toEqual(["Alpha.0001"]);
  });

  it("drops an answer that arrives after the page was closed", async () => {
    let resolve!: (r: LeaderboardResponse) => void;
    answers.reigns = new Promise<LeaderboardResponse>((r) => {
      resolve = r;
    });
    modal.open();
    await settle();
    modal.close();
    resolve(answer("reigns", [entry(1, "Alpha", 3, 3)]));
    await settle();

    // Reopened, the page asks again rather than showing the stale answer.
    answers.reigns = answer("reigns", []);
    modal.open();
    await settle();
    expect(asked).toEqual(["reigns", "reigns"]);
    expect(modal.querySelector("[data-board-empty]")).not.toBeNull();
  });
});
