import fs from "fs";
import { DatabaseSync } from "node:sqlite";
import path from "path";
import { rebuildStatsWithin } from "./Results";

// Under a Dark Star: the account API's database (docs/DarkStar-Accounts.md
// §8). One SQLite file, opened by the API only, on Node's built-in module:
// no native dependency to build, which `npm ci --ignore-scripts` could not.
// Schema changes are numbered migrations applied at boot, in order, once.

export interface Migration {
  id: number;
  name: string;
  sql: string;
  // Work the SQL cannot do, run in the same transaction after it.
  after?: (db: DatabaseSync) => void;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: "accounts",
    sql: `
      -- An account: the row behind a persistentID (id is the game's
      -- persistentID, A12 says what else is held).
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        public_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        tag TEXT NOT NULL,
        name_changed_at INTEGER,
        role TEXT,
        ban_reason TEXT,
        ban_until INTEGER,
        created_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      -- One provider login -> one account. Email later is a new provider.
      CREATE TABLE identities (
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (provider, provider_user_id)
      );
      CREATE INDEX identities_account ON identities(account_id);
      -- Refresh sessions: the cookie's hash, never the cookie.
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE INDEX sessions_account ON sessions(account_id);
    `,
  },
  {
    id: 2,
    name: "rounds",
    sql: `
      -- One row per public throne round (§5.3). Account columns are null for
      -- guests and the AI.
      CREATE TABLE rounds (
        game_id TEXT PRIMARY KEY,
        throne_id TEXT NOT NULL,
        throne_name TEXT NOT NULL,
        throne_type TEXT NOT NULL,
        map TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        humans INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        hegemon_account TEXT,
        winner_account TEXT,
        reign_after INTEGER NOT NULL,
        git_commit TEXT
      );
      CREATE INDEX rounds_winner ON rounds(winner_account);
      -- Verified players of a round.
      CREATE TABLE round_players (
        game_id TEXT NOT NULL REFERENCES rounds(game_id),
        account_id TEXT NOT NULL,
        was_hegemon INTEGER NOT NULL,
        won INTEGER NOT NULL,
        PRIMARY KEY (game_id, account_id)
      );
      CREATE INDEX round_players_account ON round_players(account_id);
      -- A cache of rounds per account (§5.4), rebuildable (§5.5).
      CREATE TABLE stats (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id),
        thrones_taken INTEGER NOT NULL DEFAULT 0,
        rounds_held INTEGER NOT NULL DEFAULT 0,
        longest_reign INTEGER NOT NULL DEFAULT 0,
        games_played INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 3,
    name: "reigns",
    // Reigns became rounds played as Hegemon and longest reign the most
    // consecutive of them on one throne (A5 and A15, revised 2026-10-17).
    // The seated Hegemon's run is kept per round; the cache is rebuilt from
    // the rounds so the numbers already recorded follow the new rule.
    sql: `
      -- The reign the seated Hegemon brought in (the record's reignBefore);
      -- null for rounds recorded before it was kept.
      ALTER TABLE rounds ADD COLUMN reign_before INTEGER;
      -- The Hegemon's consecutive rounds on this throne, this one included;
      -- 0 when the Hegemon was a guest or the AI.
      ALTER TABLE rounds ADD COLUMN hegemon_run INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX rounds_throne ON rounds(throne_id, started_at);
      CREATE INDEX rounds_hegemon ON rounds(hegemon_account);
      -- Rounds played as Hegemon (reigns, A5).
      ALTER TABLE stats ADD COLUMN hegemon_rounds INTEGER NOT NULL DEFAULT 0;
    `,
    after: (db) => {
      rebuildStatsWithin(db, Date.now());
    },
  },
  {
    id: 4,
    name: "solo_presets",
    // Saved solo setups (§12.11): private to the account, erased with it.
    sql: `
      -- One named setup of the solo screen; settings is its JSON
      -- (SoloPresetSettingsSchema). Names are unique per account, any case.
      CREATE TABLE solo_presets (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        name TEXT NOT NULL COLLATE NOCASE,
        settings TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (account_id, name)
      );
    `,
  },
];

export const DATABASE_FILE = "darkstar.sqlite";

// Opens (creating if needed) the database under dataDir and brings its
// schema up to date. Returns the open handle; the caller closes it.
export function openDatabase(dataDir: string): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, DATABASE_FILE));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

// Applies every migration not yet recorded, in id order, each in its own
// transaction. Returns the ids applied this time.
export function migrate(db: DatabaseSync): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);
  const applied = new Set(
    (
      db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[]
    ).map((r) => r.id),
  );
  const done: number[] = [];
  for (const m of [...MIGRATIONS].sort((a, b) => a.id - b.id)) {
    if (applied.has(m.id)) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      m.after?.(db);
      db.prepare(
        "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)",
      ).run(m.id, m.name, Date.now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    done.push(m.id);
  }
  return done;
}

// The user tables present, for health checks and tests.
export function tableNames(db: DatabaseSync): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
}
