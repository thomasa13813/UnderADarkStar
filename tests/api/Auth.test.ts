// @vitest-environment node
import fs from "fs";
import http from "http";
import { importJWK, jwtVerify } from "jose";
import type { AddressInfo } from "net";
import { DatabaseSync } from "node:sqlite";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountNameFrom,
  DELETED_ACCOUNT_NAME,
  FALLBACK_ACCOUNT_NAME,
} from "../../src/api/Accounts";
import { createApiApp } from "../../src/api/App";
import {
  SIGN_IN_FAILED_FRAGMENT,
  STATE_COOKIE,
  TOKEN_TTL_SECONDS,
} from "../../src/api/AuthRoutes";
import { ApiConfig, apiConfigFromEnv } from "../../src/api/Config";
import { openDatabase } from "../../src/api/Db";
import { jwksDocument, loadOrCreateSigningKey } from "../../src/api/Keys";
import {
  DISCORD_AUTHORIZE_URL,
  DISCORD_TOKEN_URL,
  DISCORD_USER_URL,
  FetchLike,
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
} from "../../src/api/Providers";
import { REFRESH_COOKIE, SESSION_TTL_MS } from "../../src/api/Sessions";
import {
  TokenPayloadSchema,
  UserMeResponseSchema,
} from "../../src/core/ApiSchemas";

// Under a Dark Star, accounts step B2 (docs/DarkStar-Accounts.md §4.2, §13):
// the dev provider end to end; refresh rotates the cookie and a reused old
// cookie is refused; logout and revoke; an expired session; the Discord
// provider against a stubbed Discord; /users/@me in the shape the client and
// the game server parse; and the account name an identity starts with.

const DEV_ENV = {
  GAME_ENV: "dev",
  DOMAIN: "localhost",
  API_KEY: "test-key",
  DISCORD_CLIENT_ID: "discord-app-id",
  DISCORD_CLIENT_SECRET: "discord-app-secret",
  GOOGLE_CLIENT_ID: "google-app-id",
  GOOGLE_CLIENT_SECRET: "google-app-secret",
};

const SITE = "http://localhost:9000";

interface Harness {
  base: string;
  config: ApiConfig;
  db: DatabaseSync;
  clock: { now: number };
  discord: {
    tokenRequests: { body: URLSearchParams }[];
    userRequests: { authorization: string | undefined }[];
    user: { id: string; username: string; global_name: string | null };
    tokenStatus: number;
  };
  google: {
    tokenRequests: { body: URLSearchParams }[];
    userRequests: { authorization: string | undefined }[];
    user: Record<string, unknown>;
    tokenStatus: number;
  };
  close(): Promise<void>;
}

