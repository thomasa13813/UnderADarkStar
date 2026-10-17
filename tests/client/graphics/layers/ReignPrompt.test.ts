import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMeResponse } from "../../../../src/core/ApiSchemas";

// The account stand-ins: who we are, the cached profile, and the fresh
// profile each poll reads (a queue, so the numbers can move mid-way).
const { auth, signIns } = vi.hoisted(() => ({
  auth: {
    signedIn: false,
    cached: null as UserMeResponse | false | null,
    fresh: [] as (UserMeResponse | false)[],
    reads: 0,
  },
  signIns: [] as { provider: string; redirectTo?: string }[],
}));

vi.mock("../../../../src/client/Auth", () => ({
  isLoggedIn: vi.fn(async () => auth.signedIn),
}));

vi.mock("../../../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => auth.cached),
  fetchUserMeUncached: vi.fn(async () => {
    auth.reads++;
    return auth.fresh.length > 1 ? auth.fresh.shift()! : auth.fresh[0];
  }),
}));

vi.mock("../../../../src/client/SignIn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/client/SignIn")>()),
  signInProviders: () => ["discord", "dev"],
  startSignInWith: vi.fn(
    (provider: string, options?: { redirectTo?: string }) => {
      signIns.push({ provider, redirectTo: options?.redirectTo });
      return true;
    },
  ),
}));

vi.mock("../../../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/client/Utils")>()),
  translateText: (key: string, args?: Record<string, string | number>) =>
    args ? `${key}:${Object.values(args).join(",")}` : key,
  homeHref: () => "/",
}));

import "../../../../src/client/hud/layers/ReignPrompt";
import {
  REIGN_POLL_LIMIT,
  REIGN_POLL_MS,
  type ReignPrompt,
} from "../../../../src/client/hud/layers/ReignPrompt";

// Under a Dark Star (docs/DarkStar-Accounts.md §6, accounts step B5): the
// win screen's reign prompt. A guest who won is offered the sign-in
// providers, landing on the home page; a signed-in winner watches their
// numbers move once the record lands, or sees the last numbers read when it
// never does.

function profile(
  victories: number,
  reigns: number,
  longest: number,
): UserMeResponse {
  return {
    user: {},
    ban: null,
    player: {
      publicId: "pub",
      adfree: true,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      username: "Alpha.0001",
      flares: [],
      achievements: { singleplayerMap: [], player: [] },
      record: {
        victories,
        reigns,
        longestReign: longest,
        gamesPlayed: victories + 2,
      },
    },
  } as unknown as UserMeResponse;
}

let prompt: ReignPrompt;

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await prompt.updateComplete;
}

async function mount(active: boolean): Promise<void> {
  prompt = document.createElement("reign-prompt") as ReignPrompt;
  prompt.active = active;
  document.body.append(prompt);
  await settle();
}

async function tickPoll(): Promise<void> {
  await vi.advanceTimersByTimeAsync(REIGN_POLL_MS);
  await settle();
}

const panel = () => prompt.querySelector("[data-reign-prompt]");
const mode = () => panel()?.getAttribute("data-reign-prompt") ?? null;
const title = () => panel()?.querySelector("span")?.textContent?.trim();
const figures = () =>
  Array.from(prompt.querySelectorAll("[data-reign-numbers] > div")).map(
    (d) => ({
      value: d.querySelector("div")?.textContent?.replace("+1", "").trim(),
      up: d.querySelector("[data-reign-up]") !== null,
    }),
  );

