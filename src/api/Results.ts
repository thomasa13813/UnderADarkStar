import { DatabaseSync } from "node:sqlite";
import { GameType } from "../core/game/Game";
import { nextReign, ReignOutcome } from "../core/Reign";
import { GameRecord, PlayerRecord } from "../core/Schemas";

// Under a Dark Star: the results ingest (docs/DarkStar-Accounts.md §5.3,
// §5.4, §5.5). A game record arrives from the game server when a round's
// winner vote resolves; a public throne round becomes one `rounds` row, one
// `round_players` row per signed-in player, and an update of the winner's
// `stats`. Guests, the AI, private lobbies and solo games record nothing.
// `stats` is a cache of `rounds` and `round_players`: rebuildStats recomputes
// it from scratch.

export interface AccountStats {
  thronesTaken: number;
  roundsHeld: number;
  longestReign: number;
  gamesPlayed: number;
}

export const EMPTY_STATS: AccountStats = {
  thronesTaken: 0,
  roundsHeld: 0,
  longestReign: 0,
  gamesPlayed: 0,
};

// Reigns is the total of rounds won (A5).
export function reigns(stats: AccountStats): number {
  return stats.thronesTaken + stats.roundsHeld;
}

export type IngestResult =
  // Not a public throne round: stored, nothing recorded.
  | { kind: "ignored"; reason: "private" | "solo" | "no-throne" }
  // Seen before: nothing changed.
  | { kind: "duplicate" }
  | {
      kind: "recorded";
      outcome: ReignOutcome;
      winnerAccount: string | null;
      reignAfter: number;
      verifiedPlayers: number;
    };

// The round a record describes, as the ingest reads it.
export interface RoundSummary {
  outcome: ReignOutcome;
  // The Hegemon at the start and the winner, by persistentID, null for the
  // AI or an absent winner. Unverified players are still named here; the
  // ingest decides what to credit.
  hegemonID: string | null;
  winnerID: string | null;
  hegemonVerified: boolean;
  winnerVerified: boolean;
}

// What happened in the round, from the record alone (§5.3 step 4).
export function summarizeRound(record: GameRecord): RoundSummary {
  const players = record.info.players;
  const hegemon = players.find((p) => p.isHegemon === true);
  const winner = record.info.winner;
  let outcome: ReignOutcome = "void";
  let winnerPlayer: PlayerRecord | undefined;
  if (winner !== undefined) {
    if (winner[0] === "nation") {
      outcome = "ai";
    } else if (winner[0] === "player") {
      winnerPlayer = players.find((p) => p.clientID === winner[1]);
      if (winnerPlayer !== undefined) {
        outcome = winnerPlayer.isHegemon === true ? "timer" : "overthrown";
      }
    }
    // A "team" winner cannot come out of a throne round (victory runs through
    // the Hegemon, WinCheckExecution.checkWinnerHegemon); it stays void.
  }
  return {
    outcome,
    hegemonID: idOf(hegemon),
    winnerID: idOf(winnerPlayer),
    hegemonVerified: hegemon?.verified === true,
    winnerVerified: winnerPlayer?.verified === true,
  };
}

function idOf(p: PlayerRecord | undefined): string | null {
  return p === undefined || p.persistentID === null || p.persistentID === ""
    ? null
    : p.persistentID;
}

