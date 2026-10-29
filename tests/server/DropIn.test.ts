import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DROP_IN_CUTOFF_TURNS, dropInCutoffTurn } from "../../src/core/DropIn";
import { GameType } from "../../src/core/game/Game";
import {
  GameConfig,
  ServerStartGameMessage,
  StampedIntent,
} from "../../src/core/Schemas";
import { createGameWireContext } from "../../src/core/ZbinWire";
import { dropInVerdict } from "../../src/server/DropIn";
import { GameServer } from "../../src/server/GameServer";
import { authorizeIntent } from "../../src/server/IntentAuthorization";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";
import { testGameConfig } from "../util/Wire";

// Under a Dark Star (docs/DarkStar-Lobbies.md L33, L36, L42, L43, L48): who
// drops into a room's running round. The server issues the join into the
// turn stream (never the joiner's browser); the last 3 minutes hold
// arrivals as observers for the next round; a full room lets them watch; a
// returning player gets their own player back; a watcher may turn pirate.

const T0 = 1_700_000_000_000;
const TURN_MS = 100;

const ROOM_CONFIG: Partial<GameConfig> = {
  gameType: GameType.Public,
  piracy: { enabled: true },
  hegemon: { enabled: true },
  maxPlayers: 3,
  // A 4-minute round: the cutoff falls at the spawn phase plus one minute.
  maxTimerValue: 4,
};

function room(config: Partial<GameConfig> = {}): GameServer {
  const game = makeGame({
    publicGameType: "throne",
    config: { ...ROOM_CONFIG, ...config },
  });
  game.setThrone({
    throneID: "throne-01",
    name: "Vega",
    type: "ffa",
    reign: 0,
    minPlayers: 1,
  });
  return game;
}

type JoinIntent = Extract<StampedIntent, { type: "join_round" }>;

// Frames decode against the start roster's clientID dictionary, which every
// test here knows: the players who were in when the round started.
function ctxOf(roster: string[]) {
  return createGameWireContext(roster.map((clientID) => ({ clientID })));
}

function joinsSeenBy(
  player: ReturnType<typeof makeClient>,
  roster: string[],
): JoinIntent[] {
  return mockWsOf(player)
    .sent(ctxOf(roster))
    .flatMap((m) => (m.type === "turn" ? m.turn.intents : []))
    .filter((i): i is JoinIntent => i.type === "join_round");
}

function startMsgOf(client: ReturnType<typeof makeClient>, roster: string[]) {
  return mockWsOf(client)
    .sent(ctxOf(roster))
    .find((m): m is ServerStartGameMessage => m.type === "start");
}

describe("dropInVerdict", () => {
  const config = testGameConfig(ROOM_CONFIG);
  const base = { isRoom: true, config, turns: 300, players: 1, over: false };

  it("lets a newcomer into a room's round", () => {
    expect(dropInVerdict(base)).toBe("join");
  });

  it("holds them as an observer in the last 3 minutes (L48)", () => {
    const cutoff = dropInCutoffTurn(config);
    // A 4-minute round after a 200-turn spawn phase.
    expect(cutoff).toBe(200 + 4 * 600 - DROP_IN_CUTOFF_TURNS);
    expect(dropInVerdict({ ...base, turns: cutoff - 1 })).toBe("join");
    expect(dropInVerdict({ ...base, turns: cutoff })).toBe("held");
  });

  it("lets them only watch a full room (L33)", () => {
    expect(dropInVerdict({ ...base, players: 3 })).toBe("full");
  });

  it("does not apply off a room, after the round, without piracy, or with names hidden", () => {
    expect(dropInVerdict({ ...base, isRoom: false })).toBeNull();
    expect(dropInVerdict({ ...base, over: true })).toBeNull();
    expect(
      dropInVerdict({
        ...base,
        config: { ...config, piracy: { enabled: false } },
      }),
    ).toBeNull();
    expect(
      dropInVerdict({ ...base, config: { ...config, anonymizeNames: true } }),
    ).toBeNull();
  });

  it("uses the default round length when the timer is unset", () => {
    expect(dropInCutoffTurn({ ...config, maxTimerValue: undefined })).toBe(
      200 + 20 * 600 - DROP_IN_CUTOFF_TURNS,
    );
  });
});

