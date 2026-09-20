import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  computeDarkStarGeometry,
  generateDarkStarTerrain,
  HEGEMON_AI_NAME,
  isInDarkStar,
  isInDarkStarOrMoat,
} from "../../../src/core/game/DarkStar";
import { Game, PlayerType } from "../../../src/core/game/Game";
import { GameMap, GameMapImpl } from "../../../src/core/game/GameMap";
import {
  genTerrainFromBin,
  MapManifest,
} from "../../../src/core/game/TerrainMapLoader";
import { setup } from "../../util/Setup";

const mapsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../testdata/maps",
);

// The shipped sizing (HEGEMON_DEFAULTS in Config.ts).
const SIZING = {
  domainRadiusPermille: 90,
  moatWidthPermille: 10,
  moatMinTiles: 15,
};

async function pristine(
  mapName: string,
  file: "map" | "map4x" = "map",
): Promise<GameMap> {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(mapsDir, mapName, "manifest.json"), "utf8"),
  ) satisfies MapManifest;
  return genTerrainFromBin(
    manifest[file],
    fs.readFileSync(path.join(mapsDir, mapName, `${file}.bin`)),
  );
}

function hegemonGame(mapName: string): Promise<Game> {
  return setup(mapName, { hegemon: { enabled: true } });
}

describe("Dark Star geometry", () => {
  test("is whole tiles, floored once from the shorter side", () => {
    // Milky Way is 1748x1748.
    const g = computeDarkStarGeometry(1748, 1748, SIZING);
    expect(g).toMatchObject({
      cx: 874,
      cy: 874,
      radius: 157,
      moatWidth: 17,
      rSq: 157 * 157,
      outerSq: 174 * 174,
    });
    // A wide map sizes off its height; a small one gets the minimum moat.
    const wide = computeDarkStarGeometry(2000, 1000, SIZING);
    expect(wide).toMatchObject({ cx: 1000, cy: 500, radius: 90 });
    expect(wide.moatWidth).toBe(15);
  });

  test("counts the lattice points of the disc", () => {
    const g = computeDarkStarGeometry(200, 200, SIZING);
    let count = 0;
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 200; x++) {
        if (isInDarkStar(g, x, y)) count++;
      }
    }
    expect(g.domainTileCount).toBe(count);
  });

  test("refuses a map too small to hold it", () => {
    expect(() => computeDarkStarGeometry(16, 16, SIZING)).toThrow(/too small/);
  });
});

