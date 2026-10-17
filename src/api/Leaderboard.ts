import { DatabaseSync } from "node:sqlite";
import { LeaderboardEntry, LeaderboardSort } from "../core/ApiSchemas";

// Under a Dark Star: the leaderboard (docs/DarkStar-Accounts.md §6). One
// list over the `stats` cache with three numbers per account: victories
// (every round won, whether or not the winner took the throne), reigns
// (rounds played as Hegemon, won or lost) and longest reign (the most
// consecutive of them on one throne). The caller picks which number ranks
// the list. An account is on it once it has a victory or a reign; banned and
// deleted accounts are left off (§10) without touching their rows, so a ban
// lifted puts them back. Ranks are shared on a tie of the sorting number
// (1, 2, 2, 4); the other numbers and then the name settle display order.

export const LEADERBOARD_SIZE = 100;

export type OwnRow = Omit<LeaderboardEntry, "rank"> & { rank: number | null };

interface Row {
  rank: number;
  public_id: string;
  name: string;
  tag: string;
  victories: number;
  reigns: number;
  longest_reign: number;
}

// The column a sort ranks on, and the order of the others behind it.
const COLUMNS: Record<LeaderboardSort, string[]> = {
  victories: ["victories", "reigns", "longest_reign"],
  reigns: ["reigns", "longest_reign", "victories"],
  longest: ["longest_reign", "reigns", "victories"],
};

// One query per sort: the eligible accounts ranked over the whole table, so
// a rank read for one account agrees with the rank in the top list. The
// rank is on the sorting number alone (two players with three victories
// share a rank whatever their reigns); the other numbers are display order.
function rankedSql(sort: LeaderboardSort): string {
  const [lead, second, third] = COLUMNS[sort];
  return `
    SELECT
      RANK() OVER (ORDER BY s.${lead} DESC) AS rank,
      s.${second} AS second, s.${third} AS third,
      a.public_id, a.name, a.tag,
      s.victories, s.reigns, s.longest_reign
    FROM (
      SELECT thrones_taken + rounds_held AS victories,
        hegemon_rounds AS reigns, longest_reign, account_id
      FROM stats
    ) s
    JOIN accounts a ON a.id = s.account_id
    WHERE (s.victories > 0 OR s.reigns > 0)
      AND a.deleted_at IS NULL
      AND ((a.ban_reason IS NULL AND a.ban_until IS NULL)
           OR (a.ban_until IS NOT NULL AND a.ban_until <= ?))
  `;
}

function entry(row: Row): LeaderboardEntry {
  return {
    rank: Number(row.rank),
    publicId: row.public_id,
    username: `${row.name}.${row.tag}`,
    victories: row.victories,
    reigns: row.reigns,
    longestReign: row.longest_reign,
  };
}

// The top of the list under one sort, in display order.
export function leaderboard(
  db: DatabaseSync,
  sort: LeaderboardSort,
  now: number,
  limit: number = LEADERBOARD_SIZE,
): LeaderboardEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM (${rankedSql(sort)})
       ORDER BY rank, second DESC, third DESC, name COLLATE NOCASE, tag
       LIMIT ?`,
    )
    .all(now, limit) as unknown as Row[];
  return rows.map(entry);
}

// One account's own row: its rank under the sort when it is on the list,
// else its numbers with a null rank. Null for an account that does not exist
// or is deleted. A banned account sees itself unranked, which is what the
// list shows everyone else.
export function ownRow(
  db: DatabaseSync,
  sort: LeaderboardSort,
  accountId: string,
  now: number,
): OwnRow | null {
  const ranked = db
    .prepare(
      `SELECT r.* FROM (${rankedSql(sort)}) r
       JOIN accounts a ON a.public_id = r.public_id
       WHERE a.id = ?`,
    )
    .get(now, accountId) as unknown as Row | undefined;
  if (ranked !== undefined) return entry(ranked);
  const row = db
    .prepare(
      `SELECT a.public_id, a.name, a.tag,
         COALESCE(s.thrones_taken + s.rounds_held, 0) AS victories,
         COALESCE(s.hegemon_rounds, 0) AS reigns,
         COALESCE(s.longest_reign, 0) AS longest_reign
       FROM accounts a
       LEFT JOIN stats s ON s.account_id = a.id
       WHERE a.id = ? AND a.deleted_at IS NULL`,
    )
    .get(accountId) as unknown as Omit<Row, "rank"> | undefined;
  if (row === undefined) return null;
  return { ...entry({ ...row, rank: 0 }), rank: null };
}
