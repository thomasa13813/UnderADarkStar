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
import { RECORD_RETENTION_MS, RecordStore } from "../../src/api/Records";
import { hegemonRun, rebuildStats, statsFor } from "../../src/api/Results";
import { REFRESH_COOKIE } from "../../src/api/Sessions";
import { UserMeResponseSchema } from "../../src/core/ApiSchemas";
import { GameType } from "../../src/core/game/Game";
import {
  GameRecord,
  GameRecordSchema,
  PlayerRecord,
  RecordThrone,
  Winner,
} from "../../src/core/Schemas";
import { testGameConfig } from "../util/Wire";

// Under a Dark Star, accounts step B4 (docs/DarkStar-Accounts.md §5.3–§5.5,
// §12): the results ingest behind POST /game/:id. Records are posted the way
// the game server posts them; the rounds, round_players and stats tables and
// the numbers on /users/@me are read back.

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
  dir: string;
  db: DatabaseSync;
  clock: { now: number };
  records: RecordStore;
  log: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  close(): Promise<void>;
}

async function startApi(): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkstar-ingest-"));
  const config = apiConfigFromEnv({ ...DEV_ENV, DATA_DIR: dir });
  const db = openDatabase(dir);
  const key = await loadOrCreateSigningKey(dir);
  const clock = { now: Date.UTC(2026, 9, 11, 12, 0, 0) };
  const records = new RecordStore(dir);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const server = http.createServer(
    createApiApp({ config, db, key, log, records, now: () => clock.now }),
  );
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    dir,
    db,
    clock,
    records,
    log,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// A signed-in account through the dev provider: its ID (the persistentID
// the game server would archive) and a token for /users/@me.
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
  const cookie = pair.slice(REFRESH_COOKIE.length + 1);
  const refreshed = await fetch(`${h.base}/auth/refresh`, {
    method: "POST",
    headers: { cookie: `${REFRESH_COOKIE}=${cookie}` },
  });
  expect(refreshed.status).toBe(200);
  const { jwt } = (await refreshed.json()) as { jwt: string };
  const row = h.db
    .prepare("SELECT id FROM accounts WHERE name = ?")
    .get(name) as { id: string };
  return { id: row.id, name, jwt };
}

async function me(h: Harness, account: Account) {
  const res = await fetch(`${h.base}/users/@me`, {
    headers: { authorization: `Bearer ${account.jwt}` },
  });
  expect(res.status).toBe(200);
  return UserMeResponseSchema.parse(await res.json()).player.record!;
}

interface PlayerSpec {
  clientID: string;
  // An account ID, a guest's browser UUID, or nothing for a bot-like
  // placeholder (the game server writes "" when the client is gone).
  persistentID?: string | null;
  verified?: boolean;
  isHegemon?: boolean;
  username?: string;
}

function player(spec: PlayerSpec): PlayerRecord {
  return {
    clientID: spec.clientID,
    username: spec.username ?? `Player_${spec.clientID}`,
    clanTag: null,
    persistentID: spec.persistentID === undefined ? null : spec.persistentID,
    stats: {},
    verified: spec.verified,
    isHegemon: spec.isHegemon,
  };
}

interface RecordSpec {
  gameID: string;
  gameType?: GameType;
  players: PlayerSpec[];
  winner: Winner;
  throne?: RecordThrone | null;
  reports?: boolean;
  turns?: number;
}

const THRONE: RecordThrone = {
  throneID: "throne-01",
  name: "Vega",
  type: "ffa",
  reignBefore: 0,
};

function record(spec: RecordSpec): GameRecord {
  const start = Date.UTC(2026, 9, 11, 11, 0, 0);
  const end = start + 20 * 60 * 1000;
  const players = spec.players.map(player);
  return {
    version: "v0.0.2",
    gitCommit: "DEV",
    subdomain: "",
    domain: "localhost",
    info: {
      gameID: spec.gameID,
      lobbyCreatedAt: start - 60_000,
      lobbyFillTime: 60,
      config: testGameConfig({
        gameType: spec.gameType ?? GameType.Public,
        hegemon: { enabled: true },
      }),
      players,
      start,
      end,
      duration: 1200,
      num_turns: spec.turns ?? 10,
      winner: spec.winner,
      throne: spec.throne === null ? undefined : (spec.throne ?? THRONE),
      reports: spec.reports
        ? [
            {
              reportedBy: players[0].clientID,
              reported: players[1].clientID,
              reason: "botting",
            },
          ]
        : undefined,
    },
    turns: Array.from({ length: spec.turns ?? 10 }, (_, i) => ({
      turnNumber: i,
      intents: [],
      hash: i,
    })),
  };
}

