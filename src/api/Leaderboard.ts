import { DatabaseSync } from "node:sqlite";
import { LeaderboardBoard, LeaderboardEntry } from "../core/ApiSchemas";

// Under a Dark Star: the leaderboard (docs/DarkStar-Accounts.md §6). Two
// boards over the same `stats` cache: Reigns (every round won, thrones
// taken plus rounds held) and Longest reign (the most consecutive wins on
// one throne). An account is on a board once it has won a round; banned and
// deleted accounts are left off (§10) without touching their rows, so a ban
// lifted puts them back. Ranks are shared on a tie of the board's number
// (1, 2, 2, 4); the other number and then the name settle display order.

export const LEADERBOARD_SIZE = 100;

export type OwnRow = Omit<LeaderboardEntry, "rank"> & { rank: number | null };

interface Row {
  rank: number;
  public_id: string;
  name: string;
  tag: string;
  thrones_taken: number;
  rounds_held: number;
  longest_reign: number;
}

// A board's headline number and the one that orders a shared rank.
function columns(board: LeaderboardBoard): { lead: string; next: string } {
  return board === "reigns"
    ? { lead: "reigns", next: "longest_reign" }
    : { lead: "longest_reign", next: "reigns" };
}

// One query per board: the eligible accounts ranked over the whole table,
// so a rank read for one account agrees with the rank in the top list. The
// rank is on the headline number alone (two players with three reigns share
// a rank whatever their longest reigns); the other number is display order.
function rankedSql(board: LeaderboardBoard): string {
  const { lead, next } = columns(board);
  return `
    SELECT
      RANK() OVER (ORDER BY s.${lead} DESC) AS rank,
      s.${next} AS next,
      a.public_id, a.name, a.tag,
      s.thrones_taken, s.rounds_held, s.longest_reign
    FROM (
      SELECT *, thrones_taken + rounds_held AS reigns FROM stats
    ) s
    JOIN accounts a ON a.id = s.account_id
    WHERE s.reigns > 0
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
    reigns: row.thrones_taken + row.rounds_held,
    longestReign: row.longest_reign,
    thronesTaken: row.thrones_taken,
    roundsHeld: row.rounds_held,
  };
}

// The top of a board, in display order.
export function leaderboard(
  db: DatabaseSync,
  board: LeaderboardBoard,
  now: number,
  limit: number = LEADERBOARD_SIZE,
): LeaderboardEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM (${rankedSql(board)})
       ORDER BY rank, next DESC, name COLLATE NOCASE, tag
       LIMIT ?`,
    )
    .all(now, limit) as unknown as Row[];
  return rows.map(entry);
}

// One account's own row: its rank on the board when it is on it, else its
// numbers with a null rank. Null for an account that does not exist or is
// deleted. A banned account sees itself unranked, which is what the board
// shows everyone else.
export function ownRow(
  db: DatabaseSync,
  board: LeaderboardBoard,
  accountId: string,
  now: number,
): OwnRow | null {
  const ranked = db
    .prepare(
      `SELECT r.* FROM (${rankedSql(board)}) r
       JOIN accounts a ON a.public_id = r.public_id
       WHERE a.id = ?`,
    )
    .get(now, accountId) as unknown as Row | undefined;
  if (ranked !== undefined) return entry(ranked);
  const row = db
    .prepare(
      `SELECT a.public_id, a.name, a.tag,
         COALESCE(s.thrones_taken, 0) AS thrones_taken,
         COALESCE(s.rounds_held, 0) AS rounds_held,
         COALESCE(s.longest_reign, 0) AS longest_reign
       FROM accounts a
       LEFT JOIN stats s ON s.account_id = a.id
       WHERE a.id = ? AND a.deleted_at IS NULL`,
    )
    .get(accountId) as unknown as Omit<Row, "rank"> | undefined;
  if (row === undefined) return null;
  return { ...entry({ ...row, rank: 0 }), rank: null };
}
