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
import { TURNSTILE_SITEVERIFY_URL } from "../../src/api/JoinRoutes";
import { loadOrCreateSigningKey } from "../../src/api/Keys";
import { FetchLike } from "../../src/api/Providers";
import { CosmeticsSchema } from "../../src/core/CosmeticSchemas";
import { TribeSchema } from "../../src/core/Schemas";

// Under a Dark Star, accounts step B3 (docs/DarkStar-Accounts.md §7, §12):
// the join check the game server makes outside dev (Turnstile plus the name
// filter, in the shape JoinVerify.verifyJoin parses), and the upstream
// routes that still get called and must answer harmlessly.

const PROD_ENV = {
  GAME_ENV: "prod",
  DOMAIN: "localhost",
  API_KEY: "shared-key",
  TURNSTILE_SECRET_KEY: "turnstile-secret",
};

interface Harness {
  base: string;
  db: DatabaseSync;
  siteverify: {
    calls: URLSearchParams[];
    answer: { success: boolean; "error-codes"?: string[] };
    status: number;
  };
  log: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  close(): Promise<void>;
}

async function startApi(
  env: Record<string, string> = PROD_ENV,
): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkstar-join-"));
  const config = apiConfigFromEnv({ ...env, DATA_DIR: dir });
  const db = openDatabase(dir);
  const key = await loadOrCreateSigningKey(dir);
  const siteverify: Harness["siteverify"] = {
    calls: [],
    answer: { success: true },
    status: 200,
  };
  const fakeFetch: FetchLike = async (input, init) => {
    if (input === TURNSTILE_SITEVERIFY_URL) {
      siteverify.calls.push(new URLSearchParams(String(init?.body ?? "")));
      return new Response(JSON.stringify(siteverify.answer), {
        status: siteverify.status,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${input}`);
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const server = http.createServer(
    createApiApp({ config, db, key, log, fetch: fakeFetch }),
  );
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    db,
    siteverify,
    log,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function joinVerify(
  h: Harness,
  body: unknown,
  apiKey: string | null = "shared-key",
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (apiKey !== null) headers["x-api-key"] = apiKey;
  return fetch(`${h.base}/join_verify`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /join_verify", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startApi();
  });
  afterEach(async () => {
    await h.close();
  });

  it("checks the token with Cloudflare and returns the screened identity", async () => {
    const res = await joinVerify(h, {
      ip: "203.0.113.9",
      token: "tok-1",
      username: "Tom",
      clanTag: "abc",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "approved",
      username: "Tom",
      clanTag: "ABC",
    });
    expect(h.siteverify.calls).toHaveLength(1);
    const sent = h.siteverify.calls[0];
    expect(sent.get("secret")).toBe("turnstile-secret");
    expect(sent.get("response")).toBe("tok-1");
    expect(sent.get("remoteip")).toBe("203.0.113.9");
  });

  it("rejects when Cloudflare says no, naming its reason", async () => {
    h.siteverify.answer = {
      success: false,
      "error-codes": ["timeout-or-duplicate"],
    };
    const res = await joinVerify(h, {
      ip: "203.0.113.9",
      token: "spent",
      username: "Tom",
      clanTag: null,
    });
    expect(await res.json()).toEqual({
      status: "rejected",
      reason: "timeout-or-duplicate",
    });
  });

  it("skips Cloudflare for a reconnect with no token and still screens the name", async () => {
    const res = await joinVerify(h, {
      ip: "203.0.113.9",
      token: null,
      username: "fuckface",
      clanTag: "ss",
    });
    const body = (await res.json()) as {
      status: string;
      username: string;
      clanTag: string | null;
    };
    expect(body.status).toBe("approved");
    expect(body.username).not.toMatch(/fuck/i);
    expect(body.clanTag).toBeNull();
    expect(h.siteverify.calls).toHaveLength(0);
  });

  it("answers 5xx when Cloudflare itself fails, so the game server fails open", async () => {
    h.siteverify.status = 503;
    const res = await joinVerify(h, {
      ip: "1.2.3.4",
      token: "tok",
      username: "Tom",
      clanTag: null,
    });
    expect(res.status).toBe(500);
  });

  it("refuses a caller without the shared key, and a malformed body", async () => {
    expect(
      (
        await joinVerify(
          h,
          { ip: "1.2.3.4", token: "t", username: "Tom" },
          null,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await joinVerify(
          h,
          { ip: "1.2.3.4", token: "t", username: "Tom" },
          "wrong",
        )
      ).status,
    ).toBe(401);
    expect((await joinVerify(h, { nope: true })).status).toBe(400);
    expect(h.siteverify.calls).toHaveLength(0);
  });

  it("passes every token in dev when no secret is set, warning once", async () => {
    const dev = await startApi({
      GAME_ENV: "dev",
      DOMAIN: "localhost",
      API_KEY: "shared-key",
    });
    try {
      for (const token of ["a", "b"]) {
        const res = await joinVerify(dev, {
          ip: "1.2.3.4",
          token,
          username: "Tom",
          clanTag: null,
        });
        expect(((await res.json()) as { status: string }).status).toBe(
          "approved",
        );
      }
      expect(dev.siteverify.calls).toHaveLength(0);
      expect(dev.log.warn).toHaveBeenCalledTimes(1);
    } finally {
      await dev.close();
    }
  });
});

describe("stub routes", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startApi();
  });
  afterEach(async () => {
    await h.close();
  });

  it("serves an empty cosmetics catalogue the schema accepts", async () => {
    const res = await fetch(`${h.base}/cosmetics.json`);
    expect(res.status).toBe(200);
    expect(CosmeticsSchema.safeParse(await res.json()).success).toBe(true);
  });

  it("serves no reserved clan tags and no custom tribes", async () => {
    expect(await (await fetch(`${h.base}/reserved_clan_tags`)).json()).toEqual(
      [],
    );
    const tribes = (await (await fetch(`${h.base}/custom_tribes`)).json()) as {
      tribes: unknown[];
    };
    expect(tribes.tribes).toEqual([]);
    expect(TribeSchema.array().safeParse(tribes.tribes).success).toBe(true);
  });

  it("accepts and discards archives, and has no record to read back", async () => {
    const solo = await fetch(`${h.base}/archive_singleplayer_game`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anything: true }),
    });
    expect(solo.status).toBe(202);

    const noKey = await fetch(`${h.base}/game/abc123`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ info: { gameID: "abc123" } }),
    });
    expect(noKey.status).toBe(401);
    const withKey = await fetch(`${h.base}/game/abc123`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "shared-key",
      },
      body: JSON.stringify({ info: { gameID: "abc123" } }),
    });
    expect(withKey.status).toBe(202);
    expect(h.log.info).toHaveBeenCalledWith(expect.stringContaining("abc123"));
    expect((await fetch(`${h.base}/game/abc123`)).status).toBe(404);
  });
});
