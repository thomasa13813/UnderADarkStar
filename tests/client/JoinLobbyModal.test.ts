import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JoinLobbyModal } from "../../src/client/JoinLobbyModal";

describe("JoinLobbyModal server time offset", () => {
  let nowMs = 0;

  beforeEach(() => {
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates serverTimeOffset from lobby serverTime", () => {
    const modal = new JoinLobbyModal();
    (modal as any).syncCountdownTimer = vi.fn();

    nowMs = 220_000;
    (modal as any).updateFromLobby({
      gameID: "g1",
      serverTime: 200_000,
      startsAt: 230_000,
      clients: [],
    });

    expect((modal as any).serverTimeOffset).toBe(-20_000);
    expect((modal as any).lobbyStartAt).toBe(230_000);
  });

  it("does not trigger join timeout early when local clock is ahead", () => {
    const modal = new JoinLobbyModal();
    const closeSpy = vi
      .spyOn(modal, "closeAndLeave")
      .mockImplementation(() => undefined);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    (modal as any).isModalOpen = true;
    (modal as any).isConnecting = true;
    (modal as any).handledJoinTimeout = false;

    // Local clock is +60s ahead of server clock.
    nowMs = 160_000;
    (modal as any).lobbyStartAt = 105_000;
    (modal as any).serverTimeOffset = -60_000;

    (modal as any).checkForJoinTimeout();

    expect(closeSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect((modal as any).handledJoinTimeout).toBe(false);
  });

  it("triggers join timeout once adjusted server time reaches lobbyStartAt", () => {
    const modal = new JoinLobbyModal();
    const closeSpy = vi
      .spyOn(modal, "closeAndLeave")
      .mockImplementation(() => undefined);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    (modal as any).isModalOpen = true;
    (modal as any).isConnecting = true;
    (modal as any).handledJoinTimeout = false;
    (modal as any).lobbyStartAt = 105_000;
    (modal as any).serverTimeOffset = -60_000;

    nowMs = 165_000;
    (modal as any).checkForJoinTimeout();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect((modal as any).handledJoinTimeout).toBe(true);
  });
});

describe("JoinLobbyModal spectate link", () => {
  // A spectate URL is the same lobby link with ?spectate: it must reach the
  // server as a spectator join, and fall through to the archive once the game
  // is over exactly as the play link does.
  const modalWith = (exists: boolean, archived: string) => {
    const modal = new JoinLobbyModal();
    (modal as any).startTrackingLobby = vi.fn();
    (modal as any).resetTrackingState = vi.fn();
    (modal as any).showMessage = vi.fn();
    (modal as any).checkActiveLobby = vi.fn().mockResolvedValue(exists);
    (modal as any).checkArchivedGame = vi.fn().mockResolvedValue(archived);
    return modal;
  };

  it("joins a live lobby as a spectator", async () => {
    const modal = modalWith(true, "not_found");
    await (modal as any).handleUrlJoin("AbCd1234", true);
    expect((modal as any).checkActiveLobby).toHaveBeenCalledWith(
      "AbCd1234",
      true,
    );
    expect((modal as any).checkArchivedGame).not.toHaveBeenCalled();
  });

  it("joins as a player without the flag", async () => {
    const modal = modalWith(true, "not_found");
    await (modal as any).handleUrlJoin("AbCd1234");
    expect((modal as any).checkActiveLobby).toHaveBeenCalledWith(
      "AbCd1234",
      false,
    );
  });

  it("becomes the replay once the game is over", async () => {
    const modal = modalWith(false, "success");
    await (modal as any).handleUrlJoin("AbCd1234", true);
    expect((modal as any).checkArchivedGame).toHaveBeenCalledWith("AbCd1234");
    expect((modal as any).showMessage).not.toHaveBeenCalled();
  });
});

// Under a Dark Star (docs/DarkStar-Lobbies.md §14.8): alone in a room's
// lobby, a newcomer is told a round starts once a second player arrives and
// is offered Solo meanwhile. Not in a private lobby, not to a watcher, not
// once a second player is in or the countdown runs.
describe("JoinLobbyModal lone player's hint", () => {
  const vega = {
    throneID: "throne-vega",
    name: "Vega",
    type: "ffa" as const,
    reign: 0,
    seat: "open" as const,
  };
  const hint = (modal: JoinLobbyModal, seconds: number | null, players = 1) =>
    (modal as any).renderLoneHint(seconds, players);
  const roomLobby = () => {
    const modal = new JoinLobbyModal();
    (modal as any).throne = vega;
    (modal as any).isConnecting = false;
    (modal as any).gameConfig = { gameType: "Public" };
    return modal;
  };

  it("shows alone in a room's lobby with no countdown", () => {
    const result = hint(roomLobby(), null);
    expect(result.strings?.join("")).toContain("data-lone-hint");
  });

  it("stays away with company, a countdown, off a room, or in private", () => {
    const nothingTemplate = hint(new JoinLobbyModal(), null);
    expect(hint(roomLobby(), null, 2)).toBe(nothingTemplate);
    expect(hint(roomLobby(), 40)).toBe(nothingTemplate);
    const priv = roomLobby();
    (priv as any).gameConfig = { gameType: "Private" };
    expect(hint(priv, null)).toBe(nothingTemplate);
  });

  it("leaves the lobby and opens Solo", () => {
    const modal = roomLobby();
    const leave = vi
      .spyOn(modal, "closeAndLeave")
      .mockImplementation(() => undefined);
    const open = vi.fn();
    const solo = document.createElement("single-player-modal") as any;
    solo.open = open;
    document.body.append(solo);
    (modal as any).playSoloInstead();
    expect(leave).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    solo.remove();
  });
});
