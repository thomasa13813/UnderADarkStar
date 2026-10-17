import { DatabaseSync } from "node:sqlite";
import { GameType } from "../core/game/Game";
import { nextReign, ReignOutcome } from "../core/Reign";
import { GameRecord, PlayerRecord } from "../core/Schemas";

// Under a Dark Star: the results ingest (docs/DarkStar-Accounts.md §5.3,
// §5.4, §5.5). A game record arrives from the game server when a round's
// winner vote resolves; a public throne round becomes one `rounds` row, one
// `round_players` row per signed-in player, and an update of the winner's
// and the Hegemon's `stats`. Guests, the AI, private lobbies and solo games
// record nothing. `stats` is a cache of `rounds` and `round_players`:
// rebuildStats recomputes it from scratch.

export interface AccountStats {
  // The two kinds of victory (A5): the killing blow, and the timer held.
  thronesTaken: number;
  roundsHeld: number;
  // Rounds played as Hegemon, won or lost (A5, revised 2026-10-17).
  reigns: number;
  // The most consecutive rounds played as Hegemon on one throne (A15).
  longestReign: number;
  gamesPlayed: number;
}

export const EMPTY_STATS: AccountStats = {
  thronesTaken: 0,
  roundsHeld: 0,
  reigns: 0,
  longestReign: 0,
  gamesPlayed: 0,
};

// Victories is the total of rounds won (A5), whether or not the winner then
// took the throne.
export function victories(stats: AccountStats): number {
  return stats.thronesTaken + stats.roundsHeld;
}

// The seated Hegemon's run on a throne, in rounds, including the round at
// hand (§5.4). The run continues from the throne's previous round when the
// same account sat there, won it, and came back as its confirmed holder
// (`reignBefore` above 0: a holder who steps down and claims the seat again
// in the lobby starts afresh, as the badge on screen does). A reign that
// starts on another throne is a new run: a Hegemon cannot carry one across
// thrones. Rows written before `reign_before` was stored (null) continue on
// the first two conditions alone.
export interface PreviousRound {
  hegemonAccount: string | null;
  winnerAccount: string | null;
  hegemonRun: number;
}

export function hegemonRun(
  hegemonAccount: string | null,
  reignBefore: number | null,
  previous: PreviousRound | undefined,
): number {
  if (hegemonAccount === null) return 0;
  const continues =
    previous !== undefined &&
    previous.hegemonAccount === hegemonAccount &&
    previous.winnerAccount === hegemonAccount &&
    (reignBefore === null || reignBefore > 0);
  return continues ? previous.hegemonRun + 1 : 1;
}

// The last round recorded on a throne before the one being written, in the
// order rounds are played (started_at, then insertion order for the tests'
// equal clocks). Rounds on one throne never overlap.
function previousRound(
  db: DatabaseSync,
  throneId: string,
): PreviousRound | undefined {
  const row = db
    .prepare(
      `SELECT hegemon_account, winner_account, hegemon_run FROM rounds
       WHERE throne_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`,
    )
    .get(throneId) as
    | {
        hegemon_account: string | null;
        winner_account: string | null;
        hegemon_run: number;
      }
    | undefined;
  if (row === undefined) return undefined;
  return {
    hegemonAccount: row.hegemon_account,
    winnerAccount: row.winner_account,
    hegemonRun: row.hegemon_run,
  };
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
  // The badge value after the round (Lobbies §3.1), kept on the row.
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
  const run = hegemonRun(
    hegemonAccount,
    throne.reignBefore,
    previousRound(db, throne.throneID),
  );

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
         humans, outcome, hegemon_account, winner_account, reign_after, git_commit,
         reign_before, hegemon_run)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      throne.reignBefore,
      run,
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
      applyToStats(db, accountId, {
        wonBy: p.won ? summary.outcome : "void",
        run: p.wasHegemon ? run : 0,
        now,
      });
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

