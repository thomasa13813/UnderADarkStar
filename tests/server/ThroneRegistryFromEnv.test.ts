import { afterEach, describe, expect, it } from "vitest";
import { throneRegistryFromEnv } from "../../src/server/MasterLobbyService";

// Under a Dark Star (docs/DarkStar-Rework.md RW0): special thrones are off.
// The registry opens FFA and team lines only.

describe("throneRegistryFromEnv", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("opens no special throne", () => {
    delete process.env.PUBLIC_LOBBIES;
    process.env.THRONE_FLOOR = "3";
    const registry = throneRegistryFromEnv();
    expect(registry).not.toBeNull();
    const types = registry!.all().map((t) => t.type);
    expect(types.filter((t) => t === "ffa")).toHaveLength(3);
    expect(types.filter((t) => t === "team")).toHaveLength(3);
    expect(types).not.toContain("special");
  });
});
