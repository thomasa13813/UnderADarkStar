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
import { Difficulty, GameMapType } from "../../src/core/game/Game";
import {
  MAX_SOLO_PRESETS,
  SoloPresetsResponseSchema,
} from "../../src/core/SoloPresets";

// Under a Dark Star, saved solo setups (docs/DarkStar-Accounts.md §12.11):
// GET, PUT and DELETE /users/@me/solo-presets. Private to the account, at
// most MAX_SOLO_PRESETS, one per name in any case, erased with the account.

const SITE = "http://localhost:9000";

interface Harness {
  base: string;
  db: DatabaseSync;
  close(): Promise<void>;
}

let h: Harness;

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkstar-presets-"));
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

// A dev sign-in: the refresh cookie and a token.
async function signIn(name: string): Promise<{ cookie: string; jwt: string }> {
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
  const cookie = refreshed.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith(`${REFRESH_COOKIE}=`))!;
  return { cookie, jwt: ((await refreshed.json()) as { jwt: string }).jwt };
}

function call(
  jwt: string | null,
  method: "GET" | "PUT" | "DELETE",
  suffix = "",
  body?: unknown,
) {
  return fetch(`${h.base}/users/@me/solo-presets${suffix}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(jwt === null ? {} : { authorization: `Bearer ${jwt}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function presets(res: Response) {
  expect(res.status).toBe(200);
  return SoloPresetsResponseSchema.parse(await res.json()).presets;
}

const QUICK = {
  map: GameMapType.EventHorizon,
  difficulty: Difficulty.Hard,
  bots: 120,
  piracy: false,
  disabledUnits: ["Warship"],
};

describe("/users/@me/solo-presets", () => {
  it("saves, lists by name and loads back what was saved", async () => {
    const { jwt } = await signIn("Tom");
    expect(await presets(await call(jwt, "GET"))).toEqual([]);

    await presets(await call(jwt, "PUT", "", { name: "Zeta", settings: {} }));
    const list = await presets(
      await call(jwt, "PUT", "", { name: "  Quick   game ", settings: QUICK }),
    );
    expect(list.map((p) => p.name)).toEqual(["Quick game", "Zeta"]);
    expect(list[0].settings).toEqual(QUICK);
    expect(await presets(await call(jwt, "GET"))).toEqual(list);
  });

  it("replaces a setup saved again under its name, in any case", async () => {
    const { jwt } = await signIn("Tom");
    const [first] = await presets(
      await call(jwt, "PUT", "", { name: "Quick", settings: QUICK }),
    );
    const [again] = await presets(
      await call(jwt, "PUT", "", { name: "QUICK", settings: { bots: 5 } }),
    );
    expect(again.id).toBe(first.id);
    expect(again.name).toBe("QUICK");
    expect(again.settings).toEqual({ bots: 5 });
  });

  it("holds at most the limit, but still lets a setup be replaced", async () => {
    const { jwt } = await signIn("Tom");
    for (let i = 0; i < MAX_SOLO_PRESETS; i++) {
      await presets(
        await call(jwt, "PUT", "", { name: `P${i}`, settings: {} }),
      );
    }
    const full = await call(jwt, "PUT", "", { name: "One more", settings: {} });
    expect(full.status).toBe(409);
    expect(
      (await presets(await call(jwt, "PUT", "", { name: "p0", settings: {} })))
        .length,
    ).toBe(MAX_SOLO_PRESETS);
  });

  it("drops values the game does not know instead of refusing the setup", async () => {
    const { jwt } = await signIn("Tom");
    const [saved] = await presets(
      await call(jwt, "PUT", "", {
        name: "Odd",
        settings: { map: "Atlantis", bots: 9000, piracy: true, extra: 1 },
      }),
    );
    expect(saved.settings).toEqual({ piracy: true });
  });

  it("refuses a bad name or settings that are not an object", async () => {
    const { jwt } = await signIn("Tom");
    for (const body of [
      { name: "", settings: {} },
      { name: "   ", settings: {} },
      { name: "x".repeat(33), settings: {} },
      { name: "tab\there", settings: {} },
      { name: 5, settings: {} },
      { name: "Fine", settings: [] },
      { name: "Fine", settings: "map" },
      { name: "Fine" },
    ]) {
      expect(
        (await call(jwt, "PUT", "", body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
    expect(await presets(await call(jwt, "GET"))).toEqual([]);
  });

  it("deletes one setup, and only the owner's", async () => {
    const tom = await signIn("Tom");
    const ann = await signIn("Ann");
    const [mine] = await presets(
      await call(tom.jwt, "PUT", "", { name: "Mine", settings: QUICK }),
    );
    expect((await call(ann.jwt, "DELETE", `/${mine.id}`)).status).toBe(404);
    expect(await presets(await call(ann.jwt, "GET"))).toEqual([]);
    expect(await presets(await call(tom.jwt, "DELETE", `/${mine.id}`))).toEqual(
      [],
    );
    expect((await call(tom.jwt, "DELETE", `/${mine.id}`)).status).toBe(404);
  });

  it("needs a signed-in player", async () => {
    expect((await call(null, "GET")).status).toBe(401);
    expect(
      (await call(null, "PUT", "", { name: "X", settings: {} })).status,
    ).toBe(401);
    expect((await call(null, "DELETE", "/anything")).status).toBe(401);
    expect((await call("not-a-token", "GET")).status).toBe(401);
  });

  it("are erased with the account", async () => {
    const { cookie, jwt } = await signIn("Tom");
    await presets(
      await call(jwt, "PUT", "", { name: "Mine", settings: QUICK }),
    );
    const out = await fetch(`${h.base}/auth/delete`, {
      method: "POST",
      headers: { cookie },
    });
    expect(out.status).toBe(204);
    expect(
      h.db.prepare("SELECT COUNT(*) AS n FROM solo_presets").get(),
    ).toEqual({ n: 0 });
    expect((await call(jwt, "GET")).status).toBe(401);
  });

  it("lists a stored setup whose map has since gone, without the map", async () => {
    const { jwt } = await signIn("Tom");
    const [saved] = await presets(
      await call(jwt, "PUT", "", { name: "Old", settings: QUICK }),
    );
    h.db
      .prepare("UPDATE solo_presets SET settings = ? WHERE id = ?")
      .run(JSON.stringify({ ...QUICK, map: "Retired Map" }), saved.id);
    const [read] = await presets(await call(jwt, "GET"));
    expect(read.settings).toEqual({ ...QUICK, map: undefined });
    expect("map" in read.settings && read.settings.map).toBeFalsy();
  });
});
