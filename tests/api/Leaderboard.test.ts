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
  LeaderboardBoard,
  LeaderboardResponse,
  LeaderboardResponseSchema,
} from "../../src/core/ApiSchemas";
import { GameType } from "../../src/core/game/Game";
import { GameRecord, PlayerRecord } from "../../src/core/Schemas";
import { testGameConfig } from "../util/Wire";

// Under a Dark Star, accounts step B5 (docs/DarkStar-Accounts.md §6, §13):
// GET /leaderboard. The two boards over the stats the ingest writes, their
// order and ties, who is left off (banned, deleted, never won), the caller's
// own row, the top-100 cut, the one-minute cache and the cache headers.

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

// One public throne round, recorded straight into the database: `winner`
// overthrows a guest Hegemon, or, as the seated Hegemon, holds to the timer
// with `reignBefore` rounds already held.
function round(
  h: Harness,
  winner: Account,
  how: "overthrow" | "timer",
  reignBefore = 0,
  others: Account[] = [],
): void {
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
          player("winner", winner.id, true, false),
        ]
      : [
          player("winner", winner.id, true, true),
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
      winner: ["player", "winner"],
      throne: {
        throneID: "throne-01",
        name: "Vega",
        type: "ffa",
        reignBefore,
      },
    },
    turns: [{ turnNumber: 0, intents: [], hash: 0 }],
  };
  const result = ingestRecord(h.db, record, h.clock.now);
  expect(result.kind).toBe("recorded");
}

async function board(
  h: Harness,
  which?: LeaderboardBoard | string,
  account?: Account,
): Promise<{ res: Response; body: LeaderboardResponse }> {
  const url =
    which === undefined
      ? `${h.base}/leaderboard`
      : `${h.base}/leaderboard?board=${which}`;
  const res = await fetch(url, {
    headers:
      account === undefined ? {} : { authorization: `Bearer ${account.jwt}` },
  });
  expect(res.status).toBe(200);
  const body = LeaderboardResponseSchema.parse(await res.json());
  return { res, body };
}

