import { Duos, Quads, Trios } from "./game/Game";
import { TeamCountConfig } from "./Schemas";

// Under a Dark Star: the team splits a team throne's winner may set for the
// next round (docs/DarkStar-Lobbies.md L30), shared by the server (the pick
// check) and the client (the chips). Fixed team counts, or teams of a size;
// never Humans vs Nations, since the throne is a third side to neither.
export const THRONE_TEAM_SPLITS: readonly TeamCountConfig[] = [
  2,
  3,
  4,
  5,
  6,
  7,
  Duos,
  Trios,
  Quads,
];

export function isThroneTeamSplit(value: unknown): value is TeamCountConfig {
  return THRONE_TEAM_SPLITS.includes(value as TeamCountConfig);
}
