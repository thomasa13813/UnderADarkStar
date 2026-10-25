// @vitest-environment node
import fs from "fs";
import { DatabaseSync } from "node:sqlite";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gunzipSync } from "zlib";
import { findOrCreateAccount } from "../../src/api/Accounts";
import {
  backupKeys,
  fetchBackup,
  listNights,
  msUntilNextBackup,
  scheduleNightlyBackups,
  summarise,
  takeBackup,
} from "../../src/api/Backup";
import { backupConfigFromEnv } from "../../src/api/Config";
import { DATABASE_FILE, openDatabase } from "../../src/api/Db";
import { loadOrCreateSigningKey, SIGNING_KEY_FILE } from "../../src/api/Keys";
import { amzDateFor, Fetch, R2Client, signV4 } from "../../src/api/R2";

// Under a Dark Star, B6 (docs/DarkStar-Accounts.md §10): the nightly backup to
// Cloudflare R2. The request signing against AWS's published examples, a
// backup taken from a live database and fetched back as a working data
// directory, the schedule, and the all-or-none configuration.

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

describe("SigV4 signing", () => {
  // AWS's worked examples for S3 (Signature Version 4, header form).
  const example = {
    host: "examplebucket.s3.amazonaws.com",
    region: "us-east-1",
    service: "s3",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    amzDate: "20130524T000000Z",
  };
  const emptyHash =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  it("GET Object", () => {
    const auth = signV4({
      ...example,
      method: "GET",
      path: "/test.txt",
      query: {},
      headers: {
        range: "bytes=0-9",
        "x-amz-content-sha256": emptyHash,
        "x-amz-date": example.amzDate,
      },
      payloadHash: emptyHash,
    });
    expect(auth).toContain(
      "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date",
    );
    expect(auth).toContain(
      "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("GET Bucket (list objects), with a query string", () => {
    const auth = signV4({
      ...example,
      method: "GET",
      path: "/",
      query: { "max-keys": "2", prefix: "J" },
      headers: {
        "x-amz-content-sha256": emptyHash,
        "x-amz-date": example.amzDate,
      },
      payloadHash: emptyHash,
    });
    expect(auth).toContain(
      "Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7",
    );
  });

  it("formats the request date", () => {
    expect(amzDateFor(NOW)).toBe("20261025T120000Z");
  });
});

// An in-memory bucket behind the fetch the client is given.
function fakeR2() {
  const objects = new Map<string, Buffer>();
  const requests: { method: string; url: string; auth: string }[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = init?.headers as Record<string, string>;
    requests.push({ method, url: url.toString(), auth: headers.authorization });
    const key = decodeURIComponent(url.pathname.replace(/^\/bucket\/?/, ""));
    if (method === "PUT") {
      objects.set(key, Buffer.from(init!.body as Uint8Array));
      return new Response(null, { status: 200 });
    }
    if (key === "") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix));
      const xml = keys.map((k) => `<Contents><Key>${k}</Key></Contents>`);
      return new Response(
        `<ListBucketResult>${xml.join("")}</ListBucketResult>`,
      );
    }
    const body = objects.get(key);
    return body === undefined
      ? new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 })
      : new Response(new Uint8Array(body));
  }) as Fetch;
  const client = new R2Client(
    {
      accountId: "acct",
      accessKeyId: "id",
      secretAccessKey: "secret",
      bucket: "bucket",
    },
    fetchImpl,
    () => NOW,
  );
  return { objects, requests, client };
}

let dir: string;
let db: DatabaseSync;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkstar-backup-test-"));
  db = openDatabase(dir);
  await loadOrCreateSigningKey(dir);
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function addAccounts(n: number) {
  for (let i = 0; i < n; i++) {
    findOrCreateAccount(
      db,
      { provider: "dev", providerUserId: `user-${i}`, displayName: `P${i}` },
      NOW,
    );
  }
}

