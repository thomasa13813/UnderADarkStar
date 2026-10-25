import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ClientEnv", () => ({
  // getApiBase also asks for the page's injected API origin (none here).
  ClientEnv: { jwtAudience: () => "localhost", apiOrigin: () => undefined },
}));

import { userAuth } from "../../src/client/Auth";

// The bound Auth.ts already applies to /auth/steam (see doSteamLogin).
const AUTH_FETCH_TIMEOUT_MS = 10_000;

// userAuth() awaits the refresh, and every authenticated path in the client
// awaits userAuth() — including Main.handleJoinLobby. An unbounded refresh
// therefore stops the client joining anything at all, forever, on a
// connection that stalls rather than refusing.
describe("/auth/refresh is bounded", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      status: 500,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hands the refresh request a deadline-bound signal", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await userAuth();

    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/auth/refresh"),
    );
    expect(call).toBeDefined();
    const init = call![1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(timeoutSpy).toHaveBeenCalledWith(AUTH_FETCH_TIMEOUT_MS);
  });
});

// B6: the API answers 429 when a visitor goes past its rate limit. That says
// nothing about the session, so the client must not sign out (which would
// end the session on the server); only a 401 does.
describe("/auth/refresh refused for a reason other than the session", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([429, 500])("keeps the session on %i", async (status) => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      status,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await userAuth();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/auth/refresh"))).toBe(true);
    expect(urls.some((u) => u.includes("/auth/logout"))).toBe(false);
  });
});
