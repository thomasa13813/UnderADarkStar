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
import { LEADERBOARD_SIZE } from "../../src/api/Leaderboard";
import { LEADERBOARD_CACHE_MS } from "../../src/api/LeaderboardRoutes";
import { RecordStore } from "../../src/api/Records";
import { ingestRecord } from "../../src/api/Results";
import { REFRESH_COOKIE } from "../../src/api/Sessions";
import {
  LeaderboardResponse,
  LeaderboardResponseSchema,
  LeaderboardSort,
} from "../../src/core/ApiSchemas";
import { GameType } from "../../src/core/game/Game";
import { GameRecord, PlayerRecord } from "../../src/core/Schemas";
import { testGameConfig } from "../util/Wire";

// Under a Dark Star, accounts step B5 (docs/DarkStar-Accounts.md §6, §13):
// GET /leaderboard. One list over the stats the ingest writes, its three
// sorts, their order and ties, who is left off (banned, deleted, nothing
// recorded), the caller's own row, the top-100 cut, the one-minute cache
// and the cache headers. Since 2026-10-17 a victory is every round won and
// a reign a round played as Hegemon; the runs across rounds and thrones are
// checked here end to end.

const DEV_ENV = {
  GAME_ENV: "dev",
  DOMAIN: "localhost",
  API_KEY: "shared-key",
};
const SITE = "http://localhost:9000";

interface Account {
  id: string;
  name: string;
  jwt: string;
}

interface Harness {
  base: string;
  db: DatabaseSync;
  clock: { now: number };
  close(): Promise<void>;
}

async function startApi(): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkstar-board-"));
  const config = apiConfigFromEnv({ ...DEV_ENV, DATA_DIR: dir });
  const db = openDatabase(dir);
  const key = await loadOrCreateSigningKey(dir);
  const clock = { now: Date.UTC(2026, 9, 12, 12, 0, 0) };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const server = http.createServer(
    createApiApp({
      config,
      db,
      key,
      log,
      records: new RecordStore(dir),
      now: () => clock.now,
    }),
  );
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    db,
    clock,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function signIn(h: Harness, name: string): Promise<Account> {
  const res = await fetch(
    `${h.base}/auth/login/dev?name=${encodeURIComponent(name)}&redirect=${encodeURIComponent(SITE + "/")}`,
    { redirect: "manual" },
  );
  expect(res.status).toBe(302);
  const pair = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith(`${REFRESH_COOKIE}=`))!;
  const refreshed = await fetch(`${h.base}/auth/refresh`, {
    method: "POST",
    headers: { cookie: pair },
  });
  expect(refreshed.status).toBe(200);
  const { jwt } = (await refreshed.json()) as { jwt: string };
  const row = h.db
    .prepare("SELECT id FROM accounts WHERE name = ?")
    .get(name) as { id: string };
  return { id: row.id, name, jwt };
}

let nextGame = 0;

// One public throne round, recorded straight into the database. `overthrow`:
// the account lands the killing blow on a guest Hegemon. `timer`: the
// account is the seated Hegemon and holds to the end. `lost`: the account is
// the seated Hegemon and a guest overthrows them. `reignBefore` is the badge
// the seated Hegemon brought in (0 for a claimant).
function round(
  h: Harness,
  account: Account,
  how: "overthrow" | "timer" | "lost",
  options: { reignBefore?: number; throne?: string; others?: Account[] } = {},
): void {
  const { reignBefore = 0, throne = "throne-01", others = [] } = options;
  const id = `GAME${String(nextGame++).padStart(4, "0")}`;
  const player = (
    clientID: string,
    persistentID: string,
    verified: boolean,
    isHegemon: boolean,
  ): PlayerRecord => ({
    clientID,
    username: clientID,
    clanTag: null,
    persistentID,
    stats: {},
    verified,
    isHegemon,
  });
  const players =
    how === "overthrow"
      ? [
          player("hegemon", "guest-hegemon", false, true),
          player("account", account.id, true, false),
        ]
      : [
          player("account", account.id, true, true),
          player("rebel", "guest-rebel", false, false),
        ];
  for (const o of others) players.push(player(o.name, o.id, true, false));
  const start = h.clock.now - 20 * 60 * 1000;
  const record: GameRecord = {
    version: "v0.0.2",
    gitCommit: "DEV",
    subdomain: "",
    domain: "localhost",
    info: {
      gameID: id,
      lobbyCreatedAt: start - 60_000,
      lobbyFillTime: 60,
      config: testGameConfig({
        gameType: GameType.Public,
        hegemon: { enabled: true },
      }),
      players,
      start,
      end: h.clock.now,
      duration: 1200,
      num_turns: 1,
      winner: ["player", how === "lost" ? "rebel" : "account"],
      throne: {
        throneID: throne,
        name: throne === "throne-01" ? "Vega" : "Altair",
        type: "ffa",
        reignBefore,
      },
    },
    turns: [{ turnNumber: 0, intents: [], hash: 0 }],
  };
  const result = ingestRecord(h.db, record, h.clock.now);
  expect(result.kind).toBe("recorded");
}

