import fs from "fs";
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import os from "os";
import path from "path";
import { gunzipSync, gzipSync } from "zlib";
import { DATABASE_FILE } from "./Db";
import { SIGNING_KEY_FILE } from "./Keys";
import { R2Client } from "./R2";

// Under a Dark Star: the nightly backup (docs/DarkStar-Accounts.md §10, B6).
// Once a day the API copies its database (SQLite's online backup: consistent
// while the API keeps writing) and the signing key to Cloudflare R2, under
// nightly/<YYYY-MM-DD>/. The bucket's lifecycle rule deletes each night after
// 30 days; nothing here deletes. Two small writes a night stay far inside
// R2's free allowance (docs/DarkStar-Services.md §2.1).

export const BACKUP_PREFIX = "nightly/";
export const BACKUP_DB_OBJECT = `${DATABASE_FILE}.gz`;
// 09:00 UTC: the small hours in the Americas, morning in Europe.
export const BACKUP_HOUR_UTC = 9;
const DAY_MS = 24 * 60 * 60 * 1000;
// R2's free storage is 10 GB-month; thirty nights at this size reach it.
export const FREE_TIER_WARN_BYTES = 300 * 1024 * 1024;

export interface BackupResult {
  night: string;
  dbBytes: number;
}

export function nightOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function backupKeys(night: string): { db: string; key: string } {
  return {
    db: `${BACKUP_PREFIX}${night}/${BACKUP_DB_OBJECT}`,
    key: `${BACKUP_PREFIX}${night}/${SIGNING_KEY_FILE}`,
  };
}

// Takes one backup and uploads it. A second run on the same UTC day
// replaces that night's files.
export async function takeBackup(
  db: DatabaseSync,
  dataDir: string,
  r2: R2Client,
  now: number,
): Promise<BackupResult> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "darkstar-backup-"));
  try {
    const copy = path.join(tmp, DATABASE_FILE);
    await sqliteBackup(db, copy);
    const gz = gzipSync(fs.readFileSync(copy));
    const night = nightOf(now);
    const keys = backupKeys(night);
    await r2.put(keys.db, gz);
    await r2.put(
      keys.key,
      fs.readFileSync(path.join(dataDir, SIGNING_KEY_FILE)),
    );
    return { night, dbBytes: gz.length };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Milliseconds from now to the next BACKUP_HOUR_UTC.
export function msUntilNextBackup(now: number): number {
  const d = new Date(now);
  let next = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    BACKUP_HOUR_UTC,
  );
  if (next <= now) next += DAY_MS;
  return next - now;
}

export interface BackupLog {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

// Runs takeBackup at BACKUP_HOUR_UTC every day. A failure is logged and the
// next night tries again. Returns a stop function.
export function scheduleNightlyBackups(
  run: () => Promise<BackupResult>,
  log: BackupLog,
  clock: () => number = Date.now,
): () => void {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const arm = () => {
    if (stopped) return;
    timer = setTimeout(fire, msUntilNextBackup(clock()));
    timer.unref();
  };
  const fire = async () => {
    try {
      const result = await run();
      log.info(
        `backup uploaded: ${BACKUP_PREFIX}${result.night} (${result.dbBytes} bytes)`,
      );
      if (result.dbBytes > FREE_TIER_WARN_BYTES) {
        log.warn(
          "backup is over 300 MB: thirty nights of it pass R2's free 10 GB",
        );
      }
    } catch (error) {
      log.error("nightly backup failed", error);
    }
    arm();
  };
  arm();
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  };
}

// The nights in the bucket, oldest first.
export async function listNights(r2: R2Client): Promise<string[]> {
  const keys = await r2.list(BACKUP_PREFIX);
  const nights = new Set<string>();
  for (const key of keys) {
    const m = /^nightly\/(\d{4}-\d{2}-\d{2})\//.exec(key);
    if (m) nights.add(m[1]);
  }
  return Array.from(nights).sort();
}

// Downloads one night into dir as a ready data directory (the database and
// the signing key), refusing to overwrite. Returns the database path.
export async function fetchBackup(
  r2: R2Client,
  night: string,
  dir: string,
): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, DATABASE_FILE);
  const keyPath = path.join(dir, SIGNING_KEY_FILE);
  for (const file of [dbPath, keyPath]) {
    if (fs.existsSync(file)) throw new Error(`${file} already exists`);
  }
  const keys = backupKeys(night);
  const gz = await r2.get(keys.db);
  const signingKey = await r2.get(keys.key);
  fs.writeFileSync(dbPath, gunzipSync(gz));
  fs.writeFileSync(keyPath, signingKey, { mode: 0o600 });
  return dbPath;
}

export interface BackupSummary {
  integrity: string;
  accounts: number;
  rounds: number;
}

// What a database holds, for comparing a restored copy with the live one.
export function summarise(dbPath: string): BackupSummary {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get() as {
      integrity_check: string;
    };
    const count = (table: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number })
        .n;
    return {
      integrity: integrity.integrity_check,
      accounts: count("accounts"),
      rounds: count("rounds"),
    };
  } finally {
    db.close();
  }
}