describe("taking and fetching a backup", () => {
  it("uploads tonight's database and signing key, signed, to the account's endpoint", async () => {
    addAccounts(3);
    const r2 = fakeR2();
    const result = await takeBackup(db, dir, r2.client, NOW);
    expect(result.night).toBe("2026-10-25");
    const keys = backupKeys("2026-10-25");
    expect([...r2.objects.keys()].sort()).toEqual([keys.db, keys.key].sort());
    expect(result.dbBytes).toBe(r2.objects.get(keys.db)!.length);
    expect(r2.objects.get(keys.key)!.toString()).toBe(
      fs.readFileSync(path.join(dir, SIGNING_KEY_FILE), "utf8"),
    );
    for (const req of r2.requests) {
      expect(req.url).toMatch(
        /^https:\/\/acct\.r2\.cloudflarestorage\.com\/bucket\//,
      );
      expect(req.auth).toMatch(
        /^AWS4-HMAC-SHA256 Credential=id\/20261025\/auto\/s3\/aws4_request/,
      );
    }
    // The copy is a real SQLite file holding the accounts.
    const copy = path.join(dir, "check.sqlite");
    fs.writeFileSync(copy, gunzipSync(r2.objects.get(keys.db)!));
    expect(summarise(copy).accounts).toBe(3);
  });

  it("includes writes made since the last checkpoint (WAL)", async () => {
    addAccounts(2);
    const r2 = fakeR2();
    await takeBackup(db, dir, r2.client, NOW);
    addAccounts(5);
    await takeBackup(db, dir, r2.client, NOW + HOUR);
    const restored = path.join(dir, "restored");
    await fetchBackup(r2.client, "2026-10-25", restored);
    expect(summarise(path.join(restored, DATABASE_FILE))).toEqual({
      integrity: "ok",
      accounts: 5,
      rounds: 0,
    });
  });

  it("fetches a night as a data directory the API opens, and refuses to overwrite", async () => {
    addAccounts(4);
    const r2 = fakeR2();
    await takeBackup(db, dir, r2.client, NOW);
    await takeBackup(db, dir, r2.client, NOW + 24 * HOUR);
    expect(await listNights(r2.client)).toEqual(["2026-10-25", "2026-10-26"]);

    const restored = path.join(dir, "restored");
    await fetchBackup(r2.client, "2026-10-26", restored);
    const key = await loadOrCreateSigningKey(restored);
    const original = await loadOrCreateSigningKey(dir);
    expect(key.kid).toBe(original.kid);
    const reopened = openDatabase(restored);
    try {
      const n = reopened
        .prepare("SELECT COUNT(*) AS n FROM accounts")
        .get() as {
        n: number;
      };
      expect(n.n).toBe(4);
    } finally {
      reopened.close();
    }
    await expect(
      fetchBackup(r2.client, "2026-10-26", restored),
    ).rejects.toThrow(/already exists/);
  });

  it("reports R2's refusal", async () => {
    const r2 = fakeR2();
    await expect(
      fetchBackup(r2.client, "2026-01-01", path.join(dir, "x")),
    ).rejects.toThrow(/404 .*NoSuchKey/);
  });
});

describe("the schedule", () => {
  it("waits for the next 09:00 UTC", () => {
    expect(msUntilNextBackup(Date.UTC(2026, 9, 25, 8, 0))).toBe(HOUR);
    expect(msUntilNextBackup(Date.UTC(2026, 9, 25, 9, 0))).toBe(24 * HOUR);
    expect(msUntilNextBackup(Date.UTC(2026, 9, 25, 12, 0))).toBe(21 * HOUR);
  });

  it("runs nightly, logs a failure and tries again the next night", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.UTC(2026, 9, 25, 8, 0));
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const run = vi
        .fn()
        .mockRejectedValueOnce(new Error("R2 down"))
        .mockResolvedValue({ night: "2026-10-26", dbBytes: 100 });
      const stop = scheduleNightlyBackups(run, log);
      await vi.advanceTimersByTimeAsync(HOUR - 1);
      expect(run).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(run).toHaveBeenCalledTimes(1);
      expect(log.error).toHaveBeenCalledWith(
        "nightly backup failed",
        expect.any(Error),
      );
      await vi.advanceTimersByTimeAsync(24 * HOUR);
      expect(run).toHaveBeenCalledTimes(2);
      expect(log.info).toHaveBeenCalledWith(
        expect.stringContaining("nightly/2026-10-26"),
      );
      stop();
      await vi.advanceTimersByTimeAsync(48 * HOUR);
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("configuration", () => {
  const full = {
    R2_ACCOUNT_ID: "a",
    R2_ACCESS_KEY_ID: "b",
    R2_SECRET_ACCESS_KEY: "c",
    R2_BUCKET: "d",
  };

  it("is off with no keys, on with all four", () => {
    expect(backupConfigFromEnv({})).toBeNull();
    expect(backupConfigFromEnv(full)).toEqual({
      accountId: "a",
      accessKeyId: "b",
      secretAccessKey: "c",
      bucket: "d",
    });
  });

  it("names the mix-up when the access key ID is pasted twice", () => {
    expect(() =>
      backupConfigFromEnv({ ...full, R2_SECRET_ACCESS_KEY: "b" }),
    ).toThrow(/copy of R2_ACCESS_KEY_ID/);
  });

  it("fails loudly on a partial set", () => {
    expect(() => backupConfigFromEnv({ ...full, R2_BUCKET: "" })).toThrow(
      /must be set together/,
    );
  });
});
