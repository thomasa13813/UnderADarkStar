import fs from "fs";
import {
  buildThumbnailRGBA,
  COLORS_FILE,
  currentThumbnailColors,
} from "../scripts/mapThumbnailPixels";
import {
  encodeTerrainTile,
  hexToRgb,
} from "../src/client/render/gl/utils/ColorUtils";

describe("map thumbnails", () => {
  test("were drawn with the current terrain colors", () => {
    // Fails when render-settings.json's terrain colors change and the cards
    // were not redrawn. Fix: npx tsx scripts/generateMapThumbnails.ts
    const recorded = JSON.parse(fs.readFileSync(COLORS_FILE, "utf8"));
    expect(recorded).toEqual(currentThumbnailColors());
  });

  test("color land like the game and leave space and void transparent", () => {
    const LAND_PLAINS = 0x80 | 4;
    const LAND_SHORE = 0x80 | 0x40;
    const VOID = 0x80 | 31;
    const WATER = 0x20 | 7;
    // 4×2 map4x → 2×1 thumbnail sampling columns 0 and 2 of row 0.
    const map4x = new Uint8Array([
      LAND_PLAINS,
      WATER,
      WATER,
      VOID,
      LAND_SHORE,
      LAND_SHORE,
      LAND_SHORE,
      LAND_SHORE,
    ]);
    const colors = currentThumbnailColors();
    const { width, height, pixels } = buildThumbnailRGBA(map4x, 4, 2, colors);
    expect([width, height]).toEqual([2, 1]);

    const expected = new Uint8Array(4);
    encodeTerrainTile(LAND_PLAINS, expected, 0, {
      plainsColor: hexToRgb(colors.plainsColor)!,
    });
    expect([...pixels.slice(0, 4)]).toEqual([...expected]);
    expect(pixels[3]).toBe(255);
    expect([...pixels.slice(4, 8)]).toEqual([0, 0, 0, 0]);

    const voidOnly = buildThumbnailRGBA(
      new Uint8Array([VOID, VOID]),
      2,
      1,
      colors,
    );
    expect([...voidOnly.pixels]).toEqual([0, 0, 0, 0]);
  });
});
