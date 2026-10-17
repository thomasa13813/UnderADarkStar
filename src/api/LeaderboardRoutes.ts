import { Express } from "express";
import { DatabaseSync } from "node:sqlite";
import {
  LeaderboardEntry,
  LeaderboardResponse,
  LeaderboardSort,
  LeaderboardSortSchema,
} from "../core/ApiSchemas";
import { BearerVerifier } from "./Bearer";
import { ApiConfig } from "./Config";
import { SigningKey } from "./Keys";
import { leaderboard, ownRow } from "./Leaderboard";

// Under a Dark Star: GET /leaderboard (docs/DarkStar-Accounts.md §6, §7).
// Public, no sign-in needed; the top of the list under each sort is computed
// at most once a minute. A caller who sends their token also gets their own
// row, read live (it is one small query, and it is theirs), so the page can
// pin it under the list when they are outside the top 100.

export interface LeaderboardDeps {
  config: ApiConfig;
  db: DatabaseSync;
  key: SigningKey;
  now?: () => number;
}

export const LEADERBOARD_CACHE_MS = 60 * 1000;

export function mountLeaderboardRoutes(
  app: Express,
  deps: LeaderboardDeps,
): void {
  const { db } = deps;
  const now = deps.now ?? (() => Date.now());
  const bearer = new BearerVerifier(deps.key, deps.config);
  const cache = new Map<
    LeaderboardSort,
    { generatedAt: number; entries: LeaderboardEntry[] }
  >();

  const top = (sort: LeaderboardSort) => {
    const at = now();
    const kept = cache.get(sort);
    if (kept !== undefined && at - kept.generatedAt < LEADERBOARD_CACHE_MS) {
      return kept;
    }
    const fresh = { generatedAt: at, entries: leaderboard(db, sort, at) };
    cache.set(sort, fresh);
    return fresh;
  };

  app.get("/leaderboard", async (req, res, next) => {
    try {
      const parsed = LeaderboardSortSchema.safeParse(
        req.query.sort ?? "victories",
      );
      if (!parsed.success) {
        res.status(400).json({ error: "unknown sort" });
        return;
      }
      const sort = parsed.data;
      const { generatedAt, entries } = top(sort);
      const accountId = await bearer.accountId(req);
      const body: LeaderboardResponse = {
        sort,
        generatedAt,
        entries,
        me: accountId === null ? null : ownRow(db, sort, accountId, now()),
      };
      // Anonymous answers are the same for everyone and may sit in a shared
      // cache for the minute the list is held; an answer with an own row is
      // personal.
      res.setHeader(
        "Cache-Control",
        accountId === null ? "public, max-age=60" : "private, max-age=60",
      );
      res.append("Vary", "Authorization");
      res.json(body);
    } catch (error) {
      next(error);
    }
  });
}
