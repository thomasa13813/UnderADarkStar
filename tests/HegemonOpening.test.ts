import { AttackExecution } from "../src/core/execution/AttackExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  Game,
  GameMapSize,
  GameMapType,
  GameType,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import { GameMapLoader, MapData } from "../src/core/game/GameMapLoader";
import {
  GameUpdateType,
  SpawnPhaseEndUpdate,
} from "../src/core/game/GameUpdates";
import { flightTicks, openingWindowTicks } from "../src/core/game/Opening";
import { loadTerrainMap } from "../src/core/game/TerrainMapLoader";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

// The opening (C3 in docs/DarkStar-Design.md, §6.12): when the spawn phase
// ends the sim fixes the flight window and holds the round until the last
// flight has landed — nothing runs, nothing counts, and the ordinary spawn
// immunity begins only then. The map's own Dark Star (F5) comes from
// info.json.

function human(name: string): PlayerInfo {
  return new PlayerInfo(name, PlayerType.Human, name, name);
}

// Spawn `players` at `tiles` during the spawn phase, then end it from inside
// a tick, as SpawnTimerExecution and a singleplayer spawn do. Two ticks per
// spawn: init, then the spawn lands.
async function openRound(
  game: Game,
  players: PlayerInfo[],
  tiles: number[],
): Promise<SpawnPhaseEndUpdate> {
  players.forEach((p, i) =>
    game.addExecution(new SpawnExecution("game", p, tiles[i])),
  );
  game.executeNextTick();
  game.executeNextTick();
  for (const p of players) {
    expect(game.player(p.id).hasSpawned()).toBe(true);
  }
  let done = false;
  game.addExecution({
    isActive: () => !done,
    activeDuringSpawnPhase: () => true,
    init: () => {},
    tick: () => {
      game.endSpawnPhase();
      done = true;
    },
  });
  game.executeNextTick();
  const updates = game.executeNextTick();
  const end = updates[GameUpdateType.SpawnPhaseEnd][0] as SpawnPhaseEndUpdate;
  expect(end).toBeDefined();
  return end;
}

async function hegemonGame(humans: PlayerInfo[]): Promise<Game> {
  return setup(
    "big_plains",
    { hegemon: { enabled: true }, gameType: GameType.Public },
    humans,
    undefined,
    undefined,
    false,
  );
}

