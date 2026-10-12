import * as dotenv from "dotenv";
import http from "http";
import { createApiApp } from "./App";
import { apiConfigFromEnv, issuerFor } from "./Config";
import { openDatabase, tableNames } from "./Db";
import { loadOrCreateSigningKey } from "./Keys";
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
