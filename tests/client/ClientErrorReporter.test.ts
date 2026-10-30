import { afterEach, describe, expect, it } from "vitest";
import {
  ClientErrorReporter,
  setReportedGame,
} from "../../src/client/ClientErrorReporter";

// Under a Dark Star (docs/DarkStar-Lobbies.md §14.8): the browser side of
// error reports. Uncaught errors and rejected promises are sent once each
// per page load, at most ten, cut to size, with where in the game they
// happened and the build; noise and extensions are not sent.

function capture() {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const reporter = new ClientErrorReporter((url, body) =>
    sent.push({ url, body: JSON.parse(body) }),
  );
  return { reporter, sent };
}

afterEach(() => {
  setReportedGame(null);
  window.currentPageId = undefined;
});

describe("ClientErrorReporter", () => {
  it("sends an uncaught error with its stack, page and source", () => {
    const { reporter, sent } = capture();
    const target = new EventTarget() as unknown as Window;
    reporter.install(target);
    const error = new TypeError("x is undefined");
    target.dispatchEvent(
      Object.assign(new Event("error"), {
        message: "Uncaught TypeError: x is undefined",
        error,
        filename: "https://cdn.example/main.js",
        lineno: 12,
        colno: 3,
      }),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toMatch(/\/api\/client-error$/);
    expect(sent[0].body).toMatchObject({
      kind: "error",
      message: "TypeError: x is undefined",
      source: "https://cdn.example/main.js:12:3",
      page: "home",
    });
    expect(sent[0].body.stack).toContain("x is undefined");
    expect(typeof sent[0].body.commit).toBe("string");
  });

  it("sends a rejected promise", () => {
    const { reporter, sent } = capture();
    const target = new EventTarget() as unknown as Window;
    reporter.install(target);
    target.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), {
        reason: new Error("socket closed"),
      }),
    );
    target.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), { reason: "plain" }),
    );
    expect(sent.map((s) => [s.body.kind, s.body.message])).toEqual([
      ["unhandledrejection", "Error: socket closed"],
      ["unhandledrejection", "plain"],
    ]);
  });

  it("sends the same error once, and no more than ten in all", () => {
    const { reporter, sent } = capture();
    reporter.report("error", "same", "stack", undefined);
    reporter.report("error", "same", "stack", undefined);
    expect(sent).toHaveLength(1);
    for (let i = 0; i < 20; i++) reporter.report("error", `e${i}`, "", "");
    expect(sent).toHaveLength(10);
  });

  it("leaves out noise and extensions", () => {
    const { reporter, sent } = capture();
    reporter.report("error", "Script error.", undefined, undefined);
    reporter.report(
      "error",
      "ResizeObserver loop completed with undelivered notifications.",
      undefined,
      undefined,
    );
    reporter.report(
      "error",
      "boom",
      undefined,
      "chrome-extension://abc/x.js:1:1",
    );
    expect(sent).toHaveLength(0);
  });

  it("cuts a long message and stack", () => {
    const { reporter, sent } = capture();
    reporter.report("error", "m".repeat(5_000), "s".repeat(10_000), undefined);
    expect((sent[0].body.message as string).length).toBe(1_000);
    expect((sent[0].body.stack as string).length).toBe(4_000);
  });

  it("says where in the game it happened", () => {
    const { reporter, sent } = capture();
    window.currentPageId = "page-join-lobby";
    reporter.report("error", "a", undefined, undefined);
    let catching = true;
    setReportedGame({
      isCatchingUp: () => catching,
      config: () => ({ isReplay: () => false }),
    });
    reporter.report("error", "b", undefined, undefined);
    catching = false;
    reporter.report("error", "c", undefined, undefined);
    setReportedGame({
      isCatchingUp: () => false,
      config: () => ({ isReplay: () => true }),
    });
    reporter.report("error", "d", undefined, undefined);
    expect(sent.map((s) => s.body.page)).toEqual([
      "lobby",
      "catching_up",
      "game",
      "replay",
    ]);
  });

  it("never throws when sending fails", () => {
    const reporter = new ClientErrorReporter(() => {
      throw new Error("no network");
    });
    expect(() =>
      reporter.report("error", "x", undefined, undefined),
    ).not.toThrow();
  });
});
