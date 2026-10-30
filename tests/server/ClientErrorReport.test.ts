import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_ERROR_LIMITS,
  CLIENT_ERROR_PATH,
  CLIENT_ERROR_RATE_PER_MINUTE,
  CLIENT_ERROR_REPEAT_MS,
  type ClientErrorLog,
  ClientErrorRepeats,
  clientErrorHandler,
  mountClientErrorRoute,
  parseClientErrorReport,
} from "../../src/server/ClientErrorReport";

// Under a Dark Star (docs/DarkStar-Lobbies.md §14.8): error reports from
// players' browsers. A plain-text JSON body is parsed and checked against
// its limits; each distinct error from one client is logged once per window
// as one structured line, with the user agent and nothing about the player;
// every request is answered 204; the route limits each address to ten a
// minute.

const REPORT = {
  kind: "error",
  message: "TypeError: x is undefined",
  stack: "TypeError: x is undefined\n    at a (main.js:1:2)",
  source: "https://cdn.example/main.js:1:2",
  page: "catching_up",
  commit: "abc1234",
};

function reqWith(body: unknown, ip = "203.0.113.7", ua = "TestBrowser/1.0") {
  return {
    body,
    ip,
    get: (name: string) => (name === "user-agent" ? ua : undefined),
  } as any;
}

function resStub() {
  const res = { statusCode: 0, ended: false } as any;
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.end = () => {
    res.ended = true;
    return res;
  };
  return res;
}

describe("parseClientErrorReport", () => {
  it("reads the JSON in a plain-text body, or an already parsed object", () => {
    expect(parseClientErrorReport(JSON.stringify(REPORT))).toEqual(REPORT);
    expect(parseClientErrorReport(REPORT)).toEqual(REPORT);
  });

  it("refuses what is not a report, or too large", () => {
    expect(parseClientErrorReport("not json")).toBeNull();
    expect(parseClientErrorReport({ ...REPORT, page: "settings" })).toBeNull();
    expect(parseClientErrorReport({ ...REPORT, kind: "warning" })).toBeNull();
    expect(
      parseClientErrorReport({
        ...REPORT,
        message: "x".repeat(CLIENT_ERROR_LIMITS.message + 1),
      }),
    ).toBeNull();
    expect(
      parseClientErrorReport("x".repeat(CLIENT_ERROR_LIMITS.body + 1)),
    ).toBeNull();
    expect(parseClientErrorReport(undefined)).toBeNull();
  });
});

describe("the client-error handler", () => {
  it("logs one structured line, with the user agent and no IP", () => {
    const log = { warn: vi.fn<ClientErrorLog["warn"]>() };
    const res = resStub();
    clientErrorHandler(log)(reqWith(JSON.stringify(REPORT)), res, vi.fn());
    expect(res.statusCode).toBe(204);
    expect(log.warn).toHaveBeenCalledTimes(1);
    const [message, meta] = log.warn.mock.calls[0];
    expect(message).toBe("client error");
    const { message: error, ...rest } = REPORT;
    expect(meta).toEqual({ ...rest, error, userAgent: "TestBrowser/1.0" });
    expect(JSON.stringify(meta)).not.toContain("203.0.113");
  });

  it("drops repeats of the same error from one client within the window", () => {
    const log = { warn: vi.fn<ClientErrorLog["warn"]>() };
    let now = 1_000_000;
    const handler = clientErrorHandler(
      log,
      new ClientErrorRepeats(),
      () => now,
    );
    const send = (body: unknown, ip?: string) =>
      handler(reqWith(JSON.stringify(body), ip), resStub(), vi.fn());
    send(REPORT);
    send(REPORT);
    expect(log.warn).toHaveBeenCalledTimes(1);
    // Another error from the same client, or the same from another client.
    send({ ...REPORT, message: "RangeError: y" });
    send(REPORT, "198.51.100.2");
    expect(log.warn).toHaveBeenCalledTimes(3);
    // The window passes.
    now += CLIENT_ERROR_REPEAT_MS;
    send(REPORT);
    expect(log.warn).toHaveBeenCalledTimes(4);
  });

  it("answers 204 to a malformed report and logs nothing", () => {
    const log = { warn: vi.fn<ClientErrorLog["warn"]>() };
    const res = resStub();
    clientErrorHandler(log)(reqWith("{"), res, vi.fn());
    expect(res.statusCode).toBe(204);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("cuts a long user agent", () => {
    const log = { warn: vi.fn<ClientErrorLog["warn"]>() };
    clientErrorHandler(log)(
      reqWith(JSON.stringify(REPORT), undefined, "U".repeat(1_000)),
      resStub(),
      vi.fn(),
    );
    expect(log.warn.mock.calls[0][1].userAgent).toHaveLength(
      CLIENT_ERROR_LIMITS.userAgent,
    );
  });
});

describe("the mounted route", () => {
  let server: http.Server | null = null;
  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  });

  async function start(log: ClientErrorLog) {
    const app = express();
    app.use(express.json());
    mountClientErrorRoute(app, log);
    server = http.createServer(app);
    await new Promise<void>((r) => server!.listen(0, r));
    const { port } = server!.address() as AddressInfo;
    return (body: string, type = "text/plain") =>
      fetch(`http://127.0.0.1:${port}${CLIENT_ERROR_PATH}`, {
        method: "POST",
        headers: { "content-type": type },
        body,
      });
  }

  it("takes a beacon's plain-text body", async () => {
    const log = { warn: vi.fn<ClientErrorLog["warn"]>() };
    const post = await start(log);
    const res = await post(JSON.stringify(REPORT));
    expect(res.status).toBe(204);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][1].page).toBe("catching_up");
  });

  it("limits one address to ten reports a minute", async () => {
    const log = { warn: vi.fn<ClientErrorLog["warn"]>() };
    const post = await start(log);
    const statuses: number[] = [];
    for (let i = 0; i <= CLIENT_ERROR_RATE_PER_MINUTE; i++) {
      const res = await post(JSON.stringify({ ...REPORT, message: `e${i}` }));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, CLIENT_ERROR_RATE_PER_MINUTE)).toEqual(
      Array(CLIENT_ERROR_RATE_PER_MINUTE).fill(204),
    );
    expect(statuses[CLIENT_ERROR_RATE_PER_MINUTE]).toBe(429);
    expect(log.warn).toHaveBeenCalledTimes(CLIENT_ERROR_RATE_PER_MINUTE);
  });
});
