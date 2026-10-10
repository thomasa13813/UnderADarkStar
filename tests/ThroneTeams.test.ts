import { describe, expect, it } from "vitest";
import { Duos, HumansVsNations, Quads, Trios } from "../src/core/game/Game";
import { isThroneTeamSplit, THRONE_TEAM_SPLITS } from "../src/core/ThroneTeams";

// Under a Dark Star, L30: the team splits a team throne's winner may set.
describe("the throne team splits", () => {
  it("offers fixed counts and sized teams, never Humans vs Nations", () => {
    expect(THRONE_TEAM_SPLITS).toEqual([2, 3, 4, 5, 6, 7, Duos, Trios, Quads]);
    expect(THRONE_TEAM_SPLITS).not.toContain(HumansVsNations);
  });

  it("accepts only the listed splits", () => {
    for (const split of THRONE_TEAM_SPLITS) {
      expect(isThroneTeamSplit(split)).toBe(true);
    }
    for (const bad of [1, 8, 0, -2, 2.5, HumansVsNations, "2", "duos", null]) {
      expect(isThroneTeamSplit(bad)).toBe(false);
    }
  });
});