async function startApi(
  env: Record<string, string> = DEV_ENV,
): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkstar-auth-"));
  const config = apiConfigFromEnv({ ...env, DATA_DIR: dir });
  const db = openDatabase(dir);
  const key = await loadOrCreateSigningKey(dir);
  const clock = { now: Date.UTC(2026, 9, 7, 12, 0, 0) };
  const discord: Harness["discord"] = {
    tokenRequests: [],
    userRequests: [],
    user: { id: "4242", username: "tomsmith", global_name: "Tom Smith" },
    tokenStatus: 200,
  };
  // What Google's userinfo sends for `openid profile`: more than we keep.
  const google: Harness["google"] = {
    tokenRequests: [],
    userRequests: [],
    user: {
      sub: "110248495921238986420",
      name: "Ada Lovelace",
      given_name: "Ada",
      family_name: "Lovelace",
      picture: "https://lh3.googleusercontent.com/a/photo",
    },
    tokenStatus: 200,
  };
  const fakeFetch: FetchLike = async (input, init) => {
    if (input === GOOGLE_TOKEN_URL) {
      google.tokenRequests.push({
        body: new URLSearchParams(String(init?.body ?? "")),
      });
      return new Response(
        JSON.stringify({
          access_token: "google-access",
          id_token: "unused.id.token",
          token_type: "Bearer",
        }),
        {
          status: google.tokenStatus,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (input === GOOGLE_USERINFO_URL) {
      const headers = new Headers(init?.headers);
      google.userRequests.push({
        authorization: headers.get("authorization") ?? undefined,
      });
      return new Response(JSON.stringify(google.user), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (input === DISCORD_TOKEN_URL) {
      discord.tokenRequests.push({
        body: new URLSearchParams(String(init?.body ?? "")),
      });
      return new Response(JSON.stringify({ access_token: "discord-access" }), {
        status: discord.tokenStatus,
        headers: { "content-type": "application/json" },
      });
    }
    if (input === DISCORD_USER_URL) {
      const headers = new Headers(init?.headers);
      discord.userRequests.push({
        authorization: headers.get("authorization") ?? undefined,
      });
      return new Response(JSON.stringify(discord.user), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${input}`);
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const server = http.createServer(
    createApiApp({
      config,
      db,
      key,
      log,
      fetch: fakeFetch,
      now: () => clock.now,
    }),
  );
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    config,
    db,
    clock,
    discord,
    google,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// The value of one Set-Cookie header on a response, or null when the cookie
// was not set. An empty string means it was cleared.
function setCookie(res: Response, name: string): string | null {
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const eq = pair.indexOf("=");
    if (pair.slice(0, eq) === name) return pair.slice(eq + 1);
  }
  return null;
}

function setCookieHeader(res: Response, name: string): string | null {
  return (
    res.headers.getSetCookie().find((h) => h.startsWith(`${name}=`)) ?? null
  );
}

async function devSignIn(h: Harness, name: string): Promise<string> {
  const res = await fetch(
    `${h.base}/auth/login/dev?name=${encodeURIComponent(name)}&redirect=${encodeURIComponent(SITE + "/")}`,
    { redirect: "manual" },
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(SITE + "/");
  const cookie = setCookie(res, REFRESH_COOKIE);
  expect(cookie).toBeTruthy();
  return cookie!;
}

async function refresh(h: Harness, cookie: string): Promise<Response> {
  return fetch(`${h.base}/auth/refresh`, {
    method: "POST",
    headers: { cookie: `${REFRESH_COOKIE}=${cookie}` },
  });
}

describe("account names", () => {
  it("reduces a provider display name to the account alphabet", () => {
    expect(accountNameFrom("Tom Smith")).toBe("Tom_Smith");
    expect(accountNameFrom("  tom   smith ")).toBe("tom_smith");
    expect(accountNameFrom("Ænima.the-first!")).toBe("nimathe-first");
    expect(accountNameFrom("x".repeat(40))).toHaveLength(20);
  });

  it("falls back when nothing usable is left", () => {
    expect(accountNameFrom("🔥🔥🔥")).toBe(FALLBACK_ACCOUNT_NAME);
    expect(accountNameFrom("ab")).toBe(FALLBACK_ACCOUNT_NAME);
    expect(accountNameFrom("")).toBe(FALLBACK_ACCOUNT_NAME);
  });

  it("keeps an offensive name for its owner; the board masks it (B6)", () => {
    expect(accountNameFrom("fuckface")).toBe("fuckface");
  });
});

describe("auth routes (dev provider)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startApi();
  });
  afterEach(async () => {
    await h.close();
  });

  it("signs in, sets the refresh cookie, and issues a token the game server accepts", async () => {
    const res = await fetch(
      `${h.base}/auth/login/dev?name=Tom&redirect=${encodeURIComponent(SITE + "/")}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    const header = setCookieHeader(res, REFRESH_COOKIE)!;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Path=/auth");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);
    // Dev is plain http on localhost.
    expect(header).not.toContain("Secure");
    const cookie = setCookie(res, REFRESH_COOKIE)!;

    const refreshed = await refresh(h, cookie);
    expect(refreshed.status).toBe(200);
    const body = (await refreshed.json()) as {
      token: string;
      jwt: string;
      expiresIn: number;
    };
    expect(body.jwt).toBe(body.token);
    expect(body.expiresIn).toBe(TOKEN_TTL_SECONDS);

    // Verified the way jwt.ts does it, with the served key.
    const jwks = (await (
      await fetch(`${h.base}/.well-known/jwks.json`)
    ).json()) as {
      keys: Parameters<typeof importJWK>[0][];
    };
    const { payload } = await jwtVerify(
      body.jwt,
      await importJWK(jwks.keys[0], "EdDSA"),
      {
        algorithms: ["EdDSA"],
        issuer: "http://localhost:8787",
        audience: "localhost",
      },
    );
    const claims = TokenPayloadSchema.parse(payload);
    expect(claims.provider).toBe("dev");
    expect(claims.role).toBeUndefined();
    const account = h.db.prepare("SELECT id, name FROM accounts").all() as {
      id: string;
      name: string;
    }[];
    expect(account).toHaveLength(1);
    expect(claims.sub).toBe(account[0].id);
    expect(account[0].name).toBe("Tom");

    const me = await fetch(`${h.base}/users/@me`, {
      headers: { authorization: `Bearer ${body.jwt}` },
    });
    expect(me.status).toBe(200);
    const parsed = UserMeResponseSchema.parse(await me.json());
    expect(parsed.player.usernameBase).toBe("Tom");
    expect(parsed.player.usernameDiscriminator).toMatch(/^\d{4}$/);
    expect(parsed.player.username).toBe(
      `Tom.${parsed.player.usernameDiscriminator}`,
    );
    expect(parsed.ban).toBeNull();
    expect(parsed.player.friends).toEqual([]);
  });

  it("rotates the cookie on refresh and refuses the old one", async () => {
    const first = await devSignIn(h, "Tom");
    const r1 = await refresh(h, first);
    expect(r1.status).toBe(200);
    const second = setCookie(r1, REFRESH_COOKIE)!;
    expect(second).not.toBe(first);

    const reused = await refresh(h, first);
    expect(reused.status).toBe(401);
    expect(setCookieHeader(reused, REFRESH_COOKIE)).toContain("Max-Age=0");

    const r2 = await refresh(h, second);
    expect(r2.status).toBe(200);
  });

  it("logout ends this session only", async () => {
    const a = await devSignIn(h, "Tom");
    const b = await devSignIn(h, "Tom");
    const out = await fetch(`${h.base}/auth/logout`, {
      method: "POST",
      headers: { cookie: `${REFRESH_COOKIE}=${a}` },
    });
    expect(out.status).toBe(200);
    expect(setCookieHeader(out, REFRESH_COOKIE)).toContain("Max-Age=0");
    expect((await refresh(h, a)).status).toBe(401);
    expect((await refresh(h, b)).status).toBe(200);
    // Idempotent: a dead cookie logs out fine.
    expect(
      (
        await fetch(`${h.base}/auth/logout`, {
          method: "POST",
          headers: { cookie: `${REFRESH_COOKIE}=${a}` },
        })
      ).status,
    ).toBe(200);
  });

  it("revoke ends every session of the account", async () => {
    const a = await devSignIn(h, "Tom");
    const b = await devSignIn(h, "Tom");
    const other = await devSignIn(h, "Ann");
    const out = await fetch(`${h.base}/auth/revoke`, {
      method: "POST",
      headers: { cookie: `${REFRESH_COOKIE}=${a}` },
    });
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ ok: true, ended: 2 });
    expect((await refresh(h, a)).status).toBe(401);
    expect((await refresh(h, b)).status).toBe(401);
    expect((await refresh(h, other)).status).toBe(200);
  });

  it("delete erases the account at once and leaves its rounds anonymous (A17)", async () => {
    const a = await devSignIn(h, "Tom");
    const b = await devSignIn(h, "Tom");
    const other = await devSignIn(h, "Ann");
    const r = await refresh(h, a);
    const token = ((await r.json()) as { jwt: string }).jwt;
    const live = setCookie(r, REFRESH_COOKIE)!;
    const ids = h.db
      .prepare("SELECT id, name, public_id FROM accounts ORDER BY name")
      .all() as { id: string; name: string; public_id: string }[];
    const ann = ids.find((x) => x.name === "Ann")!;
    const tom = ids.find((x) => x.name === "Tom")!;
    h.db
      .prepare(
        `INSERT INTO rounds (game_id, throne_id, throne_name, throne_type, map,
           started_at, ended_at, humans, outcome, hegemon_account,
           winner_account, reign_after, git_commit, reign_before, hegemon_run)
         VALUES ('g1', 't1', 'Throne', 'ffa', 'Map', 0, 1, 2, 'held', ?, ?, 1,
           NULL, 0, 1)`,
      )
      .run(tom.id, tom.id);
    h.db
      .prepare(
        "INSERT INTO round_players (game_id, account_id, was_hegemon, won) VALUES ('g1', ?, 1, 1), ('g1', ?, 0, 0)",
      )
      .run(tom.id, ann.id);
    h.db
      .prepare(
        "INSERT INTO stats (account_id, rounds_held, hegemon_rounds, longest_reign, games_played, updated_at) VALUES (?, 1, 1, 1, 1, 0), (?, 0, 0, 0, 1, 0)",
      )
      .run(tom.id, ann.id);

    const out = await fetch(`${h.base}/auth/delete`, {
      method: "POST",
      headers: { cookie: `${REFRESH_COOKIE}=${live}` },
    });
    expect(out.status).toBe(204);
    expect(setCookieHeader(out, REFRESH_COOKIE)).toContain("Max-Age=0");

    // Every session ends and the token stops being honoured.
    expect((await refresh(h, b)).status).toBe(401);
    const me = await fetch(`${h.base}/users/@me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(401);

    // Nothing left that names the person or links a round to them.
    const count = (sql: string, ...args: string[]) =>
      (h.db.prepare(sql).get(...args) as { n: number }).n;
    expect(
      count(
        "SELECT COUNT(*) AS n FROM identities WHERE account_id = ?",
        tom.id,
      ),
    ).toBe(0);
    expect(
      count("SELECT COUNT(*) AS n FROM sessions WHERE account_id = ?", tom.id),
    ).toBe(0);
    expect(
      count("SELECT COUNT(*) AS n FROM stats WHERE account_id = ?", tom.id),
    ).toBe(0);
    expect(
      count(
        "SELECT COUNT(*) AS n FROM round_players WHERE account_id = ?",
        tom.id,
      ),
    ).toBe(0);
    expect(
      h.db
        .prepare(
          "SELECT hegemon_account, winner_account FROM rounds WHERE game_id = 'g1'",
        )
        .get(),
    ).toEqual({ hegemon_account: null, winner_account: null });
    const tombstone = h.db
      .prepare("SELECT * FROM accounts WHERE id = ?")
      .get(tom.id) as { name: string; public_id: string; deleted_at: number };
    expect(tombstone.name).toBe(DELETED_ACCOUNT_NAME);
    expect(tombstone.public_id).not.toBe(tom.public_id);
    expect(tombstone.deleted_at).toBe(h.clock.now);

    // Another account is untouched.
    expect((await refresh(h, other)).status).toBe(200);
    expect(
      count(
        "SELECT COUNT(*) AS n FROM round_players WHERE account_id = ?",
        ann.id,
      ),
    ).toBe(1);

    // Signing in again with the same login starts a new, empty account.
    await devSignIn(h, "Tom");
    const fresh = h.db
      .prepare(
        "SELECT id FROM accounts WHERE name = 'Tom' AND deleted_at IS NULL",
      )
      .get() as { id: string };
    expect(fresh.id).not.toBe(tom.id);
  });

  it("delete answers 401 without a live session", async () => {
    const none = await fetch(`${h.base}/auth/delete`, { method: "POST" });
    expect(none.status).toBe(401);
    const a = await devSignIn(h, "Tom");
    await fetch(`${h.base}/auth/logout`, {
      method: "POST",
      headers: { cookie: `${REFRESH_COOKIE}=${a}` },
    });
    const dead = await fetch(`${h.base}/auth/delete`, {
      method: "POST",
      headers: { cookie: `${REFRESH_COOKIE}=${a}` },
    });
    expect(dead.status).toBe(401);
    expect(h.db.prepare("SELECT deleted_at FROM accounts").get()).toEqual({
      deleted_at: null,
    });
  });

  it("delete is refused while a ban is in force", async () => {
    const a = await devSignIn(h, "Tom");
    h.db
      .prepare("UPDATE accounts SET ban_reason = 'cheating', ban_until = NULL")
      .run();
    const out = await fetch(`${h.base}/auth/delete`, {
      method: "POST",
      headers: { cookie: `${REFRESH_COOKIE}=${a}` },
    });
    expect(out.status).toBe(403);
    expect(await out.json()).toEqual({ error: "banned" });
    const row = h.db.prepare("SELECT name, deleted_at FROM accounts").get() as {
      name: string;
      deleted_at: number | null;
    };
    expect(row).toEqual({ name: "Tom", deleted_at: null });
  });

  it("refuses an expired session", async () => {
    const cookie = await devSignIn(h, "Tom");
    h.clock.now += SESSION_TTL_MS - 1000;
    expect((await refresh(h, cookie)).status).toBe(200);
    const rotated = setCookie(
      await (async () => {
        // The rotation above handed out a new cookie; fetch it again.
        const r = await refresh(h, cookie);
        return r;
      })(),
      REFRESH_COOKIE,
    );
    // The first cookie is spent; the session's life has not moved.
    expect(rotated).toBe("");
    h.clock.now += 2000;
    const fresh = await devSignIn(h, "Ann");
    h.clock.now += SESSION_TTL_MS;
    expect((await refresh(h, fresh)).status).toBe(401);
  });

  it("the same login is the same account; a different one is not", async () => {
    await devSignIn(h, "Tom");
    await devSignIn(h, "tom");
    await devSignIn(h, "Ann");
    const rows = h.db
      .prepare("SELECT name FROM accounts ORDER BY name")
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(["Ann", "Tom"]);
    const sessions = h.db
      .prepare("SELECT COUNT(*) AS n FROM sessions")
      .get() as {
      n: number;
    };
    expect(sessions.n).toBe(3);
  });

  it("sends the browser back to the page, never to a stranger", async () => {
    const stranger = await fetch(
      `${h.base}/auth/login/dev?name=Tom&redirect=${encodeURIComponent("https://evil.example/steal")}`,
      { redirect: "manual" },
    );
    expect(stranger.headers.get("location")).toBe(SITE);
    const none = await fetch(`${h.base}/auth/login/dev?name=Tom`, {
      redirect: "manual",
    });
    expect(none.headers.get("location")).toBe(SITE);
    const ours = await fetch(
      `${h.base}/auth/login/dev?name=Tom&redirect=${encodeURIComponent("http://localhost:9000/?x=1#top")}`,
      { redirect: "manual" },
    );
    expect(ours.headers.get("location")).toBe("http://localhost:9000/?x=1#top");
  });

  it("answers /users/@me with 401 for no token, a forged token, or a deleted account", async () => {
    expect((await fetch(`${h.base}/users/@me`)).status).toBe(401);
    expect(
      (
        await fetch(`${h.base}/users/@me`, {
          headers: { authorization: "Bearer not.a.token" },
        })
      ).status,
    ).toBe(401);
    const cookie = await devSignIn(h, "Tom");
    const { jwt } = (await (await refresh(h, cookie)).json()) as {
      jwt: string;
    };
    h.db.prepare("UPDATE accounts SET deleted_at = ?").run(h.clock.now);
    expect(
      (
        await fetch(`${h.base}/users/@me`, {
          headers: { authorization: `Bearer ${jwt}` },
        })
      ).status,
    ).toBe(401);
  });

  it("carries a ban into the token and the profile", async () => {
    const cookie = await devSignIn(h, "Tom");
    h.db
      .prepare("UPDATE accounts SET ban_reason = ?, ban_until = ?")
      .run("spam", h.clock.now + 60_000);
    const r = await refresh(h, cookie);
    const { jwt } = (await r.json()) as { jwt: string };
    const jwks = (await (
      await fetch(`${h.base}/.well-known/jwks.json`)
    ).json()) as {
      keys: Parameters<typeof importJWK>[0][];
    };
    const { payload } = await jwtVerify(
      jwt,
      await importJWK(jwks.keys[0], "EdDSA"),
    );
    expect(payload.role).toBe("banned");
    const me = UserMeResponseSchema.parse(
      await (
        await fetch(`${h.base}/users/@me`, {
          headers: { authorization: `Bearer ${jwt}` },
        })
      ).json(),
    );
    expect(me.ban).toMatchObject({ reason: "spam" });

    // Once the ban lapses, the role is gone.
    h.clock.now += 120_000;
    const later = await refresh(h, setCookie(r, REFRESH_COOKIE)!);
    const { payload: laterPayload } = await jwtVerify(
      ((await later.json()) as { jwt: string }).jwt,
      await importJWK(jwks.keys[0], "EdDSA"),
    );
    expect(laterPayload.role).toBeUndefined();
  });
});

describe("auth routes (discord provider)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startApi();
  });
  afterEach(async () => {
    await h.close();
  });

  async function beginDiscord(): Promise<{
    state: string;
    stateCookie: string;
  }> {
    const res = await fetch(
      `${h.base}/auth/login/discord?redirect=${encodeURIComponent(SITE + "/")}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(
      DISCORD_AUTHORIZE_URL,
    );
    expect(location.searchParams.get("client_id")).toBe("discord-app-id");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("scope")).toBe("identify");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:8787/auth/callback/discord",
    );
    const state = location.searchParams.get("state")!;
    expect(state.length).toBeGreaterThan(10);
    const stateCookie = setCookie(res, STATE_COOKIE)!;
    expect(stateCookie.startsWith(`${state}.`)).toBe(true);
    expect(setCookieHeader(res, STATE_COOKIE)).toContain("HttpOnly");
    // No session yet.
    expect(setCookie(res, REFRESH_COOKIE)).toBeNull();
    return { state, stateCookie };
  }

  it("round-trips through Discord and creates the account", async () => {
    const { state, stateCookie } = await beginDiscord();
    const back = await fetch(
      `${h.base}/auth/callback/discord?code=the-code&state=${encodeURIComponent(state)}`,
      {
        redirect: "manual",
        headers: { cookie: `${STATE_COOKIE}=${stateCookie}` },
      },
    );
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe(SITE + "/");
    expect(setCookieHeader(back, STATE_COOKIE)).toContain("Max-Age=0");
    const cookie = setCookie(back, REFRESH_COOKIE)!;
    expect(cookie).toBeTruthy();

    // The exchange carried the code and the secret; the lookup the token.
    expect(h.discord.tokenRequests).toHaveLength(1);
    const body = h.discord.tokenRequests[0].body;
    expect(body.get("code")).toBe("the-code");
    expect(body.get("client_secret")).toBe("discord-app-secret");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe(
      "http://localhost:8787/auth/callback/discord",
    );
    expect(h.discord.userRequests[0].authorization).toBe(
      "Bearer discord-access",
    );

    const identity = h.db
      .prepare("SELECT provider, provider_user_id FROM identities")
      .get() as { provider: string; provider_user_id: string };
    expect(identity).toEqual({ provider: "discord", provider_user_id: "4242" });
    const account = h.db.prepare("SELECT name FROM accounts").get() as {
      name: string;
    };
    expect(account.name).toBe("Tom_Smith");

    const { jwt } = (await (await refresh(h, cookie)).json()) as {
      jwt: string;
    };
    const jwks = (await (
      await fetch(`${h.base}/.well-known/jwks.json`)
    ).json()) as {
      keys: Parameters<typeof importJWK>[0][];
    };
    const { payload } = await jwtVerify(
      jwt,
      await importJWK(jwks.keys[0], "EdDSA"),
    );
    expect(payload.provider).toBe("discord");

    // Signing in again is the same account.
    const again = await beginDiscord();
    await fetch(
      `${h.base}/auth/callback/discord?code=c2&state=${encodeURIComponent(again.state)}`,
      {
        redirect: "manual",
        headers: { cookie: `${STATE_COOKIE}=${again.stateCookie}` },
      },
    );
    expect(
      (
        h.db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
  });

  it("refuses a callback whose state does not match, or that was denied", async () => {
    const { stateCookie } = await beginDiscord();
    const wrong = await fetch(
      `${h.base}/auth/callback/discord?code=the-code&state=forged`,
      {
        redirect: "manual",
        headers: { cookie: `${STATE_COOKIE}=${stateCookie}` },
      },
    );
    expect(wrong.status).toBe(302);
    expect(wrong.headers.get("location")).toBe(
      SITE + "/" + SIGN_IN_FAILED_FRAGMENT,
    );
    expect(setCookie(wrong, REFRESH_COOKIE)).toBeNull();
    expect(h.discord.tokenRequests).toHaveLength(0);

    const noCookie = await fetch(
      `${h.base}/auth/callback/discord?code=the-code&state=whatever`,
      { redirect: "manual" },
    );
    expect(noCookie.headers.get("location")).toBe(
      SITE + SIGN_IN_FAILED_FRAGMENT,
    );

    const { state, stateCookie: sc2 } = await beginDiscord();
    const denied = await fetch(
      `${h.base}/auth/callback/discord?error=access_denied&state=${encodeURIComponent(state)}`,
      { redirect: "manual", headers: { cookie: `${STATE_COOKIE}=${sc2}` } },
    );
    expect(denied.headers.get("location")).toBe(
      SITE + "/" + SIGN_IN_FAILED_FRAGMENT,
    );
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM accounts").get()).toEqual({
      n: 0,
    });
  });

  it("fails closed when Discord refuses the code", async () => {
    const { state, stateCookie } = await beginDiscord();
    h.discord.tokenStatus = 400;
    const back = await fetch(
      `${h.base}/auth/callback/discord?code=bad&state=${encodeURIComponent(state)}`,
      {
        redirect: "manual",
        headers: { cookie: `${STATE_COOKIE}=${stateCookie}` },
      },
    );
    expect(back.headers.get("location")).toBe(
      SITE + "/" + SIGN_IN_FAILED_FRAGMENT,
    );
    expect(setCookie(back, REFRESH_COOKIE)).toBeNull();
  });

  it("uses the username when there is no global name", async () => {
    h.discord.user = { id: "7", username: "plain_user", global_name: null };
    const { state, stateCookie } = await beginDiscord();
    await fetch(
      `${h.base}/auth/callback/discord?code=c&state=${encodeURIComponent(state)}`,
      {
        redirect: "manual",
        headers: { cookie: `${STATE_COOKIE}=${stateCookie}` },
      },
    );
    expect(
      (h.db.prepare("SELECT name FROM accounts").get() as { name: string })
        .name,
    ).toBe("plain_user");
  });
});

describe("auth routes (google provider)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startApi();
  });
  afterEach(async () => {
    await h.close();
  });

  async function beginGoogle(): Promise<{
    state: string;
    stateCookie: string;
  }> {
    const res = await fetch(
      `${h.base}/auth/login/google?redirect=${encodeURIComponent(SITE + "/")}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(GOOGLE_AUTHORIZE_URL);
    expect(location.searchParams.get("client_id")).toBe("google-app-id");
    expect(location.searchParams.get("response_type")).toBe("code");
    // The privacy policy's promise: the ID and the name, never the email.
    expect(location.searchParams.get("scope")).toBe("openid profile");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:8787/auth/callback/google",
    );
    const state = location.searchParams.get("state")!;
    expect(state.length).toBeGreaterThan(10);
    const stateCookie = setCookie(res, STATE_COOKIE)!;
    expect(stateCookie.startsWith(`${state}.`)).toBe(true);
    expect(setCookieHeader(res, STATE_COOKIE)).toContain("HttpOnly");
    expect(setCookie(res, REFRESH_COOKIE)).toBeNull();
    return { state, stateCookie };
  }

  async function callback(
    code: string,
    begun: { state: string; stateCookie: string },
  ) {
    return fetch(
      `${h.base}/auth/callback/google?code=${code}&state=${encodeURIComponent(begun.state)}`,
      {
        redirect: "manual",
        headers: { cookie: `${STATE_COOKIE}=${begun.stateCookie}` },
      },
    );
  }

  it("round-trips through Google and keeps only the ID and the name", async () => {
    const back = await callback("the-code", await beginGoogle());
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe(SITE + "/");
    expect(setCookieHeader(back, STATE_COOKIE)).toContain("Max-Age=0");
    const cookie = setCookie(back, REFRESH_COOKIE)!;
    expect(cookie).toBeTruthy();

    expect(h.google.tokenRequests).toHaveLength(1);
    const body = h.google.tokenRequests[0].body;
    expect(body.get("code")).toBe("the-code");
    expect(body.get("client_id")).toBe("google-app-id");
    expect(body.get("client_secret")).toBe("google-app-secret");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe(
      "http://localhost:8787/auth/callback/google",
    );
    expect(h.google.userRequests[0].authorization).toBe("Bearer google-access");
    // Discord was not asked.
    expect(h.discord.tokenRequests).toHaveLength(0);

    const identity = h.db
      .prepare("SELECT provider, provider_user_id FROM identities")
      .get() as { provider: string; provider_user_id: string };
    expect(identity).toEqual({
      provider: "google",
      provider_user_id: "110248495921238986420",
    });
    const account = h.db.prepare("SELECT * FROM accounts").get() as Record<
      string,
      unknown
    >;
    expect(account.name).toBe("Ada_Lovelace");
    // Nothing else Google sent (the picture, the given and family names)
    // was stored anywhere.
    const everything = JSON.stringify([
      h.db.prepare("SELECT * FROM accounts").all(),
      h.db.prepare("SELECT * FROM identities").all(),
    ]);
    expect(everything).not.toContain("googleusercontent");
    expect(everything).not.toContain('"Ada"');

    const { jwt } = (await (await refresh(h, cookie)).json()) as {
      jwt: string;
    };
    const jwks = (await (
      await fetch(`${h.base}/.well-known/jwks.json`)
    ).json()) as {
      keys: Parameters<typeof importJWK>[0][];
    };
    const { payload } = await jwtVerify(
      jwt,
      await importJWK(jwks.keys[0], "EdDSA"),
    );
    expect(payload.provider).toBe("google");

    // Signing in again is the same account.
    await callback("c2", await beginGoogle());
    expect(
      (
        h.db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
  });

  it("refuses a callback whose state does not match, or that was denied", async () => {
    const { stateCookie } = await beginGoogle();
    const wrong = await callback("the-code", { state: "forged", stateCookie });
    expect(wrong.headers.get("location")).toBe(
      SITE + "/" + SIGN_IN_FAILED_FRAGMENT,
    );
    expect(setCookie(wrong, REFRESH_COOKIE)).toBeNull();
    expect(h.google.tokenRequests).toHaveLength(0);

    const begun = await beginGoogle();
    const denied = await fetch(
      `${h.base}/auth/callback/google?error=access_denied&state=${encodeURIComponent(begun.state)}`,
      {
        redirect: "manual",
        headers: { cookie: `${STATE_COOKIE}=${begun.stateCookie}` },
      },
    );
    expect(denied.headers.get("location")).toBe(
      SITE + "/" + SIGN_IN_FAILED_FRAGMENT,
    );
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM accounts").get()).toEqual({
      n: 0,
    });
  });

  it("fails closed when Google refuses the code", async () => {
    const begun = await beginGoogle();
    h.google.tokenStatus = 400;
    const back = await callback("bad", begun);
    expect(back.headers.get("location")).toBe(
      SITE + "/" + SIGN_IN_FAILED_FRAGMENT,
    );
    expect(setCookie(back, REFRESH_COOKIE)).toBeNull();
  });

  it("names the account Player when Google sends no name", async () => {
    h.google.user = { sub: "9" };
    await callback("c", await beginGoogle());
    expect(
      (h.db.prepare("SELECT name FROM accounts").get() as { name: string })
        .name,
    ).toBe(FALLBACK_ACCOUNT_NAME);
  });

  it("fails closed when the userinfo has no sub", async () => {
    h.google.user = { name: "No Id" };
    const back = await callback("c", await beginGoogle());
    expect(back.headers.get("location")).toBe(
      SITE + "/" + SIGN_IN_FAILED_FRAGMENT,
    );
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM accounts").get()).toEqual({
      n: 0,
    });
  });

  it("is listed by /auth/providers", async () => {
    const res = await fetch(`${h.base}/auth/providers`);
    expect(await res.json()).toEqual({
      providers: ["dev", "discord", "google"],
    });
  });
});

describe("providers offered", () => {
  it("has no dev provider outside dev, and no Discord without keys", async () => {
    const prod = await startApi({
      GAME_ENV: "prod",
      DOMAIN: "example.com",
      API_KEY: "k",
      TURNSTILE_SECRET_KEY: "s",
    });
    try {
      expect(
        (
          await fetch(`${prod.base}/auth/login/dev?name=x`, {
            redirect: "manual",
          })
        ).status,
      ).toBe(404);
      expect(
        (await fetch(`${prod.base}/auth/login/discord`, { redirect: "manual" }))
          .status,
      ).toBe(404);
      expect(
        (await fetch(`${prod.base}/auth/login/google`, { redirect: "manual" }))
          .status,
      ).toBe(404);
      expect(
        (
          await fetch(`${prod.base}/auth/callback/google?code=c&state=s`, {
            redirect: "manual",
          })
        ).status,
      ).toBe(404);
      expect(await (await fetch(`${prod.base}/auth/providers`)).json()).toEqual(
        { providers: [] },
      );
      expect(prod.config.siteOrigin).toBe("https://example.com");
    } finally {
      await prod.close();
    }
  });

  it("marks the cookie Secure outside dev", async () => {
    const prod = await startApi({
      GAME_ENV: "prod",
      DOMAIN: "example.com",
      API_KEY: "k",
      DISCORD_CLIENT_ID: "id",
      DISCORD_CLIENT_SECRET: "secret",
      TURNSTILE_SECRET_KEY: "s",
    });
    try {
      const res = await fetch(`${prod.base}/auth/login/discord`, {
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      expect(setCookieHeader(res, STATE_COOKIE)).toContain("Secure");
      expect(
        new URL(res.headers.get("location")!).searchParams.get("redirect_uri"),
      ).toBe("https://api.example.com/auth/callback/discord");
    } finally {
      await prod.close();
    }
  });

  it("refuses half a provider", () => {
    expect(() =>
      apiConfigFromEnv({
        GAME_ENV: "dev",
        DOMAIN: "localhost",
        API_KEY: "k",
        DISCORD_CLIENT_ID: "id",
      }),
    ).toThrow(/DISCORD_CLIENT_SECRET/);
    expect(() =>
      apiConfigFromEnv({
        GAME_ENV: "dev",
        DOMAIN: "localhost",
        API_KEY: "k",
        GOOGLE_CLIENT_SECRET: "secret",
      }),
    ).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it("offers Google only with both keys, at the production callback", async () => {
    const prod = await startApi({
      GAME_ENV: "prod",
      DOMAIN: "darkstar.january-games.com",
      API_DOMAIN: "darkstar-api.january-games.com",
      API_KEY: "k",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      TURNSTILE_SECRET_KEY: "s",
    });
    try {
      const res = await fetch(`${prod.base}/auth/login/google`, {
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      expect(
        new URL(res.headers.get("location")!).searchParams.get("redirect_uri"),
      ).toBe("https://darkstar-api.january-games.com/auth/callback/google");
      expect(await (await fetch(`${prod.base}/auth/providers`)).json()).toEqual(
        { providers: ["google"] },
      );
    } finally {
      await prod.close();
    }
  });
});

describe("jwks", () => {
  it("is the key the tokens verify against", async () => {
    const h = await startApi();
    try {
      const cookie = await devSignIn(h, "Tom");
      const { jwt } = (await (await refresh(h, cookie)).json()) as {
        jwt: string;
      };
      const served = (await (
        await fetch(`${h.base}/.well-known/jwks.json`)
      ).json()) as ReturnType<typeof jwksDocument>;
      await expect(
        jwtVerify(jwt, await importJWK(served.keys[0], "EdDSA"), {
          issuer: "http://localhost:8787",
          audience: "localhost",
        }),
      ).resolves.toBeTruthy();
    } finally {
      await h.close();
    }
  });
});
