import { describe, expect, it, vi } from "vitest";
import {
  findLobby,
  lineHead,
  placeLabel,
  throneLine,
} from "../../src/client/ThroneLine";
import type {
  PublicGameInfo,
  PublicGames,
  ThroneType,
} from "../../src/core/Schemas";

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, args?: Record<string, string | number>) =>
    args ? `${key}:${Object.values(args).join(",")}` : key,
}));

// Under a Dark Star (docs/DarkStar-Lobbies.md L16-L19, L27): the client's
// reading of the launch lines off the public list.

function throne(
  gameID: string,
  type: ThroneType,
  extra: Partial<PublicGameInfo["throne"] & object> = {},
): PublicGameInfo {
  return {
    gameID,
    numClients: 1,
    publicGameType: "throne",
    throne: {
      throneID: `throne-${gameID}`,
      name: gameID,
      type,
      reign: 0,
      seat: "open",
      ...extra,
    },
  };
}

const games: PublicGames["games"] = {
  throne: [
    throne("f-head", "ffa", { place: 1 }),
    throne("s-head", "special", { place: 1 }),
    throne("f-third", "ffa", { place: 3 }),
    throne("f-second", "ffa", { place: 2 }),
    throne("f-running", "ffa", { running: true }),
    throne("f-deciding", "ffa", { reservationUntil: 1 }),
  ],
  hosted: [
    {
      gameID: "hosted-1",
      numClients: 2,
      publicGameType: "hosted",
    },
  ],
};

describe("throne lines on the client", () => {
  it("finds a lobby in any bucket", () => {
    expect(findLobby(games, "hosted-1")?.publicGameType).toBe("hosted");
    expect(findLobby(games, "f-second")?.throne?.place).toBe(2);
    expect(findLobby(games, "nope")).toBeUndefined();
    expect(findLobby(games, null)).toBeUndefined();
    expect(findLobby(undefined, "f-head")).toBeUndefined();
  });

  it("orders one line head first and leaves out what is not in line", () => {
    expect(throneLine(games, "ffa").map((l) => l.gameID)).toEqual([
      "f-head",
      "f-second",
      "f-third",
    ]);
    expect(throneLine(games, "special").map((l) => l.gameID)).toEqual([
      "s-head",
    ]);
    expect(throneLine(games, "team")).toEqual([]);
  });

  it("names the head of a line", () => {
    expect(lineHead(games, "ffa")?.gameID).toBe("f-head");
    expect(lineHead(games, "team")).toBeUndefined();
    expect(lineHead(null, "ffa")).toBeUndefined();
  });

  it("reads a place as the player does", () => {
    expect(placeLabel(undefined)).toBeUndefined();
    expect(placeLabel(1)).toBe("throne.line_place_next");
    expect(placeLabel(2)).toBe("throne.line_place_ahead:1");
    expect(placeLabel(5)).toBe("throne.line_place_ahead:4");
  });
});