function post(
  h: Harness,
  rec: GameRecord,
  apiKey: string | null = "shared-key",
  id: string = rec.info.gameID,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (apiKey !== null) headers["x-api-key"] = apiKey;
  return fetch(`${h.base}/game/${id}`, {
    method: "POST",
    headers,
    body: JSON.stringify(rec),
  });
}

function round(h: Harness, gameID: string) {
  return h.db.prepare("SELECT * FROM rounds WHERE game_id = ?").get(gameID) as
    | Record<string, unknown>
    | undefined;
}

function roundPlayers(h: Harness, gameID: string) {
  return h.db
    .prepare(
      "SELECT account_id, was_hegemon, won FROM round_players WHERE game_id = ? ORDER BY account_id",
    )
    .all(gameID) as { account_id: string; was_hegemon: number; won: number }[];
}

const GUEST = "7f3a6e52-0c1d-4a2b-9e8f-1234567890ab";

describe("POST /game/:id", () => {
  let h: Harness;
  let ada: Account;
  let bob: Account;
  beforeEach(async () => {
    h = await startApi();
    ada = await signIn(h, "Ada");
    bob = await signIn(h, "Bob");
  });
  afterEach(async () => {
    await h.close();
  });

  it("refuses a missing key, a bad game ID, a malformed record and a mismatched ID", async () => {
    const rec = record({
      gameID: "GAMEAAAA",
      players: [{ clientID: "aaaaaaaa" }],
      winner: undefined,
    });
    expect((await post(h, rec, null)).status).toBe(401);
    expect((await post(h, rec, "wrong")).status).toBe(401);
    expect((await post(h, rec, "shared-key", "not a game id")).status).toBe(
      400,
    );
    expect((await post(h, rec, "shared-key", "GAMEBBBB")).status).toBe(400);
    const garbage = await fetch(`${h.base}/game/GAMEAAAA`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "shared-key",
      },
      body: JSON.stringify({ info: { gameID: "GAMEAAAA" } }),
    });
    expect(garbage.status).toBe(400);
    expect(h.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("GAMEAAAA"),
    );
    expect(round(h, "GAMEAAAA")).toBeUndefined();
    expect(h.records.has("GAMEAAAA")).toBe(false);
  });

  it("records a challenger overthrowing a signed-in Hegemon (§5.4)", async () => {
    const res = await post(
      h,
      record({
        gameID: "GAME0001",
        throne: { ...THRONE, reignBefore: 2 },
        players: [
          {
            clientID: "bobbbbbb",
            persistentID: bob.id,
            verified: true,
            isHegemon: true,
          },
          { clientID: "adaaaaaa", persistentID: ada.id, verified: true },
          { clientID: "guestttt", persistentID: GUEST, verified: false },
        ],
        winner: ["player", "adaaaaaa"],
      }),
    );
    expect(res.status).toBe(201);
    expect(round(h, "GAME0001")).toMatchObject({
      throne_id: "throne-01",
      throne_name: "Vega",
      throne_type: "ffa",
      map: "Event Horizon",
      humans: 3,
      outcome: "overthrown",
      hegemon_account: bob.id,
      winner_account: ada.id,
      reign_after: 1,
      git_commit: "DEV",
    });
    expect(roundPlayers(h, "GAME0001")).toEqual(
      [
        { account_id: ada.id, was_hegemon: 0, won: 1 },
        { account_id: bob.id, was_hegemon: 1, won: 0 },
      ].sort((a, b) => a.account_id.localeCompare(b.account_id)),
    );
    // Ada's victory; Bob's round on the throne (his first on record).
    expect(await me(h, ada)).toEqual({
      victories: 1,
      reigns: 0,
      longestReign: 0,
      gamesPlayed: 1,
    });
    expect(await me(h, bob)).toEqual({
      victories: 0,
      reigns: 1,
      longestReign: 1,
      gamesPlayed: 1,
    });
    expect(h.log.info).toHaveBeenCalledWith(
      expect.stringContaining("round recorded: GAME0001"),
    );
  });

  it("extends a reign on a timer win, and a later loss leaves the longest reign standing", async () => {
    // Ada takes the throne, then holds it twice: three victories, two rounds
    // as Hegemon in one run.
    await post(
      h,
      record({
        gameID: "GAME0001",
        players: [
          { clientID: "adaaaaaa", persistentID: ada.id, verified: true },
          {
            clientID: "bobbbbbb",
            persistentID: bob.id,
            verified: true,
            isHegemon: true,
          },
        ],
        winner: ["player", "adaaaaaa"],
      }),
    );
    for (const [gameID, reignBefore] of [
      ["GAME0002", 1],
      ["GAME0003", 2],
    ] as const) {
      const res = await post(
        h,
        record({
          gameID,
          throne: { ...THRONE, reignBefore },
          players: [
            {
              clientID: "adaaaaaa",
              persistentID: ada.id,
              verified: true,
              isHegemon: true,
            },
            { clientID: "bobbbbbb", persistentID: bob.id, verified: true },
          ],
          winner: ["player", "adaaaaaa"],
        }),
      );
      expect(res.status).toBe(201);
    }
    expect(round(h, "GAME0003")).toMatchObject({
      outcome: "timer",
      reign_after: 3,
    });
    expect(await me(h, ada)).toEqual({
      victories: 3,
      reigns: 2,
      longestReign: 2,
      gamesPlayed: 3,
    });
    // Bob overthrows her: the lost round was Ada's third as Hegemon, so her
    // reign numbers reach 3 and the run ends there.
    await post(
      h,
      record({
        gameID: "GAME0004",
        throne: { ...THRONE, reignBefore: 3 },
        players: [
          {
            clientID: "adaaaaaa",
            persistentID: ada.id,
            verified: true,
            isHegemon: true,
          },
          { clientID: "bobbbbbb", persistentID: bob.id, verified: true },
        ],
        winner: ["player", "bobbbbbb"],
      }),
    );
    expect(await me(h, ada)).toEqual({
      victories: 3,
      reigns: 3,
      longestReign: 3,
      gamesPlayed: 4,
    });
    // Bob: the victory, and his one round seated back in GAME0001.
    expect(await me(h, bob)).toEqual({
      victories: 1,
      reigns: 1,
      longestReign: 1,
      gamesPlayed: 4,
    });
  });

  it("three rounds with a guest winner and a void round give the right numbers (B4 done-when)", async () => {
    // Round 1: Ada (signed in) overthrows the AI Hegemon.
    expect(
      (
        await post(
          h,
          record({
            gameID: "GAME0001",
            players: [
              { clientID: "adaaaaaa", persistentID: ada.id, verified: true },
              { clientID: "guestttt", persistentID: GUEST, verified: false },
            ],
            winner: ["player", "adaaaaaa"],
          }),
        )
      ).status,
    ).toBe(201);
    // Round 2: a guest overthrows Ada. Nothing is credited; the row keeps
    // the round and Ada's games played moves.
    expect(
      (
        await post(
          h,
          record({
            gameID: "GAME0002",
            throne: { ...THRONE, reignBefore: 1 },
            players: [
              {
                clientID: "adaaaaaa",
                persistentID: ada.id,
                verified: true,
                isHegemon: true,
              },
              { clientID: "guestttt", persistentID: GUEST, verified: false },
            ],
            winner: ["player", "guestttt"],
          }),
        )
      ).status,
    ).toBe(201);
    expect(round(h, "GAME0002")).toMatchObject({
      outcome: "overthrown",
      hegemon_account: ada.id,
      winner_account: null,
      reign_after: 1,
    });
    expect(roundPlayers(h, "GAME0002")).toEqual([
      { account_id: ada.id, was_hegemon: 1, won: 0 },
    ]);
    // Round 3: void (no winner at all) with the guest seated.
    expect(
      (
        await post(
          h,
          record({
            gameID: "GAME0003",
            throne: { ...THRONE, reignBefore: 1 },
            players: [
              {
                clientID: "guestttt",
                persistentID: GUEST,
                verified: false,
                isHegemon: true,
              },
              { clientID: "adaaaaaa", persistentID: ada.id, verified: true },
            ],
            winner: undefined,
          }),
        )
      ).status,
    ).toBe(201);
    expect(round(h, "GAME0003")).toMatchObject({
      outcome: "void",
      hegemon_account: null,
      winner_account: null,
      reign_after: 0,
    });
    // Ada's victory in round 1 and her round on the throne in round 2.
    expect(await me(h, ada)).toEqual({
      victories: 1,
      reigns: 1,
      longestReign: 1,
      gamesPlayed: 3,
    });
    expect(await me(h, bob)).toMatchObject({ victories: 0, gamesPlayed: 0 });
  });

  it("records an AI win as a round nobody is credited for", async () => {
    const res = await post(
      h,
      record({
        gameID: "GAME0001",
        players: [
          { clientID: "adaaaaaa", persistentID: ada.id, verified: true },
        ],
        winner: ["nation", "Some Lord"],
      }),
    );
    expect(res.status).toBe(201);
    expect(round(h, "GAME0001")).toMatchObject({
      outcome: "ai",
      winner_account: null,
      reign_after: 0,
    });
    expect(await me(h, ada)).toMatchObject({ victories: 0, gamesPlayed: 1 });
  });

  it("credits nothing to a verified flag without an account behind it", async () => {
    // A token for an account that has since been deleted, or a forged flag:
    // the persistentID is not a live account, so it is treated as a guest.
    const res = await post(
      h,
      record({
        gameID: "GAME0001",
        players: [
          { clientID: "ghostttt", persistentID: GUEST, verified: true },
          {
            clientID: "adaaaaaa",
            persistentID: ada.id,
            verified: true,
            isHegemon: true,
          },
        ],
        winner: ["player", "ghostttt"],
      }),
    );
    expect(res.status).toBe(201);
    expect(round(h, "GAME0001")).toMatchObject({
      outcome: "overthrown",
      winner_account: null,
      hegemon_account: ada.id,
    });
    expect(roundPlayers(h, "GAME0001")).toHaveLength(1);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM stats").get()).toEqual({
      n: 1,
    });
  });

  it("is idempotent: a repeated post changes nothing", async () => {
    const rec = record({
      gameID: "GAME0001",
      players: [
        { clientID: "adaaaaaa", persistentID: ada.id, verified: true },
        {
          clientID: "bobbbbbb",
          persistentID: bob.id,
          verified: true,
          isHegemon: true,
        },
      ],
      winner: ["player", "adaaaaaa"],
    });
    expect((await post(h, rec)).status).toBe(201);
    const again = await post(h, rec);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    expect(await me(h, ada)).toMatchObject({ victories: 1, gamesPlayed: 1 });
    expect(
      h.db.prepare("SELECT COUNT(*) AS n FROM round_players").get(),
    ).toEqual({ n: 2 });
  });

  it("keeps a private or solo record without recording a round", async () => {
    for (const [gameID, gameType] of [
      ["GAMEPRIV", GameType.Private],
      ["GAMESOLO", GameType.Singleplayer],
    ] as const) {
      const res = await post(
        h,
        record({
          gameID,
          gameType,
          players: [
            { clientID: "adaaaaaa", persistentID: ada.id, verified: true },
          ],
          winner: ["player", "adaaaaaa"],
        }),
      );
      expect(res.status).toBe(202);
      expect(round(h, gameID)).toBeUndefined();
      expect(h.records.has(gameID)).toBe(true);
    }
    // A public game that is not a throne round (none exist at launch, but
    // the record shape allows it) is kept and not recorded either.
    const res = await post(
      h,
      record({
        gameID: "GAMEOPEN",
        throne: null,
        players: [
          { clientID: "adaaaaaa", persistentID: ada.id, verified: true },
        ],
        winner: ["player", "adaaaaaa"],
      }),
    );
    expect(res.status).toBe(202);
    expect(round(h, "GAMEOPEN")).toBeUndefined();
    expect(await me(h, ada)).toMatchObject({ victories: 0, gamesPlayed: 0 });
  });

  it("accepts a record far larger than the API's usual body limit", async () => {
    const res = await post(
      h,
      record({
        gameID: "GAMEBIGG",
        players: [
          { clientID: "adaaaaaa", persistentID: ada.id, verified: true },
        ],
        winner: ["player", "adaaaaaa"],
        turns: 80_000, // about 3 MB of JSON
      }),
    );
    expect(res.status).toBe(201);
    expect(h.records.has("GAMEBIGG")).toBe(true);
  });
});