beforeEach(() => {
  vi.useFakeTimers();
  auth.signedIn = false;
  auth.cached = null;
  auth.fresh = [];
  auth.reads = 0;
  signIns.length = 0;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("the reign prompt", () => {
  it("renders nothing unless it is for the winner of a throne round", async () => {
    await mount(false);
    expect(panel()).toBeNull();
    expect(auth.reads).toBe(0);
  });

  it("offers a guest winner the providers, landing on the home page", async () => {
    await mount(true);
    expect(mode()).toBe("sign-in");
    expect(title()).toBe("win_modal.reign_sign_in_title");
    const buttons = Array.from(
      prompt.querySelectorAll<HTMLButtonElement>("[data-provider]"),
    );
    expect(buttons.map((b) => b.dataset.provider)).toEqual(["discord", "dev"]);
    expect(buttons[0].textContent?.trim()).toContain(
      "win_modal.reign_sign_in_with:account.provider_discord",
    );

    buttons[0].click();
    expect(signIns).toEqual([
      { provider: "discord", redirectTo: `${window.location.origin}/` },
    ]);
    // No polling for a guest: there is nothing to record.
    await vi.advanceTimersByTimeAsync(REIGN_POLL_MS * 3);
    expect(auth.reads).toBe(0);
  });

  it("shows a signed-in winner the numbers once they move", async () => {
    auth.signedIn = true;
    auth.cached = profile(2, 2, 2);
    // The record has not landed on the first poll; it has on the second,
    // and as the Hegemon held the timer, the reign numbers grew too.
    auth.fresh = [profile(2, 2, 2), profile(3, 3, 3)];
    await mount(true);
    expect(mode()).toBe("numbers");
    expect(prompt.querySelector("[data-reign-recording]")).not.toBeNull();

    await tickPoll();
    expect(auth.reads).toBe(1);
    expect(prompt.querySelector("[data-reign-recording]")).not.toBeNull();

    await tickPoll();
    expect(auth.reads).toBe(2);
    expect(title()).toBe("win_modal.reign_recorded");
    expect(figures()).toEqual([
      { value: "3", up: true },
      { value: "3", up: true },
      { value: "3", up: true },
    ]);

    // Settled: no further reads.
    await vi.advanceTimersByTimeAsync(REIGN_POLL_MS * 3);
    expect(auth.reads).toBe(2);
  });

  it("marks only the victory for a slayer, whose reign numbers stand", async () => {
    auth.signedIn = true;
    auth.cached = profile(4, 4, 4);
    auth.fresh = [profile(5, 4, 4)];
    await mount(true);
    await tickPoll();
    expect(figures()).toEqual([
      { value: "5", up: true },
      { value: "4", up: false },
      { value: "4", up: false },
    ]);
  });

  it("gives up after the poll limit and shows the last numbers read", async () => {
    auth.signedIn = true;
    auth.cached = profile(2, 2, 2);
    auth.fresh = [profile(2, 2, 2)];
    await mount(true);
    for (let i = 0; i < REIGN_POLL_LIMIT; i++) await tickPoll();
    expect(auth.reads).toBe(REIGN_POLL_LIMIT);
    expect(title()).toBe("win_modal.reign_pending");
    expect(figures()).toEqual([
      { value: "2", up: false },
      { value: "2", up: false },
      { value: "2", up: false },
    ]);
    await vi.advanceTimersByTimeAsync(REIGN_POLL_MS * 2);
    expect(auth.reads).toBe(REIGN_POLL_LIMIT);
  });

  it("takes the first numbers it gets when none were cached", async () => {
    auth.signedIn = true;
    auth.cached = false;
    auth.fresh = [profile(1, 0, 0)];
    await mount(true);
    await tickPoll();
    expect(auth.reads).toBe(1);
    expect(title()).toBe("win_modal.reign_pending");
    expect(figures()).toEqual([
      { value: "1", up: false },
      { value: "0", up: false },
      { value: "0", up: false },
    ]);
  });

  it("stops polling when removed from the page", async () => {
    auth.signedIn = true;
    auth.cached = profile(2, 2, 2);
    auth.fresh = [profile(2, 2, 2)];
    await mount(true);
    await tickPoll();
    prompt.remove();
    await vi.advanceTimersByTimeAsync(REIGN_POLL_MS * 3);
    expect(auth.reads).toBe(1);
  });
});
