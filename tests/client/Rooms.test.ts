import { describe, expect, it } from "vitest";
import {
  otherRooms,
  roomIsFull,
  roomState,
  steeringOrder,
  steerTarget,
} from "../../src/client/Rooms";
import type { PublicGameInfo } from "../../src/core/Schemas";

// Under a Dark Star (docs/DarkStar-Lobbies.md L33, L38): the steering order
// over the rooms the public list carries. Rooms under their cap only: about
// to launch, soonest first; then rounds in progress, longest running first;
// then lobbies with players and no countdown; then empty ones.

function room(
  gameID: string,
  opts: {
    players?: number;
    startsAt?: number;
    running?: boolean;
    startedAt?: number;
    cap?: number;
  } = {},
): PublicGameInfo {
  return {
    gameID,
    numClients: opts.players ?? 0,
    startsAt: opts.startsAt,
    publicGameType: "throne",
    gameConfig: { maxPlayers: opts.cap ?? 50 } as PublicGameInfo["gameConfig"],
    throne: {
      throneID: `throne-${gameID}`,
      name: gameID,
      type: "ffa",
      reign: 0,
      seat: "open",
      running: opts.running,
      startedAt: opts.startedAt,
    },
  };
}

describe("the rooms' steering order (L38)", () => {
  const games = {
    throne: [
      room("empty"),
      room("gathering", { players: 1 }),
      room("busy", { players: 3 }),
      room("late", { players: 2, startsAt: 2_000 }),
      room("soon", { players: 2, startsAt: 1_000 }),
      room("young", { players: 10, running: true, startedAt: 500 }),
      room("old", { players: 10, running: true, startedAt: 100 }),
      room("full", { players: 50, running: true, startedAt: 50 }),
    ],
  };

  it("ranks launch, then the longest running round, then players, then empty", () => {
    expect(steeringOrder(games).map((r) => r.gameID)).toEqual([
      "soon",
      "late",
      "old",
      "young",
      "busy",
      "gathering",
      "empty",
    ]);
    expect(steerTarget(games)?.gameID).toBe("soon");
  });

  it("never steers into a full room (L33)", () => {
    expect(roomIsFull(room("full", { players: 50 }))).toBe(true);
    expect(steerTarget({ throne: [room("full", { players: 50 })] })).toBe(
      undefined,
    );
  });

  it("names a room's state", () => {
    expect(roomState(room("a"))).toBe("empty");
    expect(roomState(room("a", { players: 1 }))).toBe("gathering");
    expect(roomState(room("a", { startsAt: 1 }))).toBe("countdown");
    expect(roomState(room("a", { running: true }))).toBe("running");
  });

  it("offers the other rooms, never one's own", () => {
    expect(otherRooms(games, "throne-soon").map((r) => r.gameID)[0]).toBe(
      "late",
    );
    expect(steerTarget(null)).toBeUndefined();
  });
});
