import { describe, expect, it } from "vitest";
import { normaliseMapKey } from "../../src/client/Utils";
import { GameMapType, maps } from "../../src/core/game/Game";

describe("normaliseMapKey", () => {
  it("resolves a map to its asset directory, not its display name", () => {
    expect(normaliseMapKey(GameMapType.MilkyWay)).toBe("milkyway");
    expect(normaliseMapKey(GameMapType.TradersDream)).toBe("tradersdream");
  });

  it("matches the lowercased map id for every known map", () => {
    for (const map of maps) {
      expect(normaliseMapKey(map.type)).toBe(map.id.toLowerCase());
    }
  });

  it("falls back to stripping spaces and dots for unknown map names", () => {
    expect(normaliseMapKey("Some. Unknown Map")).toBe("someunknownmap");
  });
});
