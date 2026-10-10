import { describe, expect, it, vi } from "vitest";
import { GameMode, HumansVsNations } from "../../src/core/game/Game";
import { GameConfigSchema } from "../../src/core/Schemas";
import { MapPlaylist } from "../../src/server/MapPlaylist";

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => 1_000_000,
}));

// Under a Dark Star, T5 (docs/DarkStar-Lobbies.md §5.9): a team throne's round
// is a team game with the Hegemon on, the Lords kept (the round is paced
// around them) and never Humans vs Nations (the throne is a third side to
// neither). The queue fallback's team games are untouched.
describe("MapPlaylist team throne rounds", () => {
  it("rolls a team game with the throne on, the Lords in, and no Humans vs Nations", async () => {
    const playlist = new MapPlaylist();
    for (let i = 0; i < 40; i++) {
      const config = await playlist.gameConfig("team", { throne: true });
      expect(GameConfigSchema.safeParse(config).success).toBe(true);
      expect(config.gameMode).toBe(GameMode.Team);
      expect(config.hegemon).toEqual({ enabled: true });
      expect(config.nations).toBe("default");
      expect(config.playerTeams).toBeDefined();
      expect(config.playerTeams).not.toBe(HumansVsNations);
      expect(config.donateGold).toBe(true);
      expect(config.donateTroops).toBe(true);
    }
  });

  it("leaves the queue fallback's team games as upstream rolls them", async () => {
    const playlist = new MapPlaylist();
    let sawHumansVsNations = false;
    for (let i = 0; i < 60; i++) {
      const config = await playlist.gameConfig("team");
      expect(config.hegemon).toBeUndefined();
      if (config.playerTeams === HumansVsNations) {
        sawHumansVsNations = true;
        expect(config.nations).toBe("default");
      } else {
        expect(config.nations).toBe("disabled");
      }
    }
    expect(sawHumansVsNations).toBe(true);
  });

  it("marks an FFA throne round the same way", async () => {
    const playlist = new MapPlaylist();
    const config = await playlist.gameConfig("ffa", { throne: true });
    expect(config.gameMode).toBe(GameMode.FFA);
    expect(config.hegemon).toEqual({ enabled: true });
    expect(config.nations).toBe("default");
  });
});
