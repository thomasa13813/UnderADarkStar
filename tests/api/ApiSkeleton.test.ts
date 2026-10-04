// @vitest-environment node
import fs from "fs";
import http from "http";
import { importJWK, jwtVerify } from "jose";
import type { AddressInfo } from "net";
import { DatabaseSync } from "node:sqlite";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../../src/api/App";
import {
  allowedOrigin,
  ApiConfig,
  apiConfigFromEnv,
  issuerFor,
} from "../../src/api/Config";
import {
  migrate,
  MIGRATIONS,
  openDatabase,
  tableNames,
} from "../../src/api/Db";
import {
  jwksDocument,
  loadOrCreateSigningKey,
  SIGNING_KEY_FILE,
  signToken,
} from "../../src/api/Keys";
import { TokenPayloadSchema } from "../../src/core/ApiSchemas";
import { uuidToBase64url } from "../../src/core/Base64";
import { GameEnv } from "../../src/core/configuration/Config";

// Under a Dark Star, accounts step B1 (docs/DarkStar-Accounts.md §12): the
// API skeleton. Its config reads the environment the way the game server
// does; the database opens and migrates idempotently; the signing key is
// created once and served as a JWKS the game server's checker accepts; the
// health check, the cluster-list 404 the client reads as "reachable", and
// CORS for the page.

const DEV_ENV = {
  GAME_ENV: "dev",
  DOMAIN: "localhost",
  API_KEY: "test-key",
};

describe("api config", () => {
  it("reads the environment with dev defaults", () => {
    const config = apiConfigFromEnv(DEV_ENV);
    expect(config).toEqual({
      env: GameEnv.Dev,
      port: 8787,
      dataDir: ".data",
      domain: "localhost",
      apiKey: "test-key",
    });
    expect(issuerFor(config)).toBe("http://localhost:8787");
  });

  it("defaults production to /data and the api subdomain, and refuses gaps", () => {
    const config = apiConfigFromEnv({
      GAME_ENV: "prod",
      DOMAIN: "example.com",
      API_KEY: "k",
      API_PORT: "9000",
    });
    expect(config.dataDir).toBe("/data");
    expect(config.port).toBe(9000);
    expect(issuerFor(config)).toBe("https://api.example.com");
    expect(() => apiConfigFromEnv({ GAME_ENV: "dev", API_KEY: "k" })).toThrow(
      /DOMAIN/,
    );
    expect(() =>
      apiConfigFromEnv({ GAME_ENV: "dev", DOMAIN: "localhost" }),
    ).toThrow(/API_KEY/);
    expect(() =>
      apiConfigFromEnv({ ...DEV_ENV, API_PORT: "not-a-port" }),
    ).toThrow(/API_PORT/);
  });

  it("allows the page's origin and nothing else", () => {
    const dev = apiConfigFromEnv(DEV_ENV);
    expect(allowedOrigin(dev, "http://localhost:9000")).toBe(true);
    expect(allowedOrigin(dev, "http://127.0.0.1:3000")).toBe(true);
    expect(allowedOrigin(dev, "https://evil.example")).toBe(false);
    const prod = apiConfigFromEnv({
      GAME_ENV: "prod",
      DOMAIN: "example.com",
      API_KEY: "k",
    });
    expect(allowedOrigin(prod, "https://example.com")).toBe(true);
    expect(allowedOrigin(prod, "https://www.example.com")).toBe(true);
    expect(allowedOrigin(prod, "http://localhost:9000")).toBe(false);
    expect(allowedOrigin(prod, "https://example.com.evil")).toBe(false);
  });
});

