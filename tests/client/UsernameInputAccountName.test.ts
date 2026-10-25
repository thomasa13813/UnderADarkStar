import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Under a Dark Star, A13 (revised 2026-10-25, Tom): one name per account,
// renamed at once and as often as the player likes. A signed-in player's
// name box shows the account's name and saves what they type to the account.

const api = vi.hoisted(() => ({
  base: "Tom",
  renames: [] as string[],
  fail: false,
}));

function profile() {
  return {
    user: {},
    player: {
      publicId: "p",
      username: `${api.base}.0001`,
      usernameBase: api.base,
    },
  };
}

vi.mock("../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => profile()),
  invalidateUserMe: vi.fn(),
  updateUsername: vi.fn(async (name: string) => {
    if (api.fail) return { ok: false, code: "failed" };
    api.renames.push(name);
    api.base = name;
    return { ok: true, data: {} };
  }),
}));
vi.mock("../../src/client/ClanApi", () => ({
  checkClanTagOwnership: vi.fn(async (tag: string) => ({ tag, error: null })),
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameConfirm: vi.fn(async () => false),
  showInGameAlert: vi.fn(async () => true),
}));
vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string) => key,
}));

import "../../src/client/UsernameInput";
import type { UsernameInput as UsernameInputEl } from "../../src/client/UsernameInput";

async function mount(): Promise<UsernameInputEl> {
  const el = document.createElement("username-input") as UsernameInputEl;
  document.body.appendChild(el);
  await el.updateComplete;
  document.dispatchEvent(
    new CustomEvent("userMeResponse", { detail: profile() }),
  );
  await el.updateComplete;
  return el;
}

function box(el: UsernameInputEl): HTMLInputElement {
  return el.querySelector<HTMLInputElement>(
    'input[aria-label="username.enter_username"]',
  )!;
}

async function type(el: UsernameInputEl, value: string) {
  const input = box(el);
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  api.base = "Tom";
  api.renames = [];
  api.fail = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a signed-in player's name box is the account's name", () => {
  it("shows the account name, even over a name stored in this browser", async () => {
    localStorage.setItem("username", "OldLocalName");
    const el = await mount();
    expect(box(el).value).toBe("Tom");
    expect(el.resolvedName().name).toBe("Tom");
  });

  it("saves a typed name to the account a moment after typing stops", async () => {
    vi.useFakeTimers();
    const el = await mount();
    await type(el, "StarLord");
    expect(api.renames).toEqual([]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(api.renames).toEqual(["StarLord"]);
    // Renamed again at once: no waiting period.
    await type(el, "StarLord2");
    await el.whenNameSaved();
    expect(api.renames).toEqual(["StarLord", "StarLord2"]);
  });

  it("saves at once when the player leaves the box, and before a join", async () => {
    const el = await mount();
    await type(el, "Blurred");
    box(el).dispatchEvent(new Event("blur"));
    await el.whenNameSaved();
    expect(api.renames).toEqual(["Blurred"]);

    await type(el, "Joiner");
    await el.whenNameSaved();
    expect(api.renames).toEqual(["Blurred", "Joiner"]);
  });

  it("holds a name outside the account rules back, with the reason", async () => {
    const el = await mount();
    await type(el, "Ada.Lovelace");
    await el.whenNameSaved();
    expect(api.renames).toEqual([]);
    expect(el.canPlay()).toBe(false);
    expect(el.validationError).toBe("username.account_invalid_chars");
  });

  it("says so when the save fails, and keeps what was typed", async () => {
    api.fail = true;
    const el = await mount();
    await type(el, "Unsaved");
    await el.whenNameSaved();
    expect(el.validationError).toBe("username.save_failed");
    expect(box(el).value).toBe("Unsaved");
  });

  it("does not overwrite an edit not yet saved when the profile arrives", async () => {
    vi.useFakeTimers();
    const el = await mount();
    await type(el, "Typing");
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: profile() }),
    );
    await el.updateComplete;
    expect(box(el).value).toBe("Typing");
  });
});