const brief = (b: LeaderboardResponse) =>
  b.entries.map((e) => [
    e.rank,
    e.username.split(".")[0],
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
  it("is empty before any round, and a stranger has no own row", async () => {
    const { res, body } = await board(h);
    expect(body).toEqual({
      board: "reigns",
      generatedAt: h.clock.now,
      entries: [],
      me: null,
    });
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("vary")).toContain("Authorization");
  });

  it("refuses a board it does not have", async () => {
    const res = await fetch(`${h.base}/leaderboard?board=elo`);
    expect(res.status).toBe(400);
  });

  it("ranks the two boards, sharing a rank on a tie", async () => {
    const alpha = await signIn(h, "Alpha");
    const bravo = await signIn(h, "Bravo");
    const charlie = await signIn(h, "Charlie");
    const delta = await signIn(h, "Delta");
    const echo = await signIn(h, "Echo");
    // Alpha: a throne taken, then held twice: reigns 3, longest 3.
    round(h, alpha, "overthrow", 0, [echo]);
    round(h, alpha, "timer", 1);
    round(h, alpha, "timer", 2);
    // Bravo: three thrones taken: reigns 3, longest 1.
    round(h, bravo, "overthrow");
    round(h, bravo, "overthrow");
    round(h, bravo, "overthrow");
    // Charlie: taken, then held once: reigns 2, longest 2.
    round(h, charlie, "overthrow");
    round(h, charlie, "timer", 1);
    // Delta: one throne taken. Echo only played.
    round(h, delta, "overthrow");

    const reigns = (await board(h, "reigns")).body;
    // Alpha and Bravo share the top with three reigns each; the longest
    // reign orders them, and the rank after a shared one skips (1, 1, 3, 4).
    expect(brief(reigns)).toEqual([
      [1, "Alpha", 3, 3],
      [1, "Bravo", 3, 1],
      [3, "Charlie", 2, 2],
      [4, "Delta", 1, 1],
    ]);
    expect(reigns.entries[0]).toMatchObject({
      thronesTaken: 1,
      roundsHeld: 2,
      username: expect.stringMatching(/^Alpha\.\d{4}$/),
    });

    const longest = (await board(h, "longest")).body;
    // Bravo and Delta share the longest reign; reigns order them.
    expect(brief(longest)).toEqual([
      [1, "Alpha", 3, 3],
      [2, "Charlie", 2, 2],
      [3, "Bravo", 3, 1],
      [3, "Delta", 1, 1],
    ]);
  });

  it("gives a signed-in caller their own row, ranked or not", async () => {
    const alpha = await signIn(h, "Alpha");
    const bravo = await signIn(h, "Bravo");
    const echo = await signIn(h, "Echo");
    round(h, alpha, "overthrow", 0, [echo]);
    round(h, bravo, "overthrow");
    round(h, bravo, "timer", 1);

    const mine = await board(h, "reigns", alpha);
    expect(mine.body.me).toMatchObject({ rank: 2, reigns: 1, longestReign: 1 });
    expect(mine.body.me?.publicId).toBe(mine.body.entries[1].publicId);
    expect(mine.res.headers.get("cache-control")).toBe("private, max-age=60");

    // Echo played, never won: not on the board, own row unranked with zeros.
    const theirs = await board(h, "longest", echo);
    expect(theirs.body.entries.map((e) => e.publicId)).not.toContain(
      theirs.body.me?.publicId,
    );
    expect(theirs.body.me).toMatchObject({
      rank: null,
      reigns: 0,
      longestReign: 0,
      thronesTaken: 0,
      roundsHeld: 0,
      username: expect.stringMatching(/^Echo\.\d{4}$/),
    });

    // A token that does not verify is simply anonymous.
    const res = await fetch(`${h.base}/leaderboard`, {
      headers: { authorization: "Bearer not-a-token" },
    });
    expect(LeaderboardResponseSchema.parse(await res.json()).me).toBeNull();
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

    expect(brief((await board(h, "reigns")).body)).toEqual([]);
    // The banned player sees themselves unranked, like everyone else does.
    expect((await board(h, "reigns", alpha)).body.me?.rank).toBeNull();

    // Bravo's ban runs out; the cache is past, and they are back.
    h.clock.now += 61_000;
    expect(brief((await board(h, "reigns")).body)).toEqual([
      [1, "Bravo", 1, 1],
    ]);
  });

  it("cuts the list at the top 100 and still ranks the caller beyond it", async () => {
    const last = await signIn(h, "Zed");
    round(h, last, "overthrow");
    const insert = h.db.prepare(
      `INSERT INTO accounts (id, public_id, name, tag, created_at) VALUES (?, ?, ?, ?, ?)`,
    );
    const stats = h.db.prepare(
      `INSERT INTO stats (account_id, thrones_taken, rounds_held, longest_reign, games_played, updated_at)
       VALUES (?, ?, 0, 1, 1, ?)`,
    );
    for (let i = 0; i < LEADERBOARD_SIZE + 4; i++) {
      const id = `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`;
      insert.run(id, `pub${i}`, `Player${i}`, "0000", h.clock.now);
      // Everyone outranks Zed: two thrones taken each.
      stats.run(id, 2, h.clock.now);
    }

    const { body } = await board(h, "reigns", last);
    expect(body.entries).toHaveLength(LEADERBOARD_SIZE);
    expect(body.entries.every((e) => e.rank === 1)).toBe(true);
    expect(body.me).toMatchObject({ rank: LEADERBOARD_SIZE + 5, reigns: 1 });
    expect(body.entries.map((e) => e.publicId)).not.toContain(
      body.me?.publicId,
    );
  });

  it("holds the top list for a minute, and the own row live", async () => {
    const alpha = await signIn(h, "Alpha");
    const first = (await board(h, "reigns", alpha)).body;
    expect(first.entries).toEqual([]);
    expect(first.me?.rank).toBeNull();

    round(h, alpha, "overthrow");
    h.clock.now += LEADERBOARD_CACHE_MS - 1000;
    const cached = (await board(h, "reigns", alpha)).body;
    expect(cached.entries).toEqual([]);
    expect(cached.generatedAt).toBe(first.generatedAt);
    expect(cached.me).toMatchObject({ rank: 1, reigns: 1 });

    h.clock.now += 1000;
    const fresh = (await board(h, "reigns", alpha)).body;
    expect(brief(fresh)).toEqual([[1, "Alpha", 1, 1]]);
    expect(fresh.generatedAt).toBe(h.clock.now);
  });
});