describe("api database", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkstar-api-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates the file, applies every migration once, and is idempotent", () => {
    const first = openDatabase(dir);
    expect(tableNames(first)).toEqual([
      "accounts",
      "identities",
      "round_players",
      "rounds",
      "schema_migrations",
      "sessions",
      "stats",
    ]);
    expect(migrate(first)).toEqual([]);
    first.close();

    const again = openDatabase(dir);
    const applied = again
      .prepare("SELECT id, name FROM schema_migrations ORDER BY id")
      .all();
    expect(applied).toEqual(MIGRATIONS.map(({ id, name }) => ({ id, name })));
    again.close();
  });

  it("enforces the identity -> account link", () => {
    const db = openDatabase(dir);
    expect(() =>
      db
        .prepare(
          "INSERT INTO identities (provider, provider_user_id, account_id, created_at) VALUES ('dev', 'x', 'missing', 0)",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
    db.close();
  });
});

describe("api signing key", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkstar-api-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("is generated once and reloaded with the same id", async () => {
    const a = await loadOrCreateSigningKey(dir);
    expect(fs.existsSync(path.join(dir, SIGNING_KEY_FILE))).toBe(true);
    const b = await loadOrCreateSigningKey(dir);
    expect(b.kid).toBe(a.kid);
    expect(b.publicJwk.x).toBe(a.publicJwk.x);
    // The served key is public only.
    expect("d" in b.publicJwk).toBe(false);
    expect(jwksDocument(b).keys[0]).toMatchObject({
      kty: "OKP",
      crv: "Ed25519",
      alg: "EdDSA",
      use: "sig",
      kid: a.kid,
    });
  });

  it("signs a token the game server's check accepts", async () => {
    const key = await loadOrCreateSigningKey(dir);
    const accountID = "123e4567-e89b-12d3-a456-426614174000";
    const token = await signToken(
      key,
      { sub: uuidToBase64url(accountID), provider: "dev" },
      {
        issuer: "http://localhost:8787",
        audience: "localhost",
        ttlSeconds: 900,
      },
    );
    // What jwt.ts does: the JWKS key, EdDSA, issuer and audience pinned.
    const served = jwksDocument(key).keys[0];
    const publicKey = await importJWK(served, "EdDSA");
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ["EdDSA"],
      issuer: "http://localhost:8787",
      audience: "localhost",
    });
    const parsed = TokenPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.sub).toBe(accountID);
    expect(parsed.data?.provider).toBe("dev");
    expect(parsed.data!.exp - parsed.data!.iat).toBe(900);
  });
});

describe("api app", () => {
  let dir: string;
  let server: http.Server;
  let base: string;
  let config: ApiConfig;
  let db: DatabaseSync;
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkstar-api-"));
    config = apiConfigFromEnv({ ...DEV_ENV, DATA_DIR: dir });
    db = openDatabase(dir);
    const key = await loadOrCreateSigningKey(dir);
    server = http.createServer(createApiApp({ config, db, key, log }));
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    // Windows refuses to delete an open database file.
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("answers the health check", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: "ok" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("serves the JWKS in the shape ServerEnv.jwkPublicKey requires", async () => {
    const res = await fetch(`${base}/.well-known/jwks.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age");
    const body = (await res.json()) as { keys: Record<string, string>[] };
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]).toMatchObject({
      alg: "EdDSA",
      crv: "Ed25519",
      kty: "OKP",
    });
    expect(typeof body.keys[0].x).toBe("string");
  });

  it("tells the client there is no cluster list, with a 404 it reads as reachable", async () => {
    const res = await fetch(`${base}/cluster.json?site=localhost%3A9000`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("answers unknown routes with a JSON 404", async () => {
    const res = await fetch(`${base}/users/@me`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("grants CORS to the page and preflights, and withholds it from strangers", async () => {
    const ok = await fetch(`${base}/health`, {
      headers: { origin: "http://localhost:9000" },
    });
    expect(ok.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:9000",
    );
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");

    const preflight = await fetch(`${base}/auth/refresh`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:9000",
        "access-control-request-method": "POST",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );

    const stranger = await fetch(`${base}/health`, {
      headers: { origin: "https://evil.example" },
    });
    expect(stranger.headers.get("access-control-allow-origin")).toBeNull();
  });
});
