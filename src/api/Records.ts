import fs from "fs";
import path from "path";
import { gunzipSync, gzipSync } from "zlib";
import { GameRecord, ID } from "../core/Schemas";

// Under a Dark Star: the full game records the game server posts, kept on
// disk for a while (docs/DarkStar-Accounts.md §5.3, A19). One gzip file per
// game under <dataDir>/records, written once at ingest and read back by
// GET /game/:id until retention removes it. The rounds table, not this
// store, is the source of the board: a pruned record costs nothing but the
// ability to replay the game.

export const RECORDS_DIR = "records";
export const RECORD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class RecordStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, RECORDS_DIR);
  }

  // The file for a game ID, or null for anything that is not a game ID:
  // the ID is validated before it goes anywhere near a path.
  private fileFor(gameID: string): string | null {
    if (!ID.safeParse(gameID).success) return null;
    return path.join(this.dir, `${gameID}.json.gz`);
  }

  has(gameID: string): boolean {
    const file = this.fileFor(gameID);
    return file !== null && fs.existsSync(file);
  }

  // Writes the record, PII scrubbed (persistentIDs and reports go; the
  // ingest has already taken what it needs from them). Overwrites silently:
  // the caller decides whether a repeat is new.
  write(record: GameRecord): void {
    const file = this.fileFor(record.info.gameID);
    if (file === null) throw new Error("invalid game ID");
    fs.mkdirSync(this.dir, { recursive: true });
    const body = JSON.stringify(scrubRecord(record));
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, gzipSync(Buffer.from(body, "utf8")));
    fs.renameSync(tmp, file);
  }

  // The stored record as JSON text, or null when there is none.
  readJson(gameID: string): string | null {
    const file = this.fileFor(gameID);
    if (file === null || !fs.existsSync(file)) return null;
    return gunzipSync(fs.readFileSync(file)).toString("utf8");
  }

  // Removes records older than maxAgeMs (by file time). Returns how many.
  prune(now: number, maxAgeMs: number = RECORD_RETENTION_MS): number {
    if (!fs.existsSync(this.dir)) return 0;
    let removed = 0;
    for (const name of fs.readdirSync(this.dir)) {
      if (!name.endsWith(".json.gz")) continue;
      const file = path.join(this.dir, name);
      let mtime: number;
      try {
        mtime = fs.statSync(file).mtimeMs;
      } catch {
        continue;
      }
      if (now - mtime > maxAgeMs) {
        try {
          fs.unlinkSync(file);
          removed++;
        } catch {
          // Already gone, or in use: the next pass gets it.
        }
      }
    }
    return removed;
  }
}

// What leaves the API when a record is read back: no persistentIDs, no
// reports (the upstream API scrubbed the same way; the client's replay
// path and the preview route expect this shape).
export function scrubRecord(record: GameRecord): GameRecord {
  const info = { ...record.info };
  delete info.reports;
  return {
    ...record,
    info: {
      ...info,
      players: info.players.map((p) => ({ ...p, persistentID: null })),
    },
  };
}