describe("Dark Star terrain", () => {
  test("disc is Hegemon land, moat is unowned water, the rest is untouched", async () => {
    const game = await hegemonGame("big_plains");
    const before = await pristine("big_plains");
    const g = game.darkStar()!;
    const hegemon = game.hegemon()!;
    expect(hegemon.name()).toBe(HEGEMON_AI_NAME);
    expect(hegemon.isHegemon()).toBe(true);
    expect(hegemon.type()).toBe(PlayerType.Nation);

    let ring = 0;
    game.forEachTile((tile) => {
      const x = game.x(tile);
      const y = game.y(tile);
      if (isInDarkStar(g, x, y)) {
        expect(game.isLand(tile)).toBe(true);
        expect(game.isImpassable(tile)).toBe(false);
        expect(game.owner(tile)).toBe(hegemon);
        expect(game.isInDarkStar(tile)).toBe(true);
      } else if (isInDarkStarOrMoat(g, x, y)) {
        ring++;
        expect(game.isWater(tile)).toBe(true);
        expect(game.hasOwner(tile)).toBe(false);
        expect(game.isInDarkStar(tile)).toBe(false);
      } else {
        expect(game.hasOwner(tile)).toBe(false);
        // Land beyond the moat's outer shore keeps its byte exactly.
        const onOuterShore = game
          .neighbors(tile)
          .some((n) => isInDarkStarOrMoat(g, game.x(n), game.y(n)));
        if (!onOuterShore) {
          expect(game.terrainByte(tile)).toBe(before.terrainByte(tile));
        }
      }
    });

    expect(hegemon.numTilesOwned()).toBe(g.domainTileCount);
    // big_plains is all land, so only the moat was lost.
    expect(game.numLandTiles()).toBe(before.numLandTiles() - ring);
  });

  test("both shores carry the shoreline bit, the disc interior does not", async () => {
    const game = await hegemonGame("big_plains");
    const g = game.darkStar()!;
    game.forEachTile((tile) => {
      if (!isInDarkStarOrMoat(g, game.x(tile), game.y(tile))) return;
      const touchesOpposite = game
        .neighbors(tile)
        .some((n) => game.isLand(n) !== game.isLand(tile));
      expect(game.isShoreline(tile)).toBe(touchesOpposite);
    });
    expect(game.isShore(game.ref(g.cx + g.radius, g.cy))).toBe(true);
    expect(game.isShoreline(game.ref(g.cx, g.cy))).toBe(false);
  });

  test("fills water and joins the moat to an ocean it touches", async () => {
    // world's centre (1000, 500) sits on the Gulf of Guinea coast.
    const before = await pristine("world");
    const mini = await pristine("world", "map4x");
    const g = computeDarkStarGeometry(before.width(), before.height(), SIZING);
    let waterInDisc = 0;
    before.forEachTile((tile) => {
      if (
        isInDarkStar(g, before.x(tile), before.y(tile)) &&
        before.isWater(tile)
      ) {
        waterInDisc++;
      }
    });
    expect(waterInDisc).toBeGreaterThan(0);

    const { domainTiles } = generateDarkStarTerrain(before, mini, g);
    expect(domainTiles.length).toBe(g.domainTileCount);
    for (const tile of domainTiles) {
      expect(before.isLand(tile)).toBe(true);
    }
    expect(before.isOcean(before.ref(g.cx + g.radius + 5, g.cy))).toBe(true);
  });

  test("a landlocked moat is a lake, not ocean", async () => {
    const game = await hegemonGame("big_plains");
    const g = game.darkStar()!;
    const moatTile = game.ref(g.cx + g.radius + 5, g.cy);
    expect(game.isWater(moatTile)).toBe(true);
    expect(game.isOcean(moatTile)).toBe(false);
  });

  test("is idempotent (terrain maps are cached per process)", async () => {
    const map = await pristine("world");
    const mini = await pristine("world", "map4x");
    const g = computeDarkStarGeometry(map.width(), map.height(), SIZING);
    generateDarkStarTerrain(map, mini, g);
    const bytes: number[] = [];
    map.forEachTile((t) => bytes.push(map.terrainByte(t)));
    const miniBytes: number[] = [];
    mini.forEachTile((t) => miniBytes.push(mini.terrainByte(t)));
    const landTiles = map.numLandTiles();

    const second = generateDarkStarTerrain(map, mini, g);
    expect(second.changed).toEqual([]);
    expect(map.numLandTiles()).toBe(landTiles);
    let same = true;
    map.forEachTile((t) => (same &&= map.terrainByte(t) === bytes[t]));
    mini.forEachTile((t) => (same &&= mini.terrainByte(t) === miniBytes[t]));
    expect(same).toBe(true);
  });

  test("the minimap follows: water over the moat, land over the disc", async () => {
    const map = await pristine("big_plains");
    const mini = await pristine("big_plains", "map4x");
    const g = computeDarkStarGeometry(map.width(), map.height(), SIZING);
    generateDarkStarTerrain(map, mini, g);
    expect(mini.isLand(mini.ref(g.cx >> 1, g.cy >> 1))).toBe(true);
    const moatX = (g.cx + g.radius + 5) >> 1;
    expect(mini.isWater(mini.ref(moatX, g.cy >> 1))).toBe(true);
    // Far corner untouched.
    expect(mini.isLand(mini.ref(0, 0))).toBe(true);
  });

  test("off by default: no Dark Star, no Hegemon, pristine terrain", async () => {
    const game = await setup("big_plains");
    const before = await pristine("big_plains");
    expect(game.darkStar()).toBeNull();
    expect(game.hegemon()).toBeNull();
    expect(game.allPlayers()).toHaveLength(0);
    expect(game.isInDarkStar(game.ref(100, 100))).toBe(false);
    expect(game.numLandTiles()).toBe(before.numLandTiles());
  });

  test("clients rebuild the Dark Star from the first tick's tile updates", async () => {
    const game = await hegemonGame("big_plains");
    const g = game.darkStar()!;
    const before = await pristine("big_plains");
    const client = new GameMapImpl(
      before.width(),
      before.height(),
      Uint8Array.from({ length: before.width() * before.height() }, (_, t) =>
        before.terrainByte(t),
      ),
      before.numLandTiles(),
    );

    game.executeNextTick();
    const first = game.drainPackedTileUpdates();
    expect(first.length / 2).toBeGreaterThanOrEqual(g.domainTileCount);
    for (let i = 0; i < first.length; i += 2) {
      client.updateTile(first[i], first[i + 1]);
    }
    game.forEachTile((tile) => {
      expect(client.terrainByte(tile)).toBe(game.terrainByte(tile));
      expect(client.ownerID(tile)).toBe(game.ownerID(tile));
    });
    expect(client.numLandTiles()).toBe(game.numLandTiles());

    // Sent once only.
    game.executeNextTick();
    expect(game.drainPackedTileUpdates().length).toBe(0);
  });
});
