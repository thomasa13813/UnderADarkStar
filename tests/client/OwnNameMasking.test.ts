import { describe, expect, it } from "vitest";
import { withOwnName } from "../../src/client/LeaderboardApi";
import { setOwnJoinName } from "../../src/client/OwnName";
import type { LeaderboardResponse } from "../../src/core/ApiSchemas";
import { GameMode } from "../../src/core/game/Game";
import type { ClientInfo } from "../../src/core/Schemas";

import "../../src/client/components/LobbyPlayerView";
import type { LobbyTeamView } from "../../src/client/components/LobbyPlayerView";

// Under a Dark Star, B6 (docs/DarkStar-Accounts.md §10): the server masks
// offensive words in a name for everyone, and the player whose name it is
// keeps seeing the name they chose: on their own lobby row and on their own
// leaderboard row.

type View = LobbyTeamView & { updateComplete: Promise<unknown> };

function client(id: string, username: string): ClientInfo {
  return { clientID: id, username, clanTag: null };
}

describe("own name over the filtered copy", () => {
  it("shows the player their own name in the lobby, others the masked one", async () => {
    setOwnJoinName("ass-player", null);
    document.body.innerHTML = "<lobby-player-view></lobby-player-view>";
    const view = document.querySelector("lobby-player-view") as View;
    view.gameMode = GameMode.FFA;
    view.clients = [client("me", "***-player"), client("you", "***-hat")];
    view.currentClientID = "me";
    await view.updateComplete;
    const text = view.textContent ?? "";
    expect(text).toContain("ass-player");
    expect(text).not.toContain("***-player");
    expect(text).toContain("***-hat");
  });

  it("puts the owner's name on their row of the leaderboard", () => {
    const row = (publicId: string, username: string) => ({
      rank: 1,
      publicId,
      username,
      victories: 1,
      reigns: 0,
      longestReign: 0,
    });
    const data: LeaderboardResponse = {
      sort: "victories",
      generatedAt: 0,
      entries: [row("a", "***-player.0001"), row("b", "***-hat.0002")],
      me: row("a", "ass-player.0001"),
    };
    expect(withOwnName(data).entries.map((e) => e.username)).toEqual([
      "ass-player.0001",
      "***-hat.0002",
    ]);
    expect(withOwnName({ ...data, me: null }).entries).toEqual(data.entries);
  });
});
