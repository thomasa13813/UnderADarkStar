import * as dotenv from "dotenv";
import { apiConfigFromEnv } from "./Config";
import { openDatabase } from "./Db";
import { rebuildStats } from "./Results";

// Under a Dark Star: recompute the stats cache from the rounds
// (docs/DarkStar-Accounts.md §5.5). Run it after a ban, a deleted account,
// or any doubt about the numbers: `npm run api:rebuild-stats`, with the same
// environment as the API (DOMAIN, API_KEY, DATA_DIR). Safe to run while the
// API is up: one transaction on the same SQLite file.

dotenv.config();

const config = apiConfigFromEnv();
const db = openDatabase(config.dataDir);
try {
  const rows = rebuildStats(db, Date.now());
  console.info(`stats rebuilt for ${rows} account(s) from ${config.dataDir}`);
} finally {
  db.close();
}
