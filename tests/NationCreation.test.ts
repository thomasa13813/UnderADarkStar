import lordNames from "../resources/lordNames.json";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
  Nation,
  PlayerType,
} from "../src/core/game/Game";
import {
  createNationsForGame,
  lordNameSupply,
} from "../src/core/game/NationCreation";
import {
  AdditionalNation,
  Nation as ManifestNation,
} from "../src/core/game/TerrainMapLoader";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { GameConfig, GameStartInfo } from "../src/core/Schemas";

// Every Lord is named from the one pool (resources/lordNames.json) at game
// start, whatever the map's manifest calls it (Tom, 2026-10-17): the
// manifest's names and flags never reach the game.

function makeManifestNations(count: number): ManifestNation[] {
  const result: ManifestNation[] = [];
  for (let i = 0; i < count; i++) {
    result.push({
      coordinates: [i, i],
      flag: "ManifestFlag",
      name: `Manifest${i}`,
    });
  }
  return result;
}

function makeAdditionalNations(names: string[]): AdditionalNation[] {
  return names.map((name) => ({ name }));
}

function makeGameStart(
  targetNations: GameConfig["nations"],
  overrides: Partial<GameConfig> = {},
): GameStartInfo {
  const config: GameConfig = {
    gameMap: GameMapType.EventHorizon,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    nations: targetNations,
    donateGold: false,
    donateTroops: false,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    ...overrides,
  };
  return {
    gameID: "test1234",
    lobbyCreatedAt: 0,
    config,
    players: [],
  };
}

function nationNames(nations: Nation[]): string[] {
  return nations.map((n) => n.playerInfo.name);
}

/** Whether a name is one of the pool's fixed names or a star + polity pair. */
function fromPool(name: string): boolean {
  if (lordNames.names.includes(name)) return true;
  return lordNames.stars.some(
    (star) =>
      name.startsWith(`${star} `) &&
      lordNames.polities.includes(name.slice(star.length + 1)),
  );
}

describe("lordNameSupply", () => {
  test("is repeat-free and entirely from the pool for far more Lords than any map has", () => {
    const supply = lordNameSupply(new PseudoRandom(3));
    const names: string[] = [];
    for (let i = 0; i < 500; i++) names.push(supply.next().value as string);
    expect(new Set(names).size).toBe(500);
    for (const name of names) expect(fromPool(name), name).toBe(true);
  });

  test("scatters the fixed names through the first pass of star + polity pairs", () => {
    const supply = lordNameSupply(new PseudoRandom(3));
    const firstPass = lordNames.names.length + lordNames.stars.length;
    const names: string[] = [];
    for (let i = 0; i < firstPass; i++) {
      names.push(supply.next().value as string);
    }
    const fixed = names.filter((n) => lordNames.names.includes(n));
    expect(new Set(fixed)).toEqual(new Set(lordNames.names));
    // Not all bunched at the front: some fixed names sit past the first few.
    const positions = names
      .map((n, i) => (lordNames.names.includes(n) ? i : -1))
      .filter((i) => i >= 0);
    expect(Math.max(...positions)).toBeGreaterThan(lordNames.names.length);
  });

  test("keeps going with numbered names once every pair is spent", () => {
    const supply = lordNameSupply(new PseudoRandom(8));
    const total =
      lordNames.names.length +
      lordNames.stars.length * lordNames.polities.length;
    const names: string[] = [];
    for (let i = 0; i < total + 10; i++) {
      names.push(supply.next().value as string);
    }
    expect(new Set(names).size).toBe(total + 10);
    for (const name of names.slice(total)) {
      expect(name.endsWith(" 2"), name).toBe(true);
      expect(fromPool(name.slice(0, -2)), name).toBe(true);
    }
  });

  test("is deterministic for a seed and differs between seeds", () => {
    const take = (seed: number) =>
      Array.from(
        { length: 20 },
        (
          (s) => () =>
            s.next().value as string
        )(lordNameSupply(new PseudoRandom(seed))),
      );
    expect(take(1)).toEqual(take(1));
    expect(take(1)).not.toEqual(take(2));
  });
});

describe("the Lord pool (resources/lordNames.json)", () => {
  test("holds Tom's fixed names, the stars and the polities, with no duplicates", () => {
    const all = [...lordNames.names, ...lordNames.stars, ...lordNames.polities];
    expect(new Set(all).size).toBe(all.length);
    expect(lordNames.names).toContain("Harbekkan Concord");
    expect(lordNames.names).toContain("Killbot-7");
    expect(lordNames.names).toHaveLength(19);
    for (const name of all) {
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(27);
    }
  });
});

