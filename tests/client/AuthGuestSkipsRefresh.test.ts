import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ClientEnv", () => ({
  // getApiBase also asks for the page's injected API origin (none here).
  ClientEnv: { jwtAudience: () => "localhost", apiOrigin: () => undefined },
}));

import { expectSession, userAuth } from "../../src/client/Auth";

// A guest's browser holds no refresh cookie, so POST /auth/refresh can only
// answer 401, and it did so (in the console) on every page load. Once one
// refresh has been refused the page stops asking, until a sign-in starts.
describe("a known guest skips /auth/refresh", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const refreshCalls = () =>
    fetchMock.mock.calls.filter((c) => String(c[0]).includes("/auth/refresh"))
      .length;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn(async () => ({
      status: 401,
      ok: false,
      json: async () => ({ error: "no session" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("asks once, then not again after a 401", async () => {
    expect(await userAuth()).toBe(false);
    expect(refreshCalls()).toBe(1);

    expect(await userAuth()).toBe(false);
    expect(refreshCalls()).toBe(1);
  });

  it("asks again once a sign-in has started", async () => {
    await userAuth();
    expectSession();
    await userAuth();
    expect(refreshCalls()).toBe(2);
  });

  it("keeps asking while the API is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));
    await userAuth();
    await userAuth();
    expect(refreshCalls()).toBe(2);
  });
});