describe("GameServer drop-in", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("issues a server-made join for a newcomer to a running room round (L36)", () => {
    const game = room();
    const p1 = makeClient({ clientID: cid("p1") });
    game.joinClient(p1);
    startGame(game);
    // At once after the start: no "game just started" refusal in a room.
    const late = makeClient({
      clientID: cid("late"),
      username: "Ada",
      clanTag: "VEGA",
    });
    expect(game.joinClient(late)).toBe("joined");
    expect(late.spectator).toBe(false);
    vi.advanceTimersByTime(TURN_MS);
    const joins = joinsSeenBy(p1, [p1.clientID]);
    expect(joins).toEqual([
      {
        type: "join_round",
        clientID: cid("late"),
        username: "Ada",
        clanTag: "VEGA",
      },
    ]);
    // The latecomer was sent the start and the turns so far.
    expect(startMsgOf(late, [p1.clientID])?.heldForNextRound).toBeUndefined();
    // The room is repeated for the late joiner, who saw no lobby info.
    expect(startMsgOf(late, [p1.clientID])?.throne?.name).toBe("Vega");
    // Not added to the start roster: their win would be void (L44).
    expect(
      startMsgOf(late, [p1.clientID])!.gameStartInfo.players.map(
        (p) => p.clientID,
      ),
    ).toEqual([cid("p1")]);
  });

  it("strips the clan tag where tags are off", () => {
    const game = room({ disableClanTags: true });
    game.joinClient(makeClient({ clientID: cid("p2") }));
    const p1 = makeClient({ clientID: cid("p3") });
    game.joinClient(p1);
    startGame(game);
    game.joinClient(makeClient({ clientID: cid("late2"), clanTag: "VEGA" }));
    vi.advanceTimersByTime(TURN_MS);
    expect(joinsSeenBy(p1, [cid("p2"), cid("p3")])[0].clanTag).toBeNull();
  });

  it("gives a returning drop-in their own player back, with no second join (L42)", () => {
    const game = room();
    const p1 = makeClient({ clientID: cid("p4") });
    game.joinClient(p1);
    startGame(game);
    const late = makeClient({
      clientID: cid("late3"),
      persistentID: "late3-pid",
    });
    game.joinClient(late);
    vi.advanceTimersByTime(TURN_MS);
    // Reloads the page: a new connection under the same persistentID.
    const again = makeClient({
      clientID: cid("late4"),
      persistentID: "late3-pid",
    });
    expect(game.joinClient(again)).toBe("joined");
    vi.advanceTimersByTime(TURN_MS);
    expect(joinsSeenBy(p1, [p1.clientID])).toHaveLength(1);
    expect(game.getClientIdForPersistentId("late3-pid")).toBe(cid("late3"));
  });

  it("holds an arrival in the round's last 3 minutes as an observer (L48)", () => {
    const game = room();
    const p1 = makeClient({ clientID: cid("p5") });
    game.joinClient(p1);
    startGame(game);
    vi.advanceTimersByTime(
      dropInCutoffTurn(testGameConfig(ROOM_CONFIG)) * TURN_MS,
    );
    const late = makeClient({ clientID: cid("late5") });
    expect(game.joinClient(late)).toBe("joined");
    expect(late.spectator).toBe(true);
    expect(startMsgOf(late, [p1.clientID])?.heldForNextRound).toBe(true);
    vi.advanceTimersByTime(TURN_MS);
    expect(joinsSeenBy(p1, [p1.clientID])).toHaveLength(0);
  });

  it("lets a newcomer only watch a full room (L33)", () => {
    const game = room();
    const players = [cid("p6"), cid("p7"), cid("p8")].map((id) =>
      makeClient({ clientID: id }),
    );
    for (const p of players) game.joinClient(p);
    startGame(game);
    const late = makeClient({ clientID: cid("late6") });
    expect(game.joinClient(late)).toBe("joined");
    expect(late.spectator).toBe(true);
    expect(
      startMsgOf(
        late,
        players.map((p) => p.clientID),
      )?.heldForNextRound,
    ).toBeUndefined();
    vi.advanceTimersByTime(TURN_MS);
    expect(
      joinsSeenBy(
        players[0],
        players.map((p) => p.clientID),
      ),
    ).toHaveLength(0);
  });

  it("turns a watcher into a pirate on request (L43)", async () => {
    const game = room();
    const p1 = makeClient({ clientID: cid("p9") });
    game.joinClient(p1);
    startGame(game);
    const watcher = makeClient({ clientID: cid("watch"), spectator: true });
    expect(game.joinClient(watcher)).toBe("joined");
    expect(watcher.spectator).toBe(true);
    vi.advanceTimersByTime(TURN_MS);
    expect(joinsSeenBy(p1, [p1.clientID])).toHaveLength(0);
    await mockWsOf(watcher).emit({ type: "spectate", spectator: false });
    expect(watcher.spectator).toBe(false);
    vi.advanceTimersByTime(TURN_MS);
    expect(joinsSeenBy(p1, [p1.clientID]).map((i) => i.clientID)).toEqual([
      cid("watch"),
    ]);
  });

  it("keeps today's late-joiner rules off a room", () => {
    const game = makeGame({ config: { piracy: { enabled: true } } });
    game.joinClient(makeClient({ clientID: cid("q1") }));
    startGame(game);
    const late = makeClient({ clientID: cid("q2") });
    expect(game.joinClient(late)).toBe("started");
  });

  it("refuses join_round from a client: it is server-internal", () => {
    expect(
      authorizeIntent(
        { type: "join_round", username: "Ada", clanTag: null },
        {
          clientID: cid("p1"),
          isLobbyCreator: true,
          isAdmin: true,
          isAdminBot: false,
        } as any,
        { isPublic: true } as any,
      ),
    ).toEqual({ status: 400, error: "join_round is server-internal" });
  });
});
