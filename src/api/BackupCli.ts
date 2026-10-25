import * as dotenv from "dotenv";
import path from "path";
import { GameEnv } from "../core/configuration/Config";
import { fetchBackup, listNights, summarise, takeBackup } from "./Backup";
import { apiConfigFromEnv, backupConfigFromEnv } from "./Config";
import { DATABASE_FILE, openDatabase } from "./Db";
import { R2Client } from "./R2";

// Under a Dark Star: the backup command (docs/DarkStar-Accounts.md §10, B6),
// run as `npm run api:backup -- <command>`. `now` runs on the server, inside
// the game container, like the admin command; `list`, `fetch` and `summary`
// run anywhere the R2_* keys are in the environment (the root .env on the
// developer's PC), which is how the restore drill is done without touching
// the live server.

const USAGE = `Backup commands:

  now                       take tonight's backup now (production only)
  list                      the nights in the bucket, oldest first
  fetch <night|latest> <dir>  download a night into <dir> and check it
  summary <dir>             integrity and counts of the database in <dir>`;

dotenv.config();

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help") {
    console.info(USAGE);
    return 0;
  }
  if (command === "summary") {
    if (rest.length !== 1) return usage();
    printSummary(path.join(rest[0], DATABASE_FILE));
    return 0;
  }
  const r2Config = backupConfigFromEnv();
  if (r2Config === null) {
    console.error(
      "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are not set",
    );
    return 1;
  }
  const r2 = new R2Client(r2Config);
  switch (command) {
    case "now": {
      const config = apiConfigFromEnv();
      if (config.env === GameEnv.Dev) {
        console.error("refusing: `now` uploads the database, and this is dev");
        return 1;
      }
      const db = openDatabase(config.dataDir);
      try {
        const result = await takeBackup(db, config.dataDir, r2, Date.now());
        console.info(
          `uploaded nightly/${result.night} (${result.dbBytes} bytes)`,
        );
      } finally {
        db.close();
      }
      return 0;
    }
    case "list": {
      const nights = await listNights(r2);
      console.info(nights.length === 0 ? "(no backups)" : nights.join("\n"));
      return 0;
    }
    case "fetch": {
      if (rest.length !== 2) return usage();
      let night = rest[0];
      if (night === "latest") {
        const nights = await listNights(r2);
        if (nights.length === 0) {
          console.error("no backups in the bucket");
          return 1;
        }
        night = nights[nights.length - 1];
      }
      const dbPath = await fetchBackup(r2, night, rest[1]);
      console.info(`fetched ${night} into ${rest[1]}`);
      printSummary(dbPath);
      return 0;
    }
    default:
      return usage();
  }
}

function usage(): number {
  console.error(USAGE);
  return 1;
}

function printSummary(dbPath: string): void {
  const s = summarise(dbPath);
  console.info(
    `integrity: ${s.integrity}; accounts: ${s.accounts}; rounds: ${s.rounds}`,
  );
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
