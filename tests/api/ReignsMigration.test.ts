// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MIGRATIONS, migrate } from "../../src/api/Db";
import { statsFor } from "../../src/api/Results";

// Under a Dark Star (docs/DarkStar-Accounts.md §5.5, §12.6): migration 3
// turns a database recorded under the old rule (reigns were wins, the
// longest reign the badge) into the new numbers on the first boot, by
// adding the run columns and rebuilding the cache in the same transaction.

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

// A database as the API left it before migration 3: the first two
// migrations applied, with rounds and a stale stats cache.
function oldDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);
  for (const m of MIGRATIONS.filter((m) => m.id <= 2)) {
    db.exec(m.sql);
    db.prepare(
      "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)",
    ).run(m.id, m.name, NOW - 1000);
  }
  const account = db.prepare(
    "INSERT INTO accounts (id, public_id, name, tag, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  account.run("ada", "pub-ada", "Ada", "0001", NOW - 5000);
  account.run("bob", "pub-bob", "Bob", "0002", NOW - 5000);
  const round = db.prepare(
    `INSERT INTO rounds (game_id, throne_id, throne_name, throne_type, map, started_at, ended_at,
       humans, outcome, hegemon_account, winner_account, reign_after, git_commit)
     VALUES (?, 'throne-01', 'Vega', 'ffa', 'Event Horizon', ?, ?, 2, ?, ?, ?, ?, 'OLD')`,
  );
  const player = db.prepare(
    "INSERT INTO round_players (game_id, account_id, was_hegemon, won) VALUES (?, ?, ?, ?)",
  );
  // Ada takes the throne from a guest, holds it twice, then Bob takes it
  // and steps down (nobody is recorded sitting after him).
  const rounds: [string, string, string | null, string | null, number][] = [
    ["GAME0001", "overthrown", null, "ada", 1],
    ["GAME0002", "timer", "ada", "ada", 2],
    ["GAME0003", "timer", "ada", "ada", 3],
    ["GAME0004", "overthrown", "ada", "bob", 1],
  ];
  rounds.forEach(([id, outcome, hegemon, winner, reignAfter], i) => {
    const start = NOW - (10 - i) * 60_000;
    round.run(id, start, start + 30_000, outcome, hegemon, winner, reignAfter);
    player.run(id, "ada", hegemon === "ada" ? 1 : 0, winner === "ada" ? 1 : 0);
    if (i === 3) player.run(id, "bob", 0, 1);
  });
  // The cache under the old rule: Ada reigns 3 (1 taken, 2 held), longest 3;
  // Bob reigns 1, longest 1.
  const stats = db.prepare(
    `INSERT INTO stats (account_id, thrones_taken, rounds_held, longest_reign, games_played, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  stats.run("ada", 1, 2, 3, 4, NOW - 1000);
  stats.run("bob", 1, 0, 1, 1, NOW - 1000);
  return db;
}

describe("migration 3 (reigns)", () => {
  it("adds the run columns and rebuilds the numbers under the new rule", () => {
    const db = oldDatabase();
    expect(migrate(db)).toEqual([3]);

    // Ada: three victories as before; three rounds seated (GAME0002 to
    // GAME0004) in one run. Bob: a victory and no reign.
    expect(statsFor(db, "ada")).toEqual({
      thronesTaken: 1,
      roundsHeld: 2,
      reigns: 3,
      longestReign: 3,
      gamesPlayed: 4,
    });
    expect(statsFor(db, "bob")).toEqual({
      thronesTaken: 1,
      roundsHeld: 0,
      reigns: 0,
      longestReign: 0,
      gamesPlayed: 1,
    });
    expect(
      db
        .prepare(
          "SELECT game_id, reign_before, hegemon_run FROM rounds ORDER BY game_id",
        )
        .all(),
    ).toEqual([
      { game_id: "GAME0001", reign_before: null, hegemon_run: 0 },
      { game_id: "GAME0002", reign_before: null, hegemon_run: 1 },
      { game_id: "GAME0003", reign_before: null, hegemon_run: 2 },
      { game_id: "GAME0004", reign_before: null, hegemon_run: 3 },
    ]);
    // Applied once: a second boot has nothing to do.
    expect(migrate(db)).toEqual([]);
    db.close();
  });
});
