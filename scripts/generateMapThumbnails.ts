/**
 * Draws each map's picker / lobby-card thumbnail from its terrain with the
 * game's own terrain colors, so the cards always match what the map looks
 * like in game:
 *
 *   resources/maps/<folder>/thumbnail.webp   450×450 for a 1800×1800 map
 *
 * Land is colored by `encodeTerrainTile()` (src/client/render/gl/utils/
 * ColorUtils.ts) with the `terrain` defaults in render-settings.json, the
 * same rule TerrainPass uses. Deep space and impassable void stay transparent,
 * as they always have, so the card's own background shows through. The image
 * is map4x sampled at every second tile (half of map4x, the size the Go
 * map-generator used to write).
 *
 *   npx tsx scripts/generateMapThumbnails.ts               # every map
 *   npx tsx scripts/generateMapThumbnails.ts eventhorizon  # named folders
 *   npx tsx scripts/generateMapThumbnails.ts --check       # verify, write nothing
 *
 * The map kit (`npm run map`) runs this after the Go map-generator, which
 * still writes its own green thumbnail first.
 *
 * Encoding uses the Chromium that Playwright ships (lossless WebP), as
 * generateSpriteAtlases.ts does for its icons. The colors used are recorded in
 * scripts/map-thumbnail-colors.json; tests/MapThumbnails.test.ts fails when
 * render-settings.json's terrain colors change without a rerun.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import renderDefaults from "../src/client/render/gl/render-settings.json";
import {
  encodeTerrainTile,
  hexToRgb,
  TerrainColorOverrides,
} from "../src/client/render/gl/utils/ColorUtils";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAPS = path.join(ROOT, "resources", "maps");
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

type Browser = import("playwright").Browser;

async function encodeWebp(
  browser: Browser,
  img: { width: number; height: number; pixels: Uint8Array },
): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    const b64 = await page.evaluate(
      async ({ width, height, data }) => {
        const bytes = Uint8ClampedArray.from(atob(data), (c) =>
          c.charCodeAt(0),
        );
        const canvas = new OffscreenCanvas(width, height);
        canvas
          .getContext("2d")!
          .putImageData(new ImageData(bytes, width, height), 0, 0);
        // quality 1 is lossless in Chromium (checked pixel-for-pixel).
        const blob = await canvas.convertToBlob({
          type: "image/webp",
          quality: 1,
        });
        const out = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (const v of out) s += String.fromCharCode(v);
        return btoa(s);
      },
      {
        width: img.width,
        height: img.height,
        data: Buffer.from(img.pixels).toString("base64"),
      },
    );
    return Buffer.from(b64, "base64");
  } finally {
    await page.close();
  }
}

function readColorsFile(): ThumbnailColors | null {
  if (!fs.existsSync(COLORS_FILE)) return null;
  return JSON.parse(fs.readFileSync(COLORS_FILE, "utf8")) as ThumbnailColors;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const named = args.filter((a) => !a.startsWith("--"));
  const colors = currentThumbnailColors();

  if (check) {
    const recorded = readColorsFile();
    if (JSON.stringify(recorded) !== JSON.stringify(colors)) {
      console.error(
        "Map thumbnails are out of date with render-settings.json's terrain " +
          "colors. Run: npx tsx scripts/generateMapThumbnails.ts",
      );
      process.exit(1);
    }
    console.log("Map thumbnails match the terrain colors.");
    return;
  }

  const folders =
    named.length > 0
      ? named
      : fs
          .readdirSync(MAPS)
          .filter((f) => fs.existsSync(path.join(MAPS, f, "map4x.bin")));
  for (const f of folders) {
    if (!fs.existsSync(path.join(MAPS, f, "map4x.bin"))) {
      throw new Error(`No map4x.bin in resources/maps/${f}`);
    }
  }

  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error(
      "Thumbnails are encoded with Playwright's Chromium, which is not " +
        "installed: npm i --no-save playwright && npx playwright install chromium",
    );
  }
  const browser = await playwright.chromium.launch();
  try {
    for (const folder of folders) {
      const dir = path.join(MAPS, folder);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
      ) as { map4x: { width: number; height: number } };
      const map4x = new Uint8Array(
        fs.readFileSync(path.join(dir, "map4x.bin")),
      );
      const img = buildThumbnailRGBA(
        map4x,
        manifest.map4x.width,
        manifest.map4x.height,
        colors,
      );
      const webp = await encodeWebp(browser, img);
      fs.writeFileSync(path.join(dir, "thumbnail.webp"), webp);
      console.log(
        `${folder}: ${img.width}×${img.height}, ${(webp.length / 1024).toFixed(1)} KB`,
      );
    }
  } finally {
    await browser.close();
  }
  // Record the colors only after a full run, so a partial run (one new map)
  // can't mark every other thumbnail as current.
  if (named.length === 0) {
    fs.writeFileSync(COLORS_FILE, JSON.stringify(colors, null, 2) + "\n");
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