describe("GET /game/:id", () => {
  let h: Harness;
  let ada: Account;
  beforeEach(async () => {
    h = await startApi();
    ada = await signIn(h, "Ada");
  });
  afterEach(async () => {
    await h.close();
  });

  it("serves the kept record with persistentIDs and reports scrubbed", async () => {
    const rec = record({
      gameID: "GAME0001",
      players: [
        { clientID: "adaaaaaa", persistentID: ada.id, verified: true },
        {
          clientID: "guestttt",
          persistentID: GUEST,
          verified: false,
          isHegemon: true,
        },
      ],
      winner: ["player", "adaaaaaa"],
      reports: true,
    });
    expect((await post(h, rec)).status).toBe(201);
    const res = await fetch(`${h.base}/game/GAME0001`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    const served = GameRecordSchema.parse(await res.json());
    expect(served.info.players.map((p) => p.persistentID)).toEqual([
      null,
      null,
    ]);
    expect(served.info.players.map((p) => p.verified)).toEqual([true, false]);
    expect(served.info.reports).toBeUndefined();
    expect(served.info.throne).toEqual(THRONE);
    expect(served.turns).toHaveLength(10);
    expect(served.info.winner).toEqual(["player", "adaaaaaa"]);
  });

  it("answers 404 for an unknown game, a bad ID, and a pruned record", async () => {
    expect((await fetch(`${h.base}/game/GAME0009`)).status).toBe(404);
    expect((await fetch(`${h.base}/game/..%2Fdarkstar.sqlite`)).status).toBe(
      404,
    );
    const rec = record({
      gameID: "GAME0001",
      players: [{ clientID: "adaaaaaa", persistentID: ada.id, verified: true }],
      winner: ["player", "adaaaaaa"],
    });
    expect((await post(h, rec)).status).toBe(201);
    expect((await fetch(`${h.base}/game/GAME0001`)).status).toBe(200);
    // Younger than the retention: kept. Older: gone. The round row stays.
    expect(h.records.prune(Date.now() + RECORD_RETENTION_MS - 60_000)).toBe(0);
    expect(h.records.prune(Date.now() + RECORD_RETENTION_MS + 60_000)).toBe(1);
    expect((await fetch(`${h.base}/game/GAME0001`)).status).toBe(404);
    expect(round(h, "GAME0001")).toBeDefined();
  });
});

describe("rebuildStats", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startApi();
  });
  afterEach(async () => {
    await h.close();
  });

  it("recomputes the cache from the rounds, and drops a deleted account", async () => {
    const ada = await signIn(h, "Ada");
    const bob = await signIn(h, "Bob");
    const rounds: [string, number, string, boolean][] = [
      // game, reignBefore, winner, ada is hegemon
      ["GAME0001", 0, "adaaaaaa", false], // Ada takes the throne: 1
      ["GAME0002", 1, "adaaaaaa", true], // holds: 2
      ["GAME0003", 2, "bobbbbbb", true], // Bob takes it: 1
      ["GAME0004", 1, "bobbbbbb", false], // Bob holds: 2
    ];
    for (const [gameID, reignBefore, winner, adaHegemon] of rounds) {
      const res = await post(
        h,
        record({
          gameID,
          throne: { ...THRONE, reignBefore },
          players: [
            {
              clientID: "adaaaaaa",
              persistentID: ada.id,
              verified: true,
              isHegemon: adaHegemon,
            },
            {
              clientID: "bobbbbbb",
              persistentID: bob.id,
              verified: true,
              isHegemon: !adaHegemon && gameID !== "GAME0001",
            },
          ],
          winner: ["player", winner],
        }),
      );
      expect(res.status).toBe(201);
    }
    const before = {
      ada: statsFor(h.db, ada.id),
      bob: statsFor(h.db, bob.id),
    };
    // Ada sat for GAME0002 and GAME0003 (one run of two); Bob for GAME0004
    // only: the throne he took in GAME0003 counts as a victory, not a reign.
    expect(before.ada).toEqual({
      thronesTaken: 1,
      roundsHeld: 1,
      reigns: 2,
      longestReign: 2,
      gamesPlayed: 4,
    });
    expect(before.bob).toEqual({
      thronesTaken: 1,
      roundsHeld: 1,
      reigns: 1,
      longestReign: 1,
      gamesPlayed: 4,
    });

    h.db.exec(
      "UPDATE stats SET thrones_taken = 99, hegemon_rounds = 99, longest_reign = 99",
    );
    h.db.exec("UPDATE rounds SET hegemon_run = 7");
    expect(rebuildStats(h.db, h.clock.now)).toBe(2);
    expect(
      h.db
        .prepare("SELECT game_id, hegemon_run FROM rounds ORDER BY game_id")
        .all(),
    ).toEqual([
      { game_id: "GAME0001", hegemon_run: 0 },
      { game_id: "GAME0002", hegemon_run: 1 },
      { game_id: "GAME0003", hegemon_run: 2 },
      { game_id: "GAME0004", hegemon_run: 1 },
    ]);
    expect(statsFor(h.db, ada.id)).toEqual(before.ada);
    expect(statsFor(h.db, bob.id)).toEqual(before.bob);

    // Bob's account is deleted (A17): the rebuild leaves him off the board,
    // his rounds stay as history.
    h.db
      .prepare("UPDATE accounts SET deleted_at = ? WHERE id = ?")
      .run(h.clock.now, bob.id);
    h.db.prepare("DELETE FROM stats WHERE account_id = ?").run(bob.id);
    expect(rebuildStats(h.db, h.clock.now)).toBe(1);
    expect(statsFor(h.db, bob.id)).toEqual({
      thronesTaken: 0,
      roundsHeld: 0,
      reigns: 0,
      longestReign: 0,
      gamesPlayed: 0,
    });
    expect(statsFor(h.db, ada.id)).toEqual(before.ada);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM rounds").get()).toEqual({
      n: 4,
    });
  });
});