describe("Opening window", () => {
  test("the window is the longest flight from the centre to a spawn tile, and the round begins as it ends", async () => {
    const east = human("east");
    const far = human("far");
    const game = await hegemonGame([east, far]);
    const g = game.darkStar()!;
    const centre = game.ref(g.cx, g.cy);
    const nearTile = game.ref(g.cx + g.radius + g.moatWidth + 20, g.cy);
    const farTile = game.ref(5, 5);
    const endTick = game.ticks();
    const end = await openRound(game, [east, far], [nearTile, farTile]);

    const speed = game.config().hegemonConfig().strikeSpeed;
    const longest = Math.max(
      flightTicks(game.map(), centre, game.player("east").spawnTile()!, speed),
      flightTicks(game.map(), centre, game.player("far").spawnTile()!, speed),
    );
    expect(longest).toBeGreaterThan(5);
    expect(end.openingTicks).toBe(longest);
    expect(game.openingTicks()).toBe(longest);
    // The round's first tick is the landing.
    expect(end.startTick).toBe(endTick + 3 + longest);

    // In the air: the spawn phase is over, the round has not begun.
    expect(game.inSpawnPhase()).toBe(false);
    expect(game.inOpening()).toBe(true);
    for (let t = game.ticks(); t < end.startTick; t++) {
      expect(game.inOpening()).toBe(true);
      expect(game.elapsedGameSeconds()).toBe(0);
      expect(game.isSpawnImmunityActive()).toBe(true);
      expect(game.player("east").isImmune()).toBe(true);
      game.executeNextTick();
    }
    expect(game.inOpening()).toBe(false);
    expect(game.elapsedGameSeconds()).toBe(0);
    // Immunity is 0 in TestConfig: play, and fighting, begin at once.
    expect(game.isSpawnImmunityActive()).toBe(false);
    game.executeNextTick();
    expect(game.elapsedGameSeconds()).toBe(0.1);
  });

  test("nothing runs during the opening; orders queue until the round begins", async () => {
    const east = human("east");
    const game = await hegemonGame([east]);
    const g = game.darkStar()!;
    const spawn = game.ref(g.cx + g.radius + g.moatWidth + 20, g.cy);
    const end = await openRound(game, [east], [spawn]);
    const player = game.player("east");
    game.addExecution(new PlayerExecution(player));
    const troops = player.troops();
    const tiles = player.numTilesOwned();
    // An expansion ordered while the flights are in the air.
    game.addExecution(new AttackExecution(1000, player, null));
    let ran = false;
    game.addExecution({
      isActive: () => !ran,
      activeDuringSpawnPhase: () => false,
      init: () => {},
      tick: () => {
        ran = true;
      },
    });

    while (game.ticks() < end.startTick) {
      game.executeNextTick();
      expect(player.troops()).toBe(troops);
      expect(player.numTilesOwned()).toBe(tiles);
      expect(player.outgoingAttacks()).toHaveLength(0);
      expect(ran).toBe(false);
    }
    // The round's first ticks: income, the queued order and the execution run.
    for (let t = 0; t < 20; t++) game.executeNextTick();
    expect(ran).toBe(true);
    expect(player.troops()).not.toBe(troops);
    expect(player.numTilesOwned()).toBeGreaterThan(tiles);
  });

  test("a spawn already under way still lands during the opening; a late pick does not", async () => {
    const east = human("east");
    const late = human("late");
    const game = await hegemonGame([east, late]);
    const g = game.darkStar()!;
    const spawn = game.ref(g.cx + g.radius + g.moatWidth + 20, g.cy);
    // A spawn queued on the phase's last tick (a nation's final hop) lands.
    game.addExecution(new SpawnExecution("game", east, spawn));
    game.executeNextTick();
    let done = false;
    game.addExecution({
      isActive: () => !done,
      activeDuringSpawnPhase: () => true,
      init: () => {},
      tick: () => {
        game.endSpawnPhase();
        done = true;
      },
    });
    game.executeNextTick();
    game.executeNextTick();
    expect(game.inOpening()).toBe(true);
    expect(game.player("east").hasSpawned()).toBe(true);
    // A client's pick issued during the opening is refused.
    game.addExecution(new SpawnExecution("game", late, game.ref(5, 5), true));
    game.executeNextTick();
    game.executeNextTick();
    expect(game.player("late").hasSpawned()).toBe(false);
  });

  test("the window is capped, and the ordinary immunity follows the landing", async () => {
    expect(openingWindowTicks(12, 0, 150)).toBe(12);
    expect(openingWindowTicks(400, 0, 150)).toBe(150);

    const east = human("east");
    const game = await hegemonGame([east]);
    (game.config() as TestConfig).setSpawnImmunityDuration(30);
    const end = await openRound(game, [east], [game.ref(5, 5)]);
    while (game.ticks() < end.startTick) {
      expect(game.isSpawnImmunityActive()).toBe(true);
      game.executeNextTick();
    }
    // Landed: the 3 s grace only starts now.
    for (let t = 0; t < 30; t++) {
      expect(game.isSpawnImmunityActive()).toBe(true);
      game.executeNextTick();
    }
    expect(game.isSpawnImmunityActive()).toBe(false);
  });

  test("Tribes are on the map from the start and do not lengthen the window", async () => {
    const east = human("east");
    const tribe = new PlayerInfo("tribe", PlayerType.Bot, null, "tribe");
    const game = await hegemonGame([east]);
    const g = game.darkStar()!;
    const nearTile = game.ref(g.cx + g.radius + g.moatWidth + 20, g.cy);
    // The Tribe spawns in the far corner; only the human's flight counts.
    const end = await openRound(
      game,
      [east, tribe],
      [nearTile, game.ref(5, 5)],
    );
    const speed = game.config().hegemonConfig().strikeSpeed;
    expect(end.openingTicks).toBe(
      flightTicks(
        game.map(),
        game.ref(g.cx, g.cy),
        game.player("east").spawnTile()!,
        speed,
      ),
    );
  });

  test("no window outside Hegemon mode: the round begins at once", async () => {
    const east = human("east");
    const game = await setup(
      "big_plains",
      { gameType: GameType.Public },
      [east],
      undefined,
      undefined,
      false,
    );
    const before = game.ticks();
    const end = await openRound(game, [east], [game.ref(5, 5)]);
    expect(end.openingTicks).toBe(0);
    expect(end.startTick).toBe(before + 3);
    expect(game.openingTicks()).toBe(0);
    expect(game.inOpening()).toBe(false);
    expect(game.isSpawnImmunityActive()).toBe(false);
  });
});

