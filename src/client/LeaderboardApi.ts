import {
  LeaderboardBoard,
  LeaderboardResponse,
  LeaderboardResponseSchema,
} from "../core/ApiSchemas";
import { getApiBase } from "./ApiBase";
import { getAuthHeader } from "./Auth";

// Under a Dark Star: reading the leaderboard (docs/DarkStar-Accounts.md §6).
// Public: a guest reads it the same as anyone; a signed-in player's token
// goes along so the API can add their own row. Kept apart from Api.ts,
// which is the upstream account/shop client and far larger than it needs
// to be here.

export const LEADERBOARD_TIMEOUT_MS = 10_000;

// The board, or null when the API could not be reached or answered with
// something else: the page then says so and offers a retry.
export async function fetchLeaderboard(
  board: LeaderboardBoard,
): Promise<LeaderboardResponse | null> {
  try {
    const headers: Record<string, string> = {};
    const auth = await getAuthHeader();
    if (auth !== "") headers.authorization = auth;
    const response = await fetch(
      `${getApiBase()}/leaderboard?board=${encodeURIComponent(board)}`,
      { headers, signal: AbortSignal.timeout(LEADERBOARD_TIMEOUT_MS) },
    );
    if (!response.ok) {
      console.warn(`leaderboard: ${response.status}`);
      return null;
    }
    const parsed = LeaderboardResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.warn("leaderboard: unexpected answer", parsed.error);
      return null;
    }
    return parsed.data;
  } catch (error) {
    console.warn("leaderboard: unreachable", error);
    return null;
  }
}