// The seated Hegemon's run on a throne (Accounts §5.4): the rule the ingest
// and the rebuild share.
describe("hegemonRun", () => {
  const previous = (
    hegemon: string | null,
    winner: string | null,
    run = 1,
  ) => ({
    hegemonAccount: hegemon,
    winnerAccount: winner,
    hegemonRun: run,
  });

  it("is nothing for a guest or AI Hegemon", () => {
    expect(hegemonRun(null, 0, undefined)).toBe(0);
    expect(hegemonRun(null, 3, previous("ada", "ada", 3))).toBe(0);
  });

  it("starts at one on a throne with no history, or after someone else", () => {
    expect(hegemonRun("ada", 0, undefined)).toBe(1);
    expect(hegemonRun("ada", 1, undefined)).toBe(1);
    expect(hegemonRun("ada", 1, previous(null, "ada"))).toBe(1);
    expect(hegemonRun("ada", 1, previous("bob", "ada"))).toBe(1);
  });

  it("continues when the same holder won the throne's last round and kept the seat", () => {
    expect(hegemonRun("ada", 1, previous("ada", "ada", 1))).toBe(2);
    expect(hegemonRun("ada", 4, previous("ada", "ada", 3))).toBe(4);
  });

  it("starts afresh when the holder stepped down and claimed the seat again", () => {
    // reignBefore 0: the registry seated a claimant, not the heir.
    expect(hegemonRun("ada", 0, previous("ada", "ada", 2))).toBe(1);
  });

  it("starts afresh when the holder lost the throne's last round", () => {
    // Ada lost to Bob, who stepped down; Ada claimed the open seat.
    expect(hegemonRun("ada", 0, previous("ada", "bob", 2))).toBe(1);
  });

  it("continues on the first two conditions alone for a round without reign_before", () => {
    expect(hegemonRun("ada", null, previous("ada", "ada", 2))).toBe(3);
    expect(hegemonRun("ada", null, previous("ada", "bob", 2))).toBe(1);
  });
});
