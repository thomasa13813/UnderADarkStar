import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { PartialGameRecord } from "../../src/core/Schemas";
import { ThroneAssignment } from "../../src/server/IPCBridgeSchema";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// What the game writes into the record it archives, driven through real
// joins and starts and read off the injected archive.

// Lets the fetchTribes .then/.catch chain settle.
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("archived game records", () => {
  let archive: ReturnType<
    typeof vi.fn<(r: PartialGameRecord) => Promise<void>>
  >;

  beforeEach(() => {
    vi.useFakeTimers();
    archive = vi.fn(async () => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const archived = () => archive.mock.calls[0][0];

  it("preserves simulation inputs (teamIndex, friends, isLobbyCreator) so replays stay in sync", async () => {
    // Matchmade 2v2: the server stamps teamIndex on the game start info and
    // every client pins teams from it. The archived record is replayed
    // through the same team assignment, so these fields must survive
    // archiving — dropping them makes replays re-derive different teams and
    // desync from the recorded hashes.
    const ALICE = cid("alice");
    const BOB = cid("bob");
    const game = makeGame({
      config: { gameType: GameType.Public },
      creatorPersistentID: "alice-pid",
      matchmakingTeams: [["alice-pub"], ["bob-pub"]],
      deps: { archive },
    });
    const alice = makeClient({
      clientID: ALICE,
      persistentID: "alice-pid",
      username: "alice",
      clanTag: "AA",
      publicId: "alice-pub",
      friends: ["bob-pub"],
      ip: "1.1.1.1",
    });
    const bob = makeClient({
      clientID: BOB,
      persistentID: "bob-pid",
      username: "bob",
      publicId: "bob-pub",
      ip: "2.2.2.2",
    });
    game.joinClient(alice);
    game.joinClient(bob);
    startGame(game);

    // Both back the same winner: 2 of 2 IPs archives the game.
    for (const c of [alice, bob]) {
      await mockWsOf(c).emit({
        type: "winner",
        winner: ["player", ALICE],
        allPlayersStats: {},
      });
    }

    expect(archive).toHaveBeenCalledTimes(1);
    const [a, b] = archived().info.players;
    expect(a).toMatchObject({
      clientID: ALICE,
      username: "alice",
      clanTag: "AA",
      persistentID: "alice-pid",
      teamIndex: 0,
      friends: [BOB],
      isLobbyCreator: true,
    });
    expect(b).toMatchObject({
      clientID: BOB,
      teamIndex: 1,
      isLobbyCreator: false,
    });
    // No friends in the game is recorded as the field being absent.
    expect(b.friends).toBeUndefined();
    expect(archived().info.winner).toEqual(["player", ALICE]);
  });

  it("carries custom tribe names into the archived record for infra ingest and replays", async () => {
    const fetchTribes = vi.fn(async () => [
      { name: "Dragon Riders" },
      { name: "Night Wolves" },
    ]);
    const game = makeGame({
      config: { gameType: GameType.Public, bots: 2 },
      deps: { archive, fetchTribes },
    });
    game.joinClient(makeClient({ publicId: "someone-pub" }));

    game.prestart();
    await flushMicrotasks();
    game.start();
    // Ending an unfinished game archives it as it stands.
    await game.end();

    expect(archive).toHaveBeenCalledTimes(1);
    expect(archived().info.tribes).toEqual([
      { name: "Dragon Riders" },
      { name: "Night Wolves" },
    ]);
  });

  it("omits tribes from the archived record when none were fetched", async () => {
    const game = makeGame({
      config: { gameType: GameType.Public, bots: 2 },
      deps: { archive },
    });
    game.joinClient(makeClient());

    startGame(game);
    await game.end();

    expect(archive).toHaveBeenCalledTimes(1);
    expect(archived().info.tribes).toBeUndefined();
  });
});

// Under a Dark Star (docs/DarkStar-Accounts.md §5.2): the two additions the
// results ingest reads, the per-player `verified` flag and the throne block
// with the reign the Hegemon brought in.
describe("archived throne records", () => {
  let archive: ReturnType<
    typeof vi.fn<(r: PartialGameRecord) => Promise<void>>
  >;
  const archived = () => archive.mock.calls[0][0];
  const CLAIMS = {
    jti: "j",
    sub: "00000000-0000-4000-8000-000000000001",
    iat: 0,
    iss: "http://localhost:8787",
    aud: "localhost",
  } as any;

  beforeEach(() => {
    vi.useFakeTimers();
    archive = vi.fn(async () => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  async function playThroneRound(
    throne: ThroneAssignment,
    seatOnThrone: boolean,
  ) {
    const seat = cid("seat");
    const game = makeGame({
      publicGameType: "throne",
      config: {
        gameType: GameType.Public,
        hegemon: seatOnThrone ? { enabled: true, seat } : { enabled: true },
      },
      deps: { archive, throneRound: () => {} },
    });
    game.setThrone(throne);
    const ada = makeClient({
      clientID: seat,
      persistentID: "pid-ada",
      username: "Ada",
      claims: CLAIMS,
    });
    const bob = makeClient({ persistentID: "pid-bob", username: "Bob" });
    game.joinClient(ada);
    game.joinClient(bob);
    startGame(game);
    const msg = {
      type: "winner",
      winner: ["player", seat],
      allPlayersStats: {},
    } as const;
    await mockWsOf(ada).emit(msg as any);
    await mockWsOf(bob).emit(msg as any);
    expect(archive).toHaveBeenCalledTimes(1);
    return archived().info;
  }

  it("marks who joined with an account token, and who is a guest", async () => {
    const info = await playThroneRound(
      {
        throneID: "throne-01",
        name: "Vega",
        type: "ffa",
        reign: 0,
        minPlayers: 2,
      },
      true,
    );
    const [ada, bob] = info.players;
    expect(ada).toMatchObject({ username: "Ada", verified: true });
    expect(bob.username).toBe("Bob");
    expect(bob.verified).toBeUndefined();
  });

  it("records the throne with the heir's reign when the heir took the seat", async () => {
    const info = await playThroneRound(
      {
        throneID: "throne-02",
        name: "Deneb",
        type: "team",
        reign: 3,
        minPlayers: 2,
        heir: { persistentID: "pid-ada", name: "Ada" },
      },
      true,
    );
    expect(info.throne).toEqual({
      throneID: "throne-02",
      name: "Deneb",
      type: "team",
      reignBefore: 3,
    });
  });

  it("records a reign of 0 when a claimant, not the heir, holds the seat", async () => {
    const info = await playThroneRound(
      {
        throneID: "throne-02",
        name: "Deneb",
        type: "ffa",
        reign: 3,
        minPlayers: 2,
        heir: { persistentID: "pid-someone-else", name: "Eve" },
      },
      true,
    );
    expect(info.throne?.reignBefore).toBe(0);
  });

  it("records a reign of 0 when the AI held the seat", async () => {
    const info = await playThroneRound(
      {
        throneID: "throne-03",
        name: "Altair",
        type: "ffa",
        reign: 2,
        minPlayers: 2,
      },
      false,
    );
    expect(info.throne?.reignBefore).toBe(0);
  });

  it("has no throne block on a game that is not a throne round", async () => {
    const game = makeGame({
      config: { gameType: GameType.Public, bots: 2 },
      deps: { archive },
    });
    game.joinClient(makeClient());
    startGame(game);
    await game.end();
    expect(archived().info.throne).toBeUndefined();
  });
});