// Records a game. The caller has already checked the key and stored the
// record; this is the database side, one transaction, idempotent on game ID.
export function ingestRecord(
  db: DatabaseSync,
  record: GameRecord,
  now: number,
): IngestResult {
  const info = record.info;
  if (info.config.gameType === GameType.Singleplayer) {
    return { kind: "ignored", reason: "solo" };
  }
  if (info.config.gameType !== GameType.Public) {
    return { kind: "ignored", reason: "private" };
  }
  const throne = info.throne;
  if (throne === undefined) {
    return { kind: "ignored", reason: "no-throne" };
  }
  const seen = db
    .prepare("SELECT 1 FROM rounds WHERE game_id = ?")
    .get(info.gameID);
  if (seen !== undefined) return { kind: "duplicate" };

  const summary = summarizeRound(record);
  const reignAfter = nextReign(summary.outcome, throne.reignBefore);

  // A verified player is credited only while their account exists: the
  // stats row has a foreign key to accounts, and a deleted account's rounds
  // stay anonymous (A17).
  const accountExists = db.prepare(
    "SELECT 1 FROM accounts WHERE id = ? AND deleted_at IS NULL",
  );
  const creditable = (id: string | null, verified: boolean): string | null =>
    id !== null && verified && accountExists.get(id) !== undefined ? id : null;
  const hegemonAccount = creditable(summary.hegemonID, summary.hegemonVerified);
  const winnerAccount = creditable(summary.winnerID, summary.winnerVerified);

  // Every verified player of the round, once each (the game server keys
  // clients on persistentID, so a repeat would be a malformed record).
  const participants = new Map<string, { wasHegemon: boolean; won: boolean }>();
  for (const p of info.players) {
    const id = creditable(p.persistentID, p.verified === true);
    if (id === null || participants.has(id)) continue;
    participants.set(id, {
      wasHegemon: p.isHegemon === true,
      won: id === winnerAccount,
    });
  }

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO rounds (game_id, throne_id, throne_name, throne_type, map, started_at, ended_at,
         humans, outcome, hegemon_account, winner_account, reign_after, git_commit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      info.gameID,
      throne.throneID,
      throne.name,
      throne.type,
      info.config.gameMap,
      Math.floor(info.start),
      Math.floor(info.end),
      info.players.length,
      summary.outcome,
      hegemonAccount,
      winnerAccount,
      reignAfter,
      record.gitCommit,
    );
    const insertPlayer = db.prepare(
      "INSERT INTO round_players (game_id, account_id, was_hegemon, won) VALUES (?, ?, ?, ?)",
    );
    for (const [accountId, p] of participants) {
      insertPlayer.run(
        info.gameID,
        accountId,
        p.wasHegemon ? 1 : 0,
        p.won ? 1 : 0,
      );
      applyToStats(
        db,
        accountId,
        p.won ? summary.outcome : "void",
        reignAfter,
        now,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return {
    kind: "recorded",
    outcome: summary.outcome,
    winnerAccount,
    reignAfter,
    verifiedPlayers: participants.size,
  };
}

// One account's stats after one more round: games played always; a win adds
// a throne taken or a round held and may raise the longest reign (§5.4).
function applyToStats(
  db: DatabaseSync,
  accountId: string,
  wonBy: ReignOutcome,
  reignAfter: number,
  now: number,
): void {
  const taken = wonBy === "overthrown" ? 1 : 0;
  const held = wonBy === "timer" ? 1 : 0;
  const reign = taken + held > 0 ? reignAfter : 0;
  db.prepare(
    `INSERT INTO stats (account_id, thrones_taken, rounds_held, longest_reign, games_played, updated_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       thrones_taken = thrones_taken + excluded.thrones_taken,
       rounds_held = rounds_held + excluded.rounds_held,
       longest_reign = MAX(longest_reign, excluded.longest_reign),
       games_played = games_played + 1,
       updated_at = excluded.updated_at`,
  ).run(accountId, taken, held, reign, now);
}

// An account's numbers, zero for an account with no rounds.
export function statsFor(db: DatabaseSync, accountId: string): AccountStats {
  const row = db
    .prepare(
      "SELECT thrones_taken, rounds_held, longest_reign, games_played FROM stats WHERE account_id = ?",
    )
    .get(accountId) as
    | {
        thrones_taken: number;
        rounds_held: number;
        longest_reign: number;
        games_played: number;
      }
    | undefined;
  if (row === undefined) return EMPTY_STATS;
  return {
    thronesTaken: row.thrones_taken,
    roundsHeld: row.rounds_held,
    longestReign: row.longest_reign,
    gamesPlayed: row.games_played,
  };
}

// Recomputes every stats row from rounds and round_players (§5.5). This is
// also how a banned or deleted account leaves the board: it has no account
// row to credit, so it gets no stats row. Returns the number of rows written.
export function rebuildStats(db: DatabaseSync, now: number): number {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM stats");
    const result = db
      .prepare(
        `INSERT INTO stats (account_id, thrones_taken, rounds_held, longest_reign, games_played, updated_at)
         SELECT a.id,
           (SELECT COUNT(*) FROM rounds r WHERE r.winner_account = a.id AND r.outcome = 'overthrown'),
           (SELECT COUNT(*) FROM rounds r WHERE r.winner_account = a.id AND r.outcome = 'timer'),
           COALESCE((SELECT MAX(r.reign_after) FROM rounds r WHERE r.winner_account = a.id), 0),
           (SELECT COUNT(*) FROM round_players rp WHERE rp.account_id = a.id),
           ?
         FROM accounts a
         WHERE a.deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM round_players rp WHERE rp.account_id = a.id)`,
      )
      .run(now);
    db.exec("COMMIT");
    return Number(result.changes);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
