import {
  LeaderboardResponse,
  LeaderboardResponseSchema,
  LeaderboardSort,
} from "../core/ApiSchemas";
import { getApiBase } from "./ApiBase";
import { getAuthHeader } from "./Auth";

// Under a Dark Star: reading the leaderboard (docs/DarkStar-Accounts.md §6).
// Public: a guest reads it the same as anyone; a signed-in player's token
// goes along so the API can add their own row. Kept apart from Api.ts,
// which is the upstream account/shop client and far larger than it needs
// to be here.

export const LEADERBOARD_TIMEOUT_MS = 10_000;

// The list's names are masked by the name filter (B6) for everyone; the own
// row carries the name as its owner chose it, and a player sees that name on
// their row in the list too, never the masked one.
export function withOwnName(data: LeaderboardResponse): LeaderboardResponse {
  const me = data.me;
  if (me === null || me === undefined) return data;
  return {
    ...data,
    entries: data.entries.map((entry) =>
      entry.publicId === me.publicId
        ? { ...entry, username: me.username }
        : entry,
    ),
  };
}

// The list under one sort, or null when the API could not be reached or
// answered with something else: the page then says so and offers a retry.
export async function fetchLeaderboard(
  sort: LeaderboardSort,
): Promise<LeaderboardResponse | null> {
  try {
    const headers: Record<string, string> = {};
    const auth = await getAuthHeader();
    if (auth !== "") headers.authorization = auth;
    const response = await fetch(
      `${getApiBase()}/leaderboard?sort=${encodeURIComponent(sort)}`,
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
    return withOwnName(parsed.data);
  } catch (error) {
    console.warn("leaderboard: unreachable", error);
    return null;
  }
}
