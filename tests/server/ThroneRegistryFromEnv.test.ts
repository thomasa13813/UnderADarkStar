import { afterEach, describe, expect, it } from "vitest";
import { throneRegistryFromEnv } from "../../src/server/MasterLobbyService";

// Under a Dark Star (docs/DarkStar-Rework.md RW0): special thrones are off.
// The registry opens one FFA room and one team room (L32).

describe("throneRegistryFromEnv", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("opens no special throne", () => {
    delete process.env.PUBLIC_LOBBIES;
    delete process.env.THRONE_ROOMS;
    const registry = throneRegistryFromEnv();
    expect(registry).not.toBeNull();
    const types = registry!.all().map((t) => t.type);
    expect(types.filter((t) => t === "ffa")).toHaveLength(1);
    expect(types.filter((t) => t === "team")).toHaveLength(1);
    expect(types).not.toContain("special");
  });
});
