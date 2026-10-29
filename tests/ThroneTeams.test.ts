import { describe, expect, it } from "vitest";
import { Duos, HumansVsNations, Quads, Trios } from "../src/core/game/Game";
import { isThroneTeamSplit, THRONE_TEAM_SPLITS } from "../src/core/ThroneTeams";

// Under a Dark Star, L30 as narrowed by L37: the team splits a team room's
// winner may set, a count of 2 to 7.
describe("the throne team splits", () => {
  it("offers counts of 2 to 7, no sized teams, never Humans vs Nations", () => {
    expect(THRONE_TEAM_SPLITS).toEqual([2, 3, 4, 5, 6, 7]);
    expect(THRONE_TEAM_SPLITS).not.toContain(HumansVsNations);
    for (const sized of [Duos, Trios, Quads]) {
      expect(THRONE_TEAM_SPLITS).not.toContain(sized);
    }
  });

  it("accepts only the listed splits", () => {
    for (const split of THRONE_TEAM_SPLITS) {
      expect(isThroneTeamSplit(split)).toBe(true);
    }
    for (const bad of [
      1,
      8,
      0,
      -2,
      2.5,
      HumansVsNations,
      Duos,
      Trios,
      Quads,
      "2",
      null,
    ]) {
      expect(isThroneTeamSplit(bad)).toBe(false);
    }
  });
});
