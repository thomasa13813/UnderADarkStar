import { TeamCountConfig } from "./Schemas";

// Under a Dark Star: the team splits a team room's winner may set for the
// next round (docs/DarkStar-Lobbies.md L30 as narrowed by L37), shared by the
// server (the pick check) and the client (the chips). A count of teams, 2 to
// 7: latecomers balance a fixed count (L37), so teams of a size (Duos, Trios,
// Quads) are not offered in rooms, and never Humans vs Nations, since the
// throne is a third side to neither.
export const THRONE_TEAM_SPLITS: readonly TeamCountConfig[] = [
  2, 3, 4, 5, 6, 7,
];

export function isThroneTeamSplit(value: unknown): value is TeamCountConfig {
  return THRONE_TEAM_SPLITS.includes(value as TeamCountConfig);
}