async function list(
  h: Harness,
  sort?: LeaderboardSort | string,
  account?: Account,
): Promise<{ res: Response; body: LeaderboardResponse }> {
  const url =
    sort === undefined
      ? `${h.base}/leaderboard`
      : `${h.base}/leaderboard?sort=${sort}`;
  const res = await fetch(url, {
    headers:
      account === undefined ? {} : { authorization: `Bearer ${account.jwt}` },
  });
  expect(res.status).toBe(200);
  const body = LeaderboardResponseSchema.parse(await res.json());
  return { res, body };
}

// [rank, name, victories, reigns, longest reign] per row.
const brief = (b: LeaderboardResponse) =>
  b.entries.map((e) => [
    e.rank,
    e.username.split(".")[0],
    e.victories,
    e.reigns,
    e.longestReign,
  ]);

let h: Harness;

beforeEach(async () => {
  h = await startApi();
});

afterEach(async () => {
  await h.close();
});

describe("GET /leaderboard", () => {
  it("is empty before any round, sorted by victories, and a stranger has no own row", async () => {
    const { res, body } = await list(h);
    expect(body).toEqual({
      sort: "victories",
      generatedAt: h.clock.now,
      entries: [],
      me: null,
    });
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("vary")).toContain("Authorization");
  });

  it("refuses a sort it does not have", async () => {
    const res = await fetch(`${h.base}/leaderboard?sort=elo`);
    expect(res.status).toBe(400);
  });

  it("ranks the list under each sort, sharing a rank on a tie", async () => {
    const alpha = await signIn(h, "Alpha");
    const bravo = await signIn(h, "Bravo");
    const charlie = await signIn(h, "Charlie");
    const delta = await signIn(h, "Delta");
    const echo = await signIn(h, "Echo");
    // Alpha: a throne taken, then held twice: victories 3, two rounds seated
    // in one run.
    round(h, alpha, "overthrow", { others: [echo] });
    round(h, alpha, "timer", { reignBefore: 1 });
    round(h, alpha, "timer", { reignBefore: 2 });
    // Bravo: three thrones taken and never sat on: victories 3, reigns 0.
    round(h, bravo, "overthrow");
    round(h, bravo, "overthrow");
    round(h, bravo, "overthrow");
    // Charlie: taken, then held once: victories 2, one round seated.
    round(h, charlie, "overthrow");
    round(h, charlie, "timer", { reignBefore: 1 });
    // Delta: one throne taken. Echo only played.
    round(h, delta, "overthrow");

    const victories = (await list(h, "victories")).body;
    // Alpha and Bravo share the top with three victories each; reigns order
    // them, and the rank after a shared one skips (1, 1, 3, 4).
    expect(brief(victories)).toEqual([
      [1, "Alpha", 3, 2, 2],
      [1, "Bravo", 3, 0, 0],
      [3, "Charlie", 2, 1, 1],
      [4, "Delta", 1, 0, 0],
    ]);
    expect(victories.entries[0].username).toMatch(/^Alpha\.\d{4}$/);

    // Bravo and Delta share no reigns; victories order them.
    const reigns = (await list(h, "reigns")).body;
    expect(brief(reigns)).toEqual([
      [1, "Alpha", 3, 2, 2],
      [2, "Charlie", 2, 1, 1],
      [3, "Bravo", 3, 0, 0],
      [3, "Delta", 1, 0, 0],
    ]);

    const longest = (await list(h, "longest")).body;
    expect(brief(longest)).toEqual([
      [1, "Alpha", 3, 2, 2],
      [2, "Charlie", 2, 1, 1],
      [3, "Bravo", 3, 0, 0],
      [3, "Delta", 1, 0, 0],
    ]);
  });

  it("lists a Hegemon who sat and lost, with no victory", async () => {
    const alpha = await signIn(h, "Alpha");
    // A claimant takes the open seat and is overthrown by a guest.
    round(h, alpha, "lost");
    expect(brief((await list(h)).body)).toEqual([[1, "Alpha", 0, 1, 1]]);
  });

  it("runs a reign across rounds on one throne, never across thrones", async () => {
    const alpha = await signIn(h, "Alpha");
    // Two rounds held on Vega after taking it: a run of two.
    round(h, alpha, "overthrow");
    round(h, alpha, "timer", { reignBefore: 1 });
    round(h, alpha, "timer", { reignBefore: 2 });
    // Then the open seat of Altair, claimed: a new run, however the badge
    // on Vega stood.
    round(h, alpha, "timer", { throne: "throne-02" });
    expect(brief((await list(h)).body)).toEqual([[1, "Alpha", 4, 3, 2]]);
    // Kept on Altair for two more rounds, the last one lost: a run of three.
    h.clock.now += LEADERBOARD_CACHE_MS;
    round(h, alpha, "timer", { throne: "throne-02", reignBefore: 1 });
    round(h, alpha, "lost", { throne: "throne-02", reignBefore: 2 });
    expect(brief((await list(h)).body)).toEqual([[1, "Alpha", 5, 5, 3]]);
    // Back on Vega as a claimant (reignBefore 0): the run of two there is
    // over, so three holds after the claim make a run of four, not six.
    h.clock.now += LEADERBOARD_CACHE_MS;
    round(h, alpha, "timer", { reignBefore: 0 });
    round(h, alpha, "timer", { reignBefore: 1 });
    round(h, alpha, "timer", { reignBefore: 2 });
    round(h, alpha, "timer", { reignBefore: 3 });
    expect(brief((await list(h)).body)).toEqual([[1, "Alpha", 9, 9, 4]]);
  });

  it("gives a signed-in caller their own row, ranked or not", async () => {
    const alpha = await signIn(h, "Alpha");
    const bravo = await signIn(h, "Bravo");
    const echo = await signIn(h, "Echo");
    round(h, alpha, "overthrow", { others: [echo] });
    round(h, bravo, "overthrow");
    round(h, bravo, "timer", { reignBefore: 1 });

    const mine = await list(h, "victories", alpha);
    expect(mine.body.me).toMatchObject({
      rank: 2,
      victories: 1,
      reigns: 0,
      longestReign: 0,
    });
    expect(mine.body.me?.publicId).toBe(mine.body.entries[1].publicId);
    expect(mine.res.headers.get("cache-control")).toBe("private, max-age=60");

    // Echo played, never won or sat: not on the list, own row unranked with
    // zeros.
    const theirs = await list(h, "longest", echo);
    expect(theirs.body.entries.map((e) => e.publicId)).not.toContain(
      theirs.body.me?.publicId,
    );
    expect(theirs.body.me).toMatchObject({
      rank: null,
      victories: 0,
      reigns: 0,
      longestReign: 0,
      username: expect.stringMatching(/^Echo\.\d{4}$/),
    });

    // A token that does not verify is simply anonymous.
    const res = await fetch(`${h.base}/leaderboard`, {
      headers: { authorization: "Bearer not-a-token" },
    });
    expect(LeaderboardResponseSchema.parse(await res.json()).me).toBeNull();
  });

  it("masks an offensive name for everyone but its owner (B6)", async () => {
    const rude = await signIn(h, "ass-player");
    const other = await signIn(h, "Bravo");
    round(h, rude, "overthrow");
    round(h, other, "overthrow");

    const seen = await list(h, "victories", other);
    expect(seen.body.entries.map((e) => e.username)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^\*\*\*-player\.\d{4}$/)]),
    );
    const own = await list(h, "victories", rude);
    expect(own.body.me?.username).toMatch(/^ass-player\.\d{4}$/);
  });

  it("leaves banned and deleted accounts off, and puts a lifted ban back", async () => {
    const alpha = await signIn(h, "Alpha");
    const bravo = await signIn(h, "Bravo");
    const charlie = await signIn(h, "Charlie");
    round(h, alpha, "overthrow");
    round(h, bravo, "overthrow");
    round(h, charlie, "overthrow");
    h.db
      .prepare("UPDATE accounts SET ban_reason = 'farming' WHERE id = ?")
      .run(alpha.id);
    h.db
      .prepare("UPDATE accounts SET ban_until = ? WHERE id = ?")
      .run(h.clock.now + 60_000, bravo.id);
    h.db
      .prepare("UPDATE accounts SET deleted_at = ? WHERE id = ?")
      .run(h.clock.now, charlie.id);

    expect(brief((await list(h)).body)).toEqual([]);
    // The banned player sees themselves unranked, like everyone else does.
    expect((await list(h, "victories", alpha)).body.me?.rank).toBeNull();

    // Bravo's ban runs out; the cache is past, and they are back.
    h.clock.now += 61_000;
    expect(brief((await list(h)).body)).toEqual([[1, "Bravo", 1, 0, 0]]);
  });

  it("cuts the list at the top 100 and still ranks the caller beyond it", async () => {
    const last = await signIn(h, "Zed");
    round(h, last, "overthrow");
    const insert = h.db.prepare(
      `INSERT INTO accounts (id, public_id, name, tag, created_at) VALUES (?, ?, ?, ?, ?)`,
    );
    const stats = h.db.prepare(
      `INSERT INTO stats (account_id, thrones_taken, rounds_held, hegemon_rounds, longest_reign,
         games_played, updated_at)
       VALUES (?, ?, 0, 0, 0, 1, ?)`,
    );
    for (let i = 0; i < LEADERBOARD_SIZE + 4; i++) {
      const id = `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`;
      insert.run(id, `pub${i}`, `Player${i}`, "0000", h.clock.now);
      // Everyone outranks Zed: two thrones taken each.
      stats.run(id, 2, h.clock.now);
    }

    const { body } = await list(h, "victories", last);
    expect(body.entries).toHaveLength(LEADERBOARD_SIZE);
    expect(body.entries.every((e) => e.rank === 1)).toBe(true);
    expect(body.me).toMatchObject({ rank: LEADERBOARD_SIZE + 5, victories: 1 });
    expect(body.entries.map((e) => e.publicId)).not.toContain(
      body.me?.publicId,
    );
  });

  it("holds the top list for a minute, and the own row live", async () => {
    const alpha = await signIn(h, "Alpha");
    const first = (await list(h, "victories", alpha)).body;
    expect(first.entries).toEqual([]);
    expect(first.me?.rank).toBeNull();

    round(h, alpha, "overthrow");
    h.clock.now += LEADERBOARD_CACHE_MS - 1000;
    const cached = (await list(h, "victories", alpha)).body;
    expect(cached.entries).toEqual([]);
    expect(cached.generatedAt).toBe(first.generatedAt);
    expect(cached.me).toMatchObject({ rank: 1, victories: 1 });

    h.clock.now += 1000;
    const fresh = (await list(h, "victories", alpha)).body;
    expect(brief(fresh)).toEqual([[1, "Alpha", 1, 0, 0]]);
    expect(fresh.generatedAt).toBe(h.clock.now);
  });
});
