/**
 * The pixels of a map thumbnail, without the WebP encoding: the part of
 * scripts/generateMapThumbnails.ts that tests can load. That script needs
 * Playwright, which is not a dependency (CI and the build don't install it),
 * so nothing that tsc or vitest reaches may import it.
 */

import path from "path";
import { fileURLToPath } from "url";
import renderDefaults from "../src/client/render/gl/render-settings.json";
import {
  encodeTerrainTile,
  hexToRgb,
  TerrainColorOverrides,
} from "../src/client/render/gl/utils/ColorUtils";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MAPS = path.join(ROOT, "resources", "maps");
export const COLORS_FILE = path.join(
  ROOT,
  "scripts",
  "map-thumbnail-colors.json",
);

/** The terrain colors a thumbnail is drawn with (land only; space is clear). */
export interface ThumbnailColors {
  sandColor: string;
  plainsColor: string;
  highlandColor: string;
  mountainColor: string;
}

export function currentThumbnailColors(): ThumbnailColors {
  const t = renderDefaults.terrain;
  return {
    sandColor: t.sandColor.toLowerCase(),
    plainsColor: t.plainsColor.toLowerCase(),
    highlandColor: t.highlandColor.toLowerCase(),
    mountainColor: t.mountainColor.toLowerCase(),
  };
}

/**
 * RGBA pixels for a thumbnail of half map4x's size. Land tiles take
 * encodeTerrainTile's color, opaque; water and impassable void are
 * transparent black.
 */
export function buildThumbnailRGBA(
  map4x: Uint8Array,
  width4x: number,
  height4x: number,
  colors: ThumbnailColors,
): { width: number; height: number; pixels: Uint8Array } {
  const overrides: TerrainColorOverrides = {
    sandColor: hexToRgb(colors.sandColor)!,
    plainsColor: hexToRgb(colors.plainsColor)!,
    highlandColor: hexToRgb(colors.highlandColor)!,
    mountainColor: hexToRgb(colors.mountainColor)!,
  };
  const width = Math.max(1, Math.floor(width4x / 2));
  const height = Math.max(1, Math.floor(height4x / 2));
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tb = map4x[y * 2 * width4x + x * 2];
      const isLand = (tb & 0x80) !== 0;
      const impassable = isLand && (tb & 0x1f) === 31;
      if (!isLand || impassable) continue; // stays transparent
      encodeTerrainTile(tb, pixels, (y * width + x) * 4, overrides);
    }
  }
  return { width, height, pixels };
}
