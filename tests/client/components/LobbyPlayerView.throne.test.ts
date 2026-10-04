import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../../src/client/components/LobbyPlayerView";
import type { LobbyTeamView } from "../../../src/client/components/LobbyPlayerView";
import { GameMode } from "../../../src/core/game/Game";
import type { ClientInfo, ThroneInfo } from "../../../src/core/Schemas";

vi.mock("../../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/client/Utils")>()),
  translateText: (key: string, args?: Record<string, string | number>) =>
    args ? `${key}:${Object.values(args).join(",")}` : key,
}));

// Under a Dark Star, T3 (docs/DarkStar-Lobbies.md §4 step 2): the throne row
// of a public throne lobby. The throne's name and the holder's reign; a
// "Claim the throne" button on an open seat, "Give up the throne" for the
// holder, nothing for spectators; and "reserved for" while the last winner is
// still choosing.

function client(
  clientID: string,
  overrides: Partial<ClientInfo> = {},
): ClientInfo {
  return { clientID, username: clientID, clanTag: null, ...overrides };
}

const VEGA: ThroneInfo = {
  throneID: "throne-01",
  name: "Vega",
  type: "ffa",
  reign: 0,
  seat: "open",
};

async function mount(
  props: Partial<LobbyTeamView> & { clients: ClientInfo[] },
): Promise<LobbyTeamView> {
  const view = document.createElement("lobby-player-view") as LobbyTeamView;
  view.gameMode = GameMode.FFA;
  Object.assign(view, props);
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function action(view: LobbyTeamView): string | null {
  const button = view.querySelector<HTMLButtonElement>("[data-throne-action]");
  return button?.dataset.throneAction ?? null;
}

describe("lobby throne row", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("offers an open seat to a player, and claims it on click", async () => {
    const onClaimSeat = vi.fn();
    const view = await mount({
      currentClientID: "me",
      clients: [client("me"), client("other")],
      throne: VEGA,
      onClaimSeat,
      onLeaveSeat: vi.fn(),
    });
    expect(view.textContent).toContain("throne.name_line:Vega");
    expect(view.textContent).toContain("host_modal.throne_ai");
    expect(action(view)).toBe("claim");
    view.querySelector<HTMLButtonElement>("[data-throne-action]")!.click();
    expect(onClaimSeat).toHaveBeenCalledOnce();
  });

  it("lets the holder give the seat up, and shows their reign", async () => {
    const onLeaveSeat = vi.fn();
    const view = await mount({
      currentClientID: "me",
      clients: [client("me"), client("other")],
      hegemonSeat: "me",
      throne: { ...VEGA, seat: "seated", holderName: "me", reign: 3 },
      onClaimSeat: vi.fn(),
      onLeaveSeat,
    });
    expect(view.textContent).toContain("host_modal.throne_holder:me");
    expect(view.textContent).toContain("throne.reign_line:3");
    expect(action(view)).toBe("leave");
    view.querySelector<HTMLButtonElement>("[data-throne-action]")!.click();
    expect(onLeaveSeat).toHaveBeenCalledOnce();
  });

  it("shows no button to the other players while someone sits, nor to spectators", async () => {
    const taken = await mount({
      currentClientID: "me",
      clients: [client("me"), client("other")],
      hegemonSeat: "other",
      throne: { ...VEGA, seat: "seated", holderName: "other" },
      onClaimSeat: vi.fn(),
      onLeaveSeat: vi.fn(),
    });
    expect(action(taken)).toBeNull();

    const watching = await mount({
      currentClientID: "me",
      clients: [client("me", { spectator: true }), client("other")],
      throne: VEGA,
      onClaimSeat: vi.fn(),
      onLeaveSeat: vi.fn(),
    });
    expect(action(watching)).toBeNull();
  });

  it("names who the seat is reserved for, with no claim button", async () => {
    const view = await mount({
      currentClientID: "me",
      clients: [client("me")],
      throne: { ...VEGA, seat: "reserved", holderName: "Ada" },
      onClaimSeat: vi.fn(),
      onLeaveSeat: vi.fn(),
    });
    expect(view.textContent).toContain("throne.reserved_for:Ada");
    expect(action(view)).toBeNull();
  });

  it("keeps the private-lobby row unchanged without a throne", async () => {
    const view = await mount({
      currentClientID: "me",
      clients: [client("me")],
      onClaimSeat: vi.fn(),
    });
    expect(view.textContent).not.toContain("throne.");
    expect(action(view)).toBeNull();
  });
});
