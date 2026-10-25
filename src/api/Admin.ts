import { DatabaseSync } from "node:sqlite";
import { AccountRow, activeBan, deleteAccount, displayName } from "./Accounts";
import { revokeAllSessions } from "./Sessions";

// Under a Dark Star: moderation by command line (docs/DarkStar-Accounts.md
// A18, §10, B6). The operations behind `npm run api:admin` (AdminCli.ts),
// kept here so they are tested against a real database.
//
// A ban is two columns on the account: `ban_reason` and `ban_until` (null for
// a permanent ban). While it is in force the next token carries
// `role: "banned"` (within the token's 15 minutes), the game server refuses
// that token at join, the account leaves the leaderboard, and it cannot
// delete itself. A guest has no account to ban.

export const DEFAULT_BAN_REASON = "Broke the rules";

// An account named the way Tom will have it in hand: its public ID, or the
// board's Name.1234, or a bare name (when only one account has it). Deleted
// accounts are never found.
export type FindResult =
  | { kind: "found"; account: AccountRow }
  | { kind: "none" }
  | { kind: "several"; accounts: AccountRow[] };

export function findAccount(db: DatabaseSync, query: string): FindResult {
  const live = (rows: AccountRow[]) =>
    rows.filter((r) => r.deleted_at === null);
  const byPublicId = live(
    db
      .prepare("SELECT * FROM accounts WHERE public_id = ?")
      .all(query) as unknown as AccountRow[],
  );
  if (byPublicId.length === 1) return { kind: "found", account: byPublicId[0] };
  const tagged = /^(.+)\.(\d{4})$/.exec(query);
  const rows = live(
    (tagged !== null
      ? db
          .prepare(
            "SELECT * FROM accounts WHERE name = ? COLLATE NOCASE AND tag = ?",
          )
          .all(tagged[1], tagged[2])
      : db
          .prepare(
            "SELECT * FROM accounts WHERE name = ? COLLATE NOCASE ORDER BY created_at",
          )
          .all(query)) as unknown as AccountRow[],
  );
  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1) return { kind: "found", account: rows[0] };
  return { kind: "several", accounts: rows };
}

// Accounts whose name contains the text, newest first, for when Tom has
// only part of a name.
export function searchAccounts(
  db: DatabaseSync,
  text: string,
  limit: number = 20,
): AccountRow[] {
  const escaped = text.replace(/[\\%_]/g, (c) => `\\${c}`);
  return db
    .prepare(
      `SELECT * FROM accounts
       WHERE deleted_at IS NULL AND name LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(`%${escaped}%`, limit) as unknown as AccountRow[];
}

// The signed-in players of one recorded public throne round, for a report
// that names a game: the round's ID is in the game's address and on its
// screen. Guests and private games are not recorded.
export function roundAccounts(db: DatabaseSync, gameId: string): AccountRow[] {
  return db
    .prepare(
      `SELECT a.* FROM round_players p JOIN accounts a ON a.id = p.account_id
       WHERE p.game_id = ? AND a.deleted_at IS NULL
       ORDER BY a.name COLLATE NOCASE`,
    )
    .all(gameId) as unknown as AccountRow[];
}

// Every account under a ban that is still in force, newest account first.
export function bannedAccounts(db: DatabaseSync, now: number): AccountRow[] {
  return (
    db
      .prepare(
        `SELECT * FROM accounts
         WHERE deleted_at IS NULL
           AND (ban_reason IS NOT NULL OR ban_until IS NOT NULL)
         ORDER BY created_at DESC`,
      )
      .all() as unknown as AccountRow[]
  ).filter((account) => activeBan(account, now) !== null);
}

export function banAccount(
  db: DatabaseSync,
  accountId: string,
  options: { reason?: string; days?: number },
  now: number,
): void {
  const given = options.reason?.trim() ?? "";
  const reason = given === "" ? DEFAULT_BAN_REASON : given;
  const until =
    options.days === undefined
      ? null
      : now + Math.round(options.days * 24 * 60 * 60 * 1000);
  db.prepare(
    "UPDATE accounts SET ban_reason = ?, ban_until = ? WHERE id = ? AND deleted_at IS NULL",
  ).run(reason, until, accountId);
}

export function unbanAccount(db: DatabaseSync, accountId: string): void {
  db.prepare(
    "UPDATE accounts SET ban_reason = NULL, ban_until = NULL WHERE id = ?",
  ).run(accountId);
}

// Delete on request (the privacy policy's email route), ban or no ban:
// lifts any ban, then deletes as the player's own button does (A17).
export function adminDeleteAccount(
  db: DatabaseSync,
  accountId: string,
  now: number,
): boolean {
  unbanAccount(db, accountId);
  return deleteAccount(db, accountId, now) === "deleted";
}

// Sign the account out everywhere: its next refresh fails and the page
// shows it signed out. Its current token lives out its 15 minutes.
export function signOutEverywhere(
  db: DatabaseSync,
  accountId: string,
  now: number,
): number {
  return revokeAllSessions(db, accountId, now);
}

// One line per account for the command's output.
export function describeAccount(account: AccountRow, now: number): string {
  const ban = activeBan(account, now);
  const banText =
    ban === null
      ? ""
      : ban.until === null
        ? `  BANNED (permanent): ${ban.reason ?? ""}`
        : `  BANNED until ${new Date(ban.until).toISOString()}: ${ban.reason ?? ""}`;
  const created = new Date(account.created_at).toISOString().slice(0, 10);
  return `${displayName(account)}  id ${account.public_id}  since ${created}${banText}`;
}
