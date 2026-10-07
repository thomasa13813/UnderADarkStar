import { afterEach, describe, expect, it, vi } from "vitest";
import { GameEnv } from "../../src/core/configuration/Config";
import { verifyClientToken } from "../../src/server/jwt";
import { ServerEnv } from "../../src/server/ServerEnv";

// Under a Dark Star, A10: a guest's anonymous browser ID is accepted as a
// guest in every environment. Upstream refused it outside dev.

describe("verifyClientToken with a guest's browser ID", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const GUEST_ID = "123e4567-e89b-12d3-a456-426614174000";

  it.each([GameEnv.Dev, GameEnv.Preprod, GameEnv.Prod])(
    "accepts it as a guest in %s",
    async (env) => {
      vi.spyOn(ServerEnv, "env").mockReturnValue(env);
      const result = await verifyClientToken(GUEST_ID);
      expect(result).toEqual({
        type: "success",
        persistentId: GUEST_ID,
        claims: null,
      });
    },
  );

  it("still refuses a token that is neither an ID nor a valid JWT", async () => {
    vi.spyOn(ServerEnv, "env").mockReturnValue(GameEnv.Prod);
    vi.spyOn(ServerEnv, "jwtAudience").mockReturnValue("example.com");
    vi.spyOn(ServerEnv, "jwkPublicKey").mockRejectedValue(
      new Error("no key in this test"),
    );
    const result = await verifyClientToken("not-a-token");
    expect(result.type).toBe("error");
  });
});
