/**
 * The help page's rules section (HelpModal.renderRules) is driven by a list
 * of sections, each `help_modal.rules_<name>_title` and
 * `help_modal.rules_<name>_1..n` in en.json, with the numbers it quotes read
 * from the core defaults. A missing string renders as its raw key and an
 * unfilled placeholder as "{name}", and nothing else would notice; these
 * tests do.
 */
import { describe, expect, it } from "vitest";
import en from "../../resources/lang/en.json";
import { PIRACY_DEFAULTS } from "../../src/core/configuration/Config";

const { RULES_SECTIONS, rulesParams } =
  await import("../../src/client/HelpModal");

const strings = en.help_modal as Record<string, string>;

describe("the help page's rules", () => {
  it("has every section's title and numbered lines in en.json", () => {
    for (const [name, count] of RULES_SECTIONS) {
      expect(strings[`rules_${name}_title`], `rules_${name}_title`).toBeTypeOf(
        "string",
      );
      for (let n = 1; n <= count; n++) {
        expect(strings[`rules_${name}_${n}`], `rules_${name}_${n}`).toBeTypeOf(
          "string",
        );
      }
      // The list is the whole section: no orphan line beyond the count.
      expect(strings[`rules_${name}_${count + 1}`]).toBeUndefined();
    }
  });

  it("fills every placeholder the rules use", () => {
    const params = rulesParams();
    for (const [name, count] of RULES_SECTIONS) {
      for (let n = 1; n <= count; n++) {
        const text = strings[`rules_${name}_${n}`];
        for (const match of text.matchAll(/\{(\w+)\}/g)) {
          expect(params, `{${match[1]}} in rules_${name}_${n}`).toHaveProperty(
            match[1],
          );
        }
      }
    }
  });

  it("explains piracy, in the player's units", () => {
    const names = RULES_SECTIONS.map(([name]) => name);
    expect(names).toContain("piracy");
    // Piracy follows the economy it preys on and precedes the thrones.
    expect(names.indexOf("piracy")).toBe(names.indexOf("gift") + 1);
    expect(names.indexOf("piracy")).toBeLessThan(names.indexOf("throne"));

    const params = rulesParams();
    // The engine stores troops ten times the figure on screen.
    expect(params.raidTroops).toBe(PIRACY_DEFAULTS.raidTroops / 10);
    expect(params.holdCap).toBe("2,500");
    expect(params.raidGold).toBe("10K");
    expect(params.pirateWait).toBe(PIRACY_DEFAULTS.respawnSeconds);
    expect(params.claimTiles).toBe(PIRACY_DEFAULTS.landingTiles);

    // The elimination rule points at it.
    expect(strings.rules_round_6).toMatch(/piracy/i);
  });

  it("calls the freighter stat Raid Gold", () => {
    expect((en.leaderboard as Record<string, string>).piracyGoldPerMin).toBe(
      "Raid Gold/min",
    );
  });
});
