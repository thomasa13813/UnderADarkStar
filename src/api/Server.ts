import * as dotenv from "dotenv";
import http from "http";
import { GameEnv } from "../core/configuration/Config";
import { createApiApp } from "./App";
import { BACKUP_HOUR_UTC, scheduleNightlyBackups, takeBackup } from "./Backup";
import { apiConfigFromEnv, issuerFor } from "./Config";
import { openDatabase, tableNames } from "./Db";
import { loadOrCreateSigningKey } from "./Keys";
import { R2Client } from "./R2";
import { RECORD_RETENTION_MS, RecordStore } from "./Records";

// Under a Dark Star: the account API's entry point (docs/DarkStar-Accounts.md
// §3). One process beside the game server's master and workers, in the same
// container; `npm run dev` starts it on 8787 next to the client and server.

dotenv.config();

// How often kept game records past their retention (A19) are removed.
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

async function main() {
  const config = apiConfigFromEnv();
  const db = openDatabase(config.dataDir);
  const key = await loadOrCreateSigningKey(config.dataDir);
  const log = console;
  const records = new RecordStore(config.dataDir);
  const prune = () => {
    try {
      const removed = records.prune(Date.now(), RECORD_RETENTION_MS);
      if (removed > 0) log.info(`pruned ${removed} game record(s)`);
    } catch (error) {
      log.error("pruning game records failed", error);
    }
  };
  prune();
  const pruneTimer = setInterval(prune, PRUNE_INTERVAL_MS);
  pruneTimer.unref();
  // The nightly backup (§10): production only, so a developer's .env holding
  // the R2 keys never sends a dev database to the bucket.
  let stopBackups = () => {};
  if (config.backup === null) {
    log.info("nightly backup off (R2_* not set)");
  } else if (config.env === GameEnv.Dev) {
    log.info("nightly backup off in dev");
  } else {
    const r2 = new R2Client(config.backup);
    stopBackups = scheduleNightlyBackups(
      () => takeBackup(db, config.dataDir, r2, Date.now()),
      log,
    );
    log.info(`nightly backup at ${BACKUP_HOUR_UTC}:00 UTC to R2`);
  }
  const app = createApiApp({ config, db, key, log, records });
  const server = http.createServer(app);
  server.listen(config.port, () => {
    log.info(
      `API listening on :${config.port} as ${issuerFor(config)} ` +
        `(data in ${config.dataDir}, tables: ${tableNames(db).join(", ")}, ` +
        `key ${key.kid.slice(0, 8)}…)`,
    );
  });
  const shutdown = () => {
    clearInterval(pruneTimer);
    stopBackups();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Failed to start API:", error);
  process.exit(1);
});