// One account's stats after one more round (§5.4): games played always; a
// win adds a throne taken or a round held; a round sat as Hegemon (`run`
// above 0, the run it belongs to) adds a reign and may raise the longest.
function applyToStats(
  db: DatabaseSync,
  accountId: string,
  round: { wonBy: ReignOutcome; run: number; now: number },
): void {
  const taken = round.wonBy === "overthrown" ? 1 : 0;
  const held = round.wonBy === "timer" ? 1 : 0;
  const reigned = round.run > 0 ? 1 : 0;
  db.prepare(
    `INSERT INTO stats (account_id, thrones_taken, rounds_held, hegemon_rounds, longest_reign,
       games_played, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       thrones_taken = thrones_taken + excluded.thrones_taken,
       rounds_held = rounds_held + excluded.rounds_held,
       hegemon_rounds = hegemon_rounds + excluded.hegemon_rounds,
       longest_reign = MAX(longest_reign, excluded.longest_reign),
       games_played = games_played + 1,
       updated_at = excluded.updated_at`,
  ).run(accountId, taken, held, reigned, round.run, round.now);
}

// An account's numbers, zero for an account with no rounds.
export function statsFor(db: DatabaseSync, accountId: string): AccountStats {
  const row = db
    .prepare(
      `SELECT thrones_taken, rounds_held, hegemon_rounds, longest_reign, games_played
       FROM stats WHERE account_id = ?`,
    )
    .get(accountId) as
    | {
        thrones_taken: number;
        rounds_held: number;
        hegemon_rounds: number;
        longest_reign: number;
        games_played: number;
      }
    | undefined;
  if (row === undefined) return EMPTY_STATS;
  return {
    thronesTaken: row.thrones_taken,
    roundsHeld: row.rounds_held,
    reigns: row.hegemon_rounds,
    longestReign: row.longest_reign,
    gamesPlayed: row.games_played,
  };
}

// Recomputes every stats row from rounds and round_players (§5.5), after
// recomputing each round's Hegemon run from the throne's history in order.
// This is also how a banned or deleted account leaves the board: it has no
// account row to credit, so it gets no stats row. Returns the number of rows
// written.
export function rebuildStats(db: DatabaseSync, now: number): number {
  db.exec("BEGIN");
  try {
    const rows = rebuildStatsWithin(db, now);
    db.exec("COMMIT");
    return rows;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// The rebuild inside a transaction the caller holds (a migration's).
export function rebuildStatsWithin(db: DatabaseSync, now: number): number {
  rebuildRuns(db);
  db.exec("DELETE FROM stats");
  const result = db
    .prepare(
      `INSERT INTO stats (account_id, thrones_taken, rounds_held, hegemon_rounds, longest_reign,
         games_played, updated_at)
       SELECT a.id,
         (SELECT COUNT(*) FROM rounds r WHERE r.winner_account = a.id AND r.outcome = 'overthrown'),
         (SELECT COUNT(*) FROM rounds r WHERE r.winner_account = a.id AND r.outcome = 'timer'),
         (SELECT COUNT(*) FROM rounds r WHERE r.hegemon_account = a.id),
         COALESCE((SELECT MAX(r.hegemon_run) FROM rounds r WHERE r.hegemon_account = a.id), 0),
         (SELECT COUNT(*) FROM round_players rp WHERE rp.account_id = a.id),
         ?
       FROM accounts a
       WHERE a.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM round_players rp WHERE rp.account_id = a.id)`,
    )
    .run(now);
  return Number(result.changes);
}

// Every round's `hegemon_run`, from each throne's rounds in order, with the
// rule the ingest applies (hegemonRun). Inside the caller's transaction.
function rebuildRuns(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT rowid AS id, throne_id, hegemon_account, winner_account, reign_before
       FROM rounds ORDER BY throne_id, started_at, rowid`,
    )
    .all() as {
    id: number;
    throne_id: string;
    hegemon_account: string | null;
    winner_account: string | null;
    reign_before: number | null;
  }[];
  const update = db.prepare(
    "UPDATE rounds SET hegemon_run = ? WHERE rowid = ?",
  );
  let throne: string | null = null;
  let previous: PreviousRound | undefined;
  for (const row of rows) {
    if (row.throne_id !== throne) {
      throne = row.throne_id;
      previous = undefined;
    }
    const run = hegemonRun(row.hegemon_account, row.reign_before, previous);
    update.run(run, row.id);
    previous = {
      hegemonAccount: row.hegemon_account,
      winnerAccount: row.winner_account,
      hegemonRun: run,
    };
  }
}