describe("The map's own Dark Star", () => {
  test("info.json's centre, radius and moat place the disc", async () => {
    const game = await setup(
      "big_plains",
      { hegemon: { enabled: true } },
      [],
      undefined,
      undefined,
      true,
      [],
      { center: [60, 70], radius: 20, moat: 5 },
    );
    const g = game.darkStar()!;
    expect([g.cx, g.cy, g.radius, g.moatWidth]).toEqual([60, 70, 20, 5]);
    expect(game.isInDarkStar(game.ref(60, 70))).toBe(true);
    expect(game.isInDarkStar(game.ref(80, 70))).toBe(true);
    expect(game.isInDarkStar(game.ref(81, 70))).toBe(false);
    expect(game.isInDarkStar(game.ref(100, 100))).toBe(false);
    expect(game.owner(game.ref(60, 70))).toBe(game.hegemon());
    expect(game.isWater(game.ref(84, 70))).toBe(true); // the moat
    expect(game.isLand(game.ref(86, 70))).toBe(true); // beyond it
    expect(game.hegemon()!.numTilesOwned()).toBe(g.domainTileCount);
  });

  test("the moat falls back to the sizing rule", async () => {
    const game = await setup(
      "big_plains",
      { hegemon: { enabled: true } },
      [],
      undefined,
      undefined,
      true,
      [],
      { center: [100, 100], radius: 30 },
    );
    const g = game.darkStar()!;
    expect(g.radius).toBe(30);
    expect(g.moatWidth).toBe(game.config().hegemonConfig().moatMinTiles);
  });

  test("a Dark Star that does not fit the map is refused", async () => {
    await expect(
      setup(
        "big_plains",
        { hegemon: { enabled: true } },
        [],
        undefined,
        undefined,
        true,
        [],
        { center: [20, 100], radius: 30 },
      ),
    ).rejects.toThrow(/too small to hold a Dark Star/);
  });

  function loaderWith(hegemon: unknown): GameMapLoader {
    const width = 4;
    const height = 4;
    const bin = new Uint8Array(width * height);
    bin[0] = 0x80;
    const manifest = {
      name: "test",
      map: { width, height, num_land_tiles: 1 },
      map4x: { width: 2, height: 2, num_land_tiles: 1 },
      map16x: { width: 1, height: 1, num_land_tiles: 1 },
      nations: [],
      hegemon,
    };
    const mapData: MapData = {
      mapBin: () => Promise.resolve(bin),
      map4xBin: () => Promise.resolve(bin.subarray(0, 4)),
      map16xBin: () => Promise.resolve(bin.subarray(0, 1)),
      manifest: () => Promise.resolve(manifest as never),
      webpPath: "",
      layerPng: () => Promise.reject(new Error("no layers")),
    };
    return { getMapData: () => mapData };
  }

  test("the manifest's Dark Star reaches the loaded map, halved on a compact map", async () => {
    const override = { center: [901, 900], radius: 163, moat: 19 };
    const normal = await loadTerrainMap(
      GameMapType.Passage,
      GameMapSize.Normal,
      loaderWith(override),
      false,
    );
    expect(normal.hegemon).toEqual(override);
    const compact = await loadTerrainMap(
      GameMapType.Passage,
      GameMapSize.Compact,
      loaderWith(override),
      false,
    );
    expect(compact.hegemon).toEqual({
      center: [450, 450],
      radius: 81,
      moat: 9,
    });
    const none = await loadTerrainMap(
      GameMapType.Sierpinski,
      GameMapSize.Normal,
      loaderWith(undefined),
      false,
    );
    expect(none.hegemon).toBeUndefined();
  });

  test("a malformed manifest entry is refused", async () => {
    await expect(
      loadTerrainMap(
        GameMapType.ChoppingBlock,
        GameMapSize.Normal,
        loaderWith({ center: [1], radius: 5 }),
        false,
      ),
    ).rejects.toThrow(/"hegemon" must be/);
  });
});
