/**
 * The deep-space look: water tiles baked translucent so the starfield drawn
 * under the map shows through, and the starfield's cover/tile UV mapping.
 */
import { describe, expect, test } from "vitest";
import { StarfieldPass } from "../src/client/render/gl/passes/StarfieldPass";
import renderDefaults from "../src/client/render/gl/render-settings.json";
import { applyGraphicsOverrides } from "../src/client/render/gl/RenderOverrides";
import { createRenderSettings } from "../src/client/render/gl/RenderSettings";
import {
  encodeTerrainTile,
  hexToRgb,
} from "../src/client/render/gl/utils/ColorUtils";

// Terrain byte layout: bit 7 land, bit 6 shoreline, bit 5 ocean, bits 0-4 magnitude.
const DEEP_WATER = 0x20 | 4; // ocean, depth 4
const SHORE_WATER = 0x40 | 0x20; // shoreline water
const LAND_PLAINS = 0x80 | 3;
const IMPASSABLE = 0x80 | 31;

function encode(tb: number, colors?: Parameters<typeof encodeTerrainTile>[3]) {
  const out = new Uint8Array(4);
  encodeTerrainTile(tb, out, 0, colors);
  return Array.from(out);
}

describe("water alpha in encodeTerrainTile", () => {
  test("defaults to opaque water (classic look)", () => {
    expect(encode(DEEP_WATER)[3]).toBe(255);
    expect(encode(SHORE_WATER)[3]).toBe(255);
  });

  test("deep water takes the requested alpha, colour unchanged", () => {
    const opaque = encode(DEEP_WATER);
    const translucent = encode(DEEP_WATER, { waterAlpha: 115 });
    expect(translucent.slice(0, 3)).toEqual(opaque.slice(0, 3));
    expect(translucent[3]).toBe(115);
  });

  test("shoreline water is a step more opaque so coastlines read", () => {
    const deep = encode(DEEP_WATER, { waterAlpha: 100 })[3];
    const shore = encode(SHORE_WATER, { waterAlpha: 100 })[3];
    expect(shore).toBeGreaterThan(deep);
    expect(shore).toBeLessThan(255);
    // 100 + 0.3 * (255 - 100)
    expect(shore).toBe(147);
  });

  test("fully transparent water is still more opaque at the shore", () => {
    expect(encode(DEEP_WATER, { waterAlpha: 0 })[3]).toBe(0);
    expect(encode(SHORE_WATER, { waterAlpha: 0 })[3]).toBe(77);
  });

  test("land and void stay opaque whatever the water alpha", () => {
    expect(encode(LAND_PLAINS, { waterAlpha: 0 })[3]).toBe(255);
    expect(encode(IMPASSABLE, { waterAlpha: 0 })[3]).toBe(255);
    const [r, g, b] = hexToRgb(renderDefaults.terrain.backgroundColor)!;
    expect(encode(IMPASSABLE, { waterAlpha: 0 }).slice(0, 3)).toEqual([
      r,
      g,
      b,
    ]);
  });

  test("out-of-range alpha is clamped", () => {
    expect(encode(DEEP_WATER, { waterAlpha: 999 })[3]).toBe(255);
    expect(encode(DEEP_WATER, { waterAlpha: -5 })[3]).toBe(0);
  });
});

describe("space background settings", () => {
  test("defaults ship the starfield on with translucent water", () => {
    expect(renderDefaults.terrain.spaceBackground).toBe(true);
    expect(renderDefaults.terrain.oceanAlpha).toBeGreaterThan(0);
    expect(renderDefaults.terrain.oceanAlpha).toBeLessThan(1);
  });

  test("overrides can switch the starfield off and set the opacity", () => {
    const settings = createRenderSettings();
    applyGraphicsOverrides(settings, {
      terrain: { spaceBackground: false, oceanAlpha: 0.8 },
    });
    expect(settings.terrain.spaceBackground).toBe(false);
    expect(settings.terrain.oceanAlpha).toBe(0.8);
  });

  test("absent overrides keep the defaults", () => {
    const settings = createRenderSettings();
    applyGraphicsOverrides(settings, { terrain: { oceanColor: "#000000" } });
    expect(settings.terrain.spaceBackground).toBe(
      renderDefaults.terrain.spaceBackground,
    );
    expect(settings.terrain.oceanAlpha).toBe(renderDefaults.terrain.oceanAlpha);
  });
});

describe("StarfieldPass.uvTransform", () => {
  test("cover-fit a wide map: full image width, height cropped and centred", () => {
    // 640×360 image over a 2000×500 map → scale by width (3.125×); the image
    // is 1125 tiles tall, so the map sees the middle 500/1125 of it.
    const { scale, offset } = StarfieldPass.uvTransform(2000, 500, 640, 360);
    expect(scale[0]).toBeCloseTo(1);
    expect(scale[1]).toBeCloseTo(500 / 1125);
    expect(offset[0]).toBeCloseTo(0);
    expect(offset[1]).toBeCloseTo(0.5 * (1 - 500 / 1125));
  });

  test("cover-fit a tall map: full image height, width cropped and centred", () => {
    const { scale, offset } = StarfieldPass.uvTransform(500, 2000, 640, 360);
    expect(scale[1]).toBeCloseTo(1);
    expect(scale[0]).toBeCloseTo(500 / ((2000 / 360) * 640));
    expect(offset[1]).toBeCloseTo(0);
    expect(offset[0]).toBeCloseTo(0.5 * (1 - scale[0]));
  });

  test("the covered area's centre is the map's centre", () => {
    const { scale, offset } = StarfieldPass.uvTransform(2000, 500, 640, 360);
    expect(0.5 * scale[0] + offset[0]).toBeCloseTo(0.5);
    expect(0.5 * scale[1] + offset[1]).toBeCloseTo(0.5);
  });
});
