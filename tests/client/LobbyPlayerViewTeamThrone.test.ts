import { describe, expect, it } from "vitest";
import { GameMode } from "../../src/core/game/Game";
import type { ClientInfo } from "../../src/core/Schemas";

import "../../src/client/components/LobbyPlayerView";
import type { LobbyTeamView } from "../../src/client/components/LobbyPlayerView";

// Under a Dark Star, T5 (docs/DarkStar-Lobbies.md §5.9): in a team lobby the
// throne row shows above the roster as in FFA, the seated player wears the
// badge in the players list, and the team preview files only the challengers:
// the throne is a team of one, not a member of any previewed team.

type View = LobbyTeamView & { updateComplete: Promise<unknown> };

function client(id: string): ClientInfo {
  return { clientID: id, username: id, clanTag: null };
}

async function mount(seat: string | null): Promise<View> {
  document.body.innerHTML = "<lobby-player-view></lobby-player-view>";
  const view = document.querySelector("lobby-player-view") as View;
  view.gameMode = GameMode.Team;
  view.teamCount = 2;
  view.clients = [client("ann"), client("bob"), client("cy")];
  view.currentClientID = "bob";
  view.hegemonSeat = seat;
  view.throne = {
    throneID: "throne-01",
    name: "Vega",
    type: "team",
    reign: 2,
    seat: "seated",
  };
  await view.updateComplete;
  return view;
}

function teamCardNames(view: View): string[] {
  // Team cards are the roster's right-hand grid; each card lists its players
  // as truncated white spans.
  return Array.from(
    view.querySelectorAll(".rounded-xl .truncate.text-white"),
  ).map((el) => el.textContent?.trim() ?? "");
}

describe("LobbyPlayerView: a team throne lobby", () => {
  it("shows the throne row, the seat badge, and keeps the seated player out of the teams", async () => {
    const view = await mount("ann");
    const text = view.textContent ?? "";
    expect(text).toContain("throne.name_line_team");
    expect(text).toContain("host_modal.throne_holder");
    expect(text).toContain("host_modal.hegemon_badge");
    const names = teamCardNames(view);
    expect(names.sort()).toEqual(["bob", "cy"]);
  });

  it("files everyone onto teams while the AI holds the seat", async () => {
    const view = await mount(null);
    const text = view.textContent ?? "";
    expect(text).toContain("host_modal.throne_ai");
    expect(text).not.toContain("host_modal.hegemon_badge");
    expect(teamCardNames(view).sort()).toEqual(["ann", "bob", "cy"]);
  });

  it("re-files the teams when the seat changes hands", async () => {
    const view = await mount(null);
    view.hegemonSeat = "cy";
    await view.updateComplete;
    expect(teamCardNames(view).sort()).toEqual(["ann", "bob"]);
  });
});
