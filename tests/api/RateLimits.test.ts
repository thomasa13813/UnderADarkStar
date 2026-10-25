// @vitest-environment node
import fs from "fs";
import http from "http";
import type { AddressInfo } from "net";
import { DatabaseSync } from "node:sqlite";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../../src/api/App";
import { apiConfigFromEnv } from "../../src/api/Config";
import { openDatabase } from "../../src/api/Db";
import { loadOrCreateSigningKey } from "../../src/api/Keys";
import { RATE_LIMITS } from "../../src/api/RateLimits";
import { RecordStore } from "../../src/api/Records";

// Under a Dark Star, B6 (docs/DarkStar-Accounts.md §10): per-IP rate limits
// on the account API. Counted per visitor (Cloudflare's address header),
// refused with 429, the game server's keyed calls never counted, and off in
// dev unless asked for.

const API_KEY = "shared-key";

interface Harness {
  base: string;
  db: DatabaseSync;
  close(): Promise<void>;
}

let harness: Harness | null = null;

async function startApi(rateLimits?: boolean): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkstar-limits-"));
  const config = apiConfigFromEnv({
    GAME_ENV: "dev",
    DOMAIN: "localhost",
    API_KEY,
    DATA_DIR: dir,
  });
  const db = openDatabase(dir);
  const key = await loadOrCreateSigningKey(dir);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const server = http.createServer(
    createApiApp({
      config,
      db,
      key,
      log,
      records: new RecordStore(dir),
      rateLimits,
    }),
  );
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  harness = {
    base,
    db,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  return harness;
}

afterEach(async () => {
  await harness?.close();
  harness = null;
});

function logout(h: Harness, headers: Record<string, string> = {}) {
  return fetch(`${h.base}/auth/logout`, { method: "POST", headers });
}

describe("API rate limits", () => {
  it("refuses a visitor past the limit with 429", async () => {
    const h = await startApi(true);
    const visitor = { "cf-connecting-ip": "203.0.113.7" };
    for (let i = 0; i < RATE_LIMITS.session.max; i++) {
      expect((await logout(h, visitor)).status).toBe(200);
    }
    const refused = await logout(h, visitor);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "too many requests" });
    expect(refused.headers.get("ratelimit-policy")).not.toBeNull();
  });

  it("counts each visitor apart", async () => {
    const h = await startApi(true);
    for (let i = 0; i <= RATE_LIMITS.session.max; i++) {
      await logout(h, { "cf-connecting-ip": "203.0.113.7" });
    }
    const other = await logout(h, { "cf-connecting-ip": "198.51.100.2" });
    expect(other.status).toBe(200);
  });

  it("limits sign-in starts", async () => {
    const h = await startApi(true);
    const visitor = { "cf-connecting-ip": "203.0.113.9" };
    const start = () =>
      fetch(`${h.base}/auth/login/dev?name=Tester`, {
        headers: visitor,
        redirect: "manual",
      });
    for (let i = 0; i < RATE_LIMITS.signIn.max; i++) {
      expect((await start()).status).toBe(302);
    }
    expect((await start()).status).toBe(429);
  });

  it("never counts the game server's keyed calls", async () => {
    const h = await startApi(true);
    const server = { "cf-connecting-ip": "192.0.2.1", "x-api-key": API_KEY };
    for (let i = 0; i < RATE_LIMITS.session.max + 5; i++) {
      expect((await logout(h, server)).status).toBe(200);
    }
  });

  it("is off in dev unless asked for", async () => {
    const h = await startApi();
    for (let i = 0; i < RATE_LIMITS.session.max + 5; i++) {
      expect((await logout(h)).status).toBe(200);
    }
  });
});
