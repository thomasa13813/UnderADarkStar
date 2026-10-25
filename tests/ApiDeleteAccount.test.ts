import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/client/Auth", () => ({
  logOut: async () => true,
  userAuth: async () => null,
  isSessionActive: () => false,
  getPlayToken: async () => "token",
  getAuthHeader: async () => "",
}));

const { deleteAccount } = await import("../src/client/Api");
const { ClientEnv } = await import("../src/client/ClientEnv");

// getApiBase() reads this; without it the fetch never happens and
// deleteAccount returns "failed" from its catch, passing vacuously.
function setConfig() {
  (window as unknown as { BOOTSTRAP_CONFIG: unknown }).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience: "openfront.dev",
    instanceId: "desktop",
    gitCommit: "test",
  };
  ClientEnv.reset();
}

function respondWith(status: number, body: unknown = {}) {
  const fetchMock = vi.fn(
    async () =>
      ({
        status,
        ok: status >= 200 && status < 300,
        statusText: "",
        json: async () => body,
      }) as Response,
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("deleteAccount (POST /auth/delete)", () => {
  beforeEach(setConfig);

  afterEach(() => {
    delete (window as unknown as { BOOTSTRAP_CONFIG?: unknown })
      .BOOTSTRAP_CONFIG;
    ClientEnv.reset();
    vi.unstubAllGlobals();
  });

  it("sends the refresh cookie and no Authorization header", async () => {
    const fetchMock = respondWith(204);
    await deleteAccount();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url.endsWith("/auth/delete")).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.headers).toBeUndefined();
  });

  it("treats 204 as deleted", async () => {
    respondWith(204);
    expect(await deleteAccount()).toEqual({ ok: true });
  });

  it("maps 401 to logged_out", async () => {
    respondWith(401, { error: "no session" });
    expect(await deleteAccount()).toEqual({ ok: false, code: "logged_out" });
  });

  it("maps 403 to banned", async () => {
    respondWith(403, { error: "banned" });
    expect(await deleteAccount()).toEqual({ ok: false, code: "banned" });
  });

  it("maps any other status to failed", async () => {
    respondWith(500);
    expect(await deleteAccount()).toEqual({ ok: false, code: "failed" });
  });
});
