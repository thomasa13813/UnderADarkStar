import { describe, expect, it } from "vitest";
import { getGameModeLabel } from "../../src/client/Utils";
import { GameMode } from "../../src/core/game/Game";
import { testGameConfig } from "../util/Wire";

// Under a Dark Star (docs/DarkStar-Lobbies.md L37): a room's teams are a
// count that latecomers balance, so a room's label names the count alone,
// never a size worked out from the cap.
describe("getGameModeLabel for a room", () => {
  const config = testGameConfig({
    gameMode: GameMode.Team,
    playerTeams: 3,
    maxPlayers: 50,
  });

  it("names a room's teams by their count only", () => {
    // Translations are not loaded here: the keys stand in for the text.
    expect(getGameModeLabel(config, { room: true })).toBe("public_lobby.teams");
  });

  it("keeps upstream's size on other games", () => {
    expect(getGameModeLabel(config)).toContain("public_lobby.players_per_team");
  });
});
