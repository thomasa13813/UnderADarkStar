import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LOCAL_SOLO_PRESETS_KEY,
  LocalSoloPresetStore,
} from "../../src/client/SoloPresetsApi";
import { MAX_SOLO_PRESETS } from "../../src/core/SoloPresets";

// Under a Dark Star, saved solo setups (docs/DarkStar-Accounts.md §12.11): a
// guest's live in this browser under the account's rules.

describe("LocalSoloPresetStore", () => {
  let clock = 1000;
  const store = () => new LocalSoloPresetStore(() => clock++);

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("saves, lists by name and survives a new store", async () => {
    await store().save("Zeta", { bots: 1 });
    await store().save(" alpha ", { bots: 2 });
    const listed = await store().list();
    expect(
      listed.ok && listed.presets.map((p) => [p.name, p.settings]),
    ).toEqual([
      ["alpha", { bots: 2 }],
      ["Zeta", { bots: 1 }],
    ]);
  });

  it("replaces a setup saved again under its name, in any case", async () => {
    const first = await store().save("Quick", { bots: 1 });
    const again = await store().save("QUICK", { bots: 9 });
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.presets).toHaveLength(1);
    expect(again.presets[0]).toMatchObject({
      id: first.presets[0].id,
      name: "QUICK",
      settings: { bots: 9 },
    });
  });

  it("holds at most the limit and refuses a bad name", async () => {
    for (let i = 0; i < MAX_SOLO_PRESETS; i++) {
      expect((await store().save(`P${i}`, {})).ok).toBe(true);
    }
    expect(await store().save("One more", {})).toEqual({
      ok: false,
      code: "full",
    });
    expect((await store().save("p0", { bots: 3 })).ok).toBe(true);
    expect(await store().save("   ", {})).toEqual({
      ok: false,
      code: "invalid",
    });
  });

  it("deletes by ID", async () => {
    const saved = await store().save("Gone", {});
    if (!saved.ok) throw new Error("save failed");
    const after = await store().remove(saved.presets[0].id);
    expect(after).toEqual({ ok: true, presets: [] });
  });

  it("reads damaged storage as empty", async () => {
    localStorage.setItem(LOCAL_SOLO_PRESETS_KEY, "{not json");
    expect(await store().list()).toEqual({ ok: true, presets: [] });
    localStorage.setItem(LOCAL_SOLO_PRESETS_KEY, JSON.stringify([{ id: 1 }]));
    expect(await store().list()).toEqual({ ok: true, presets: [] });
  });
});