describe("createNationsForGame: names", () => {
  test("names every Lord from the pool, never from the manifest", () => {
    const manifest = makeManifestNations(10);
    const nations = createNationsForGame(
      makeGameStart("default"),
      manifest,
      [],
      0,
      new PseudoRandom(42),
    );
    expect(nations).toHaveLength(10);
    for (const name of nationNames(nations)) {
      expect(name.startsWith("Manifest")).toBe(false);
      expect(fromPool(name), name).toBe(true);
    }
    expect(new Set(nationNames(nations)).size).toBe(10);
  });

  test("ignores additionalNations' names too", () => {
    const manifest = makeManifestNations(1);
    const extras = makeAdditionalNations(["ExtraA", "ExtraB"]);
    const nations = createNationsForGame(
      makeGameStart(3),
      manifest,
      extras,
      0,
      new PseudoRandom(42),
    );
    expect(nations).toHaveLength(3);
    for (const name of nationNames(nations)) {
      expect(fromPool(name), name).toBe(true);
    }
  });

  test("Lords carry no flag, even when the manifest gives one", () => {
    const manifest: ManifestNation[] = [
      { coordinates: [1, 1], name: "Mars", flag: "mars" },
      { coordinates: [2, 2], name: "Terra", flag: "terra" },
    ];
    const nations = createNationsForGame(
      makeGameStart("default"),
      manifest,
      [],
      0,
      new PseudoRandom(1),
    );
    for (const n of nations) {
      expect(n.playerInfo.nationFlag).toBeNull();
      expect(n.playerInfo.playerType).toBe(PlayerType.Nation);
    }
  });

  test("is deterministic for the same seed", () => {
    const manifest = makeManifestNations(6);
    const a = nationNames(
      createNationsForGame(
        makeGameStart("default"),
        manifest,
        [],
        0,
        new PseudoRandom(7),
      ),
    );
    const b = nationNames(
      createNationsForGame(
        makeGameStart("default"),
        manifest,
        [],
        0,
        new PseudoRandom(7),
      ),
    );
    expect(a).toEqual(b);
  });
});

describe("createNationsForGame: count and starting points", () => {
  test("returns no Lords when disabled", () => {
    expect(
      createNationsForGame(
        makeGameStart("disabled"),
        makeManifestNations(5),
        [],
        0,
        new PseudoRandom(1),
      ),
    ).toHaveLength(0);
  });

  test("uses every manifest starting point by default", () => {
    const manifest = makeManifestNations(5);
    const nations = createNationsForGame(
      makeGameStart("default"),
      manifest,
      makeAdditionalNations(["Extra"]),
      0,
      new PseudoRandom(1),
    );
    expect(nations).toHaveLength(5);
    const cells = nations.map((n) => `${n.spawnCell!.x},${n.spawnCell!.y}`);
    expect(new Set(cells)).toEqual(
      new Set(manifest.map((m) => `${m.coordinates![0]},${m.coordinates![1]}`)),
    );
  });

  test("a custom count below the manifest's picks that many manifest starting points", () => {
    const manifest = makeManifestNations(5);
    const nations = createNationsForGame(
      makeGameStart(2),
      manifest,
      makeAdditionalNations(["Extra"]),
      0,
      new PseudoRandom(1),
    );
    expect(nations).toHaveLength(2);
    for (const n of nations) {
      expect(n.spawnCell).toBeDefined();
      expect(n.spawnCell!.x).toBeLessThan(5);
    }
  });

  test("a custom count above the manifest's adds additionalNations' starting points, then random spawns", () => {
    const manifest = makeManifestNations(1);
    const extras: AdditionalNation[] = [
      { name: "WithCoords", coordinates: [42, 99] },
      { name: "WithoutCoords" },
    ];
    const nations = createNationsForGame(
      makeGameStart(4),
      manifest,
      extras,
      0,
      new PseudoRandom(5),
    );
    expect(nations).toHaveLength(4);
    const cells = nations.map((n) =>
      n.spawnCell === undefined
        ? "random"
        : `${n.spawnCell.x},${n.spawnCell.y}`,
    );
    expect(cells[0]).toBe("0,0");
    expect(cells.slice(1, 3).sort()).toEqual(["42,99", "random"]);
    expect(cells[3]).toBe("random");
  });

  test("uses coordinates from manifest nations when provided, undefined when omitted", () => {
    const manifest: ManifestNation[] = [
      { name: "WithCoords", coordinates: [10, 20] },
      { name: "WithoutCoords" },
    ];
    const nations = createNationsForGame(
      makeGameStart("default"),
      manifest,
      [],
      0,
      new PseudoRandom(5),
    );
    expect(nations).toHaveLength(2);
    expect(nations[0].spawnCell?.x).toBe(10);
    expect(nations[0].spawnCell?.y).toBe(20);
    expect(nations[1].spawnCell).toBeUndefined();
  });

  test("a public compact map uses a quarter of the manifest's Lords", () => {
    const nations = createNationsForGame(
      makeGameStart("default", {
        gameType: GameType.Public,
        gameMapSize: GameMapSize.Compact,
      }),
      makeManifestNations(20),
      [],
      0,
      new PseudoRandom(5),
    );
    expect(nations).toHaveLength(5);
    for (const name of nationNames(nations)) {
      expect(fromPool(name), name).toBe(true);
    }
  });

  test("a public Humans vs Lords game matches the Lord count to the humans", () => {
    const nations = createNationsForGame(
      makeGameStart("default", {
        gameType: GameType.Public,
        gameMode: GameMode.Team,
        playerTeams: HumansVsNations,
      }),
      makeManifestNations(3),
      [],
      7,
      new PseudoRandom(5),
    );
    expect(nations).toHaveLength(7);
    expect(nations.filter((n) => n.spawnCell === undefined)).toHaveLength(4);
  });
});
