// @vitest-environment node
import fs from "fs";
import http from "http";
import type { AddressInfo } from "net";
import { DatabaseSync } from "node:sqlite";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../../src/api/App";
import { apiConfigFromEnv } from "../../src/api/Config";
import { openDatabase } from "../../src/api/Db";
import { loadOrCreateSigningKey } from "../../src/api/Keys";
import { RecordStore } from "../../src/api/Records";
import { REFRESH_COOKIE } from "../../src/api/Sessions";
import {
  PutUsernameResponseSchema,
  UserMeResponseSchema,
} from "../../src/core/ApiSchemas";

// Under a Dark Star, A13 (revised 2026-10-25, Tom): PUT /users/@me/username.
// One name per account, renamed at once and as often as the player likes,
// under the account rules; the tag stays.

const SITE = "http://localhost:9000";

interface Harness {
  base: string;
  db: DatabaseSync;
  close(): Promise<void>;
}

let h: Harness;

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkstar-rename-"));
  const config = apiConfigFromEnv({
    GAME_ENV: "dev",
    DOMAIN: "localhost",
    API_KEY: "shared-key",
    DATA_DIR: dir,
  });
  const db = openDatabase(dir);
  const key = await loadOrCreateSigningKey(dir);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const server = http.createServer(
    createApiApp({ config, db, key, log, records: new RecordStore(dir) }),
  );
  await new Promise<void>((r) => server.listen(0, r));
  h = {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    db,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
});

afterEach(async () => {
  await h.close();
});

async function signIn(name: string): Promise<string> {
  const res = await fetch(
    `${h.base}/auth/login/dev?name=${encodeURIComponent(name)}&redirect=${encodeURIComponent(SITE + "/")}`,
    { redirect: "manual" },
  );
  const pair = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith(`${REFRESH_COOKIE}=`))!;
  const refreshed = await fetch(`${h.base}/auth/refresh`, {
    method: "POST",
    headers: { cookie: pair },
  });
  return ((await refreshed.json()) as { jwt: string }).jwt;
}

function rename(jwt: string | null, body: unknown) {
  return fetch(`${h.base}/users/@me/username`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(jwt === null ? {} : { authorization: `Bearer ${jwt}` }),
    },
    body: JSON.stringify(body),
  });
}

async function me(jwt: string) {
  const res = await fetch(`${h.base}/users/@me`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  return UserMeResponseSchema.parse(await res.json());
}

describe("PUT /users/@me/username", () => {
  it("renames at once, again and again, keeping the tag", async () => {
    const jwt = await signIn("Tom");
    const tag = (await me(jwt)).player.usernameDiscriminator;

    const first = await rename(jwt, { username: "StarLord" });
    expect(first.status).toBe(200);
    expect(PutUsernameResponseSchema.parse(await first.json())).toMatchObject({
      username: `StarLord.${tag}`,
      base: "StarLord",
      discriminator: tag,
      nextUsernameChangeAt: null,
    });

    expect((await rename(jwt, { username: "Star Lord" })).status).toBe(200);
    expect((await rename(jwt, { username: "Tom" })).status).toBe(200);
    const after = await me(jwt);
    expect(after.player.usernameBase).toBe("Tom");
    expect(after.player.nextUsernameChangeAt).toBeNull();
  });

  it("refuses a name outside the account rules", async () => {
    const jwt = await signIn("Tom");
    for (const username of [
      "ab",
      "Ada.Lovelace",
      "x".repeat(21),
      "two  spaces",
    ]) {
      expect((await rename(jwt, { username })).status, username).toBe(400);
    }
    expect((await rename(jwt, {})).status).toBe(400);
    expect((await me(jwt)).player.usernameBase).toBe("Tom");
  });

  it("keeps an offensive name for its owner (the filter masks it for others)", async () => {
    const jwt = await signIn("Tom");
    expect((await rename(jwt, { username: "ass-player" })).status).toBe(200);
    expect((await me(jwt)).player.usernameBase).toBe("ass-player");
  });

  it("needs a signed-in player", async () => {
    expect((await rename(null, { username: "Nobody" })).status).toBe(401);
  });
});
