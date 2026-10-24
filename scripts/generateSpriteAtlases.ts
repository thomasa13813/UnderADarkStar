/**
 * Builds the sprite atlases the WebGL passes sample from `resources/sprites/`
 * and `resources/images/`:
 *
 *   resources/atlases/unit-atlas.png      UnitPass       (UNIT_COLUMNS below)
 *   resources/atlases/icon-atlas.png      StructurePass  (ICON_COLUMNS below)
 *   resources/atlases/fx-atlas.png        FxSpritePass   (FX_ROWS below)
 *   resources/atlases/fx-atlas-meta.json  FxSpritePass
 *
 * The column / row orders here are the atlas contract: they MUST match
 * UNIT_ORDER in src/client/render/gl/passes/UnitPass.ts, STRUCTURE_ORDER in
 * StructurePass.ts + StructureLevelPass.ts, and the FX_* indices in
 * fx-pass/FxSpritePass.ts. Adding a sprite means appending an entry here and
 * to the matching list in the pass, then running this script (see the
 * "Adding a unit type" checklist in src/client/render/CLAUDE.md).
 *
 *   npx tsx scripts/generateSpriteAtlases.ts            # rebuild what changed
 *   npx tsx scripts/generateSpriteAtlases.ts --check    # verify, write nothing
 *   npx tsx scripts/generateSpriteAtlases.ts --rerender-icons
 *   npx tsx scripts/generateSpriteAtlases.ts --rerender-icon=City  # one column
 *
 * Unit and fx atlases are plain PNG composites and rebuild pixel-for-pixel
 * from their sprites. Icon cells are anti-aliased SVG renders, and no two
 * rasterisers agree to the pixel, so an icon column that already exists in
 * the committed atlas is COPIED from it unchanged; only new columns (or all of
 * them with --rerender-icons, or the named one with --rerender-icon=<name>) are
 * rendered, with the Chromium that Playwright ships (`npx playwright install
 * chromium` if missing). A file whose pixels
 * did not change is left untouched, so a rebuild never churns git.
 *
 * No dependencies beyond node: the PNG codec below is enough for the flat
 * RGBA / palette sprites we have.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { deflateSync, inflateSync } from "zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPRITES = path.join(ROOT, "resources", "sprites");
const IMAGES = path.join(ROOT, "resources", "images");
const ATLASES = path.join(ROOT, "resources", "atlases");

// ---------------------------------------------------------------------------
// The atlas contracts
// ---------------------------------------------------------------------------

/** Unit atlas: one 13×13 cell per column, sprite centred (cropped if larger).
 *  Order = UNIT_ORDER in UnitPass.ts. Sprites are grayscale bands the unit
 *  shader recolours (180 territory / 130 mid / 100 centre / 70 border).
 *  The `gl/` sprites are the GL renderer's own small glyphs (the legacy HUD
 *  sprites of the same name are larger and are still used by SpriteLoader). */
const UNIT_CELL = 13;
type UnitColumn =
  | { name: string; sprite: string }
  | { name: string; square: number }; // programmatic white square
const UNIT_COLUMNS: UnitColumn[] = [
  { name: "Transport", sprite: "transportship.png" },
  { name: "Trade Ship", sprite: "tradeship.png" },
  { name: "Warship", sprite: "gl/warship.png" },
  { name: "Atom Bomb", sprite: "gl/atombomb.png" },
  { name: "Hydrogen Bomb", sprite: "gl/hydrogenbomb.png" },
  { name: "MIRV", sprite: "gl/mirv.png" },
  { name: "SAMMissile", sprite: "gl/samMissile.png" },
  { name: "Shell", square: 1 },
  { name: "MIRV Warhead", square: 3 },
  { name: "TrainEngine", sprite: "trainEngine.png" },
  { name: "TrainCarriage", sprite: "trainCarriage.png" },
  { name: "TrainCarriageLoaded", sprite: "trainCarriageLoaded.png" },
  // DarkStar: the strike / stargate-shot projectile (the atom bomb glyph for now).
  { name: "Projectile", sprite: "gl/projectile.png" },
  // DarkStar: the army, a pixel star (Tom, 2026-10-23).
  { name: "Army", sprite: "gl/army.png" },
];

/** Icon atlas: one 64×64 cell per column, the SVG rendered white at 48×48
 *  and centred, or a ready-made 64×64 PNG cell (the committed silo glyph came
 *  from an asset that is not in the repo, so it is kept as pixels).
 *  Order = STRUCTURE_ORDER in StructurePass.ts. */
const ICON_CELL = 64;
const ICON_GLYPH = 48;
type IconColumn = { name: string; svg: string } | { name: string; png: string };
const ICON_COLUMNS: IconColumn[] = [
  { name: "City", svg: "PopulationCenterIconWhite.svg" },
  { name: "Port", svg: "PortIcon.svg" },
  { name: "Factory", svg: "FactoryIconWhite.svg" },
  { name: "Defense Post", svg: "ShieldIconWhite.svg" },
  { name: "SAM Launcher", svg: "SamLauncherIconWhite.svg" },
  { name: "Missile Silo", png: "gl/missileSiloIcon.png" },
  // DarkStar: the stargate (C4), a placeholder ring for now.
  { name: "Stargate", svg: "StargateIconWhite.svg" },
  // DarkStar: the shield array (C5), a crenelated generator under its dome.
  { name: "Shield Array", svg: "ShieldArrayIconWhite.svg" },
];

/** Fx atlas: horizontal sprite strips stacked top to bottom, left-aligned.
 *  Order = FX_* indices in FxSpritePass.ts; frameWidth = FX_CONFIG. */
const FX_ROWS: { name: string; sprite: string; frameWidth: number }[] = [
  { name: "Nuke", sprite: "nukeExplosion.png", frameWidth: 60 },
  { name: "SAMExplosion", sprite: "samExplosion.png", frameWidth: 48 },
  {
    name: "BuildingExplosion",
    sprite: "buildingExplosion.png",
    frameWidth: 17,
  },
  { name: "UnitExplosion", sprite: "unitExplosion.png", frameWidth: 19 },
  { name: "MiniExplosion", sprite: "miniExplosion.png", frameWidth: 13 },
  { name: "SinkingShip", sprite: "sinkingShip.png", frameWidth: 16 },
  { name: "MiniFire", sprite: "minifire.png", frameWidth: 7 },
  { name: "MiniSmoke", sprite: "smoke.png", frameWidth: 11 },
  { name: "MiniBigSmoke", sprite: "bigsmoke.png", frameWidth: 24 },
  { name: "MiniSmokeFire", sprite: "smokeAndFire.png", frameWidth: 24 },
  { name: "Dust", sprite: "dust.png", frameWidth: 9 },
  { name: "Conquest", sprite: "conquestSword.png", frameWidth: 21 },
];

// ---------------------------------------------------------------------------
// Minimal PNG codec (RGBA8 out; any bit depth / colour type in)
// ---------------------------------------------------------------------------

interface Image {
  width: number;
  height: number;
  rgba: Uint8Array; // straight alpha; fully transparent pixels are 0,0,0,0
}

function blank(width: number, height: number): Image {
  return { width, height, rgba: new Uint8Array(width * height * 4) };
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf: Uint8Array): number {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(file: Buffer): Image {
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  let colorType = 6;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos < file.length) {
    const len = file.readUInt32BE(pos);
    const type = file.toString("ascii", pos + 4, pos + 8);
    const data = file.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNGs are not supported");
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "tRNS") trns = Buffer.from(data);
    else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === undefined) throw new Error(`colour type ${colorType}`);
  const bpp = Math.max(1, Math.ceil((channels * depth) / 8));
  const stride = Math.ceil((width * channels * depth) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  const rows = new Uint8Array(height * stride);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      cur[i] = v & 0xff;
    }
    rows.set(cur, y * stride);
    prev = cur;
  }
  const img = blank(width, height);
  const max = (1 << depth) - 1;
  const pixel = (x: number, y: number): [number, number, number, number] => {
    if (colorType === 3) {
      const bit = x * depth;
      const byte = rows[y * stride + (bit >> 3)];
      const idx = (byte >> (8 - depth - (bit & 7))) & max;
      const a = trns !== null && idx < trns.length ? trns[idx] : 255;
      return [
        palette![idx * 3],
        palette![idx * 3 + 1],
        palette![idx * 3 + 2],
        a,
      ];
    }
    if (depth !== 8) {
      throw new Error(
        `unsupported PNG: colour type ${colorType}, ${depth} bit`,
      );
    }
    const i = y * stride + x * channels;
    switch (colorType) {
      case 6:
        return [rows[i], rows[i + 1], rows[i + 2], rows[i + 3]];
      case 2:
        return [rows[i], rows[i + 1], rows[i + 2], 255];
      case 4:
        return [rows[i], rows[i], rows[i], rows[i + 1]];
      default:
        return [rows[i], rows[i], rows[i], 255];
    }
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      if (a === 0) continue; // stays 0,0,0,0
      const o = (y * width + x) * 4;
      img.rgba[o] = r;
      img.rgba[o + 1] = g;
      img.rgba[o + 2] = b;
      img.rgba[o + 3] = a;
    }
  }
  return img;
}

export function encodePng(img: Image): Buffer {
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(
      img.rgba.subarray(y * stride, (y + 1) * stride),
      y * (stride + 1) + 1,
    );
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Compositing
// ---------------------------------------------------------------------------

/** Copies `src` onto `dst` with its top-left at (dx, dy); parts outside the
 *  clip rectangle are dropped. Straight copy, no blending. */
function blit(
  dst: Image,
  src: Image,
  dx: number,
  dy: number,
  clip: { x: number; y: number; w: number; h: number },
): void {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < clip.y || ty >= clip.y + clip.h) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < clip.x || tx >= clip.x + clip.w) continue;
      const s = (y * src.width + x) * 4;
      const d = (ty * dst.width + tx) * 4;
      dst.rgba[d] = src.rgba[s];
      dst.rgba[d + 1] = src.rgba[s + 1];
      dst.rgba[d + 2] = src.rgba[s + 2];
      dst.rgba[d + 3] = src.rgba[s + 3];
    }
  }
}

function centred(cell: number, size: number): number {
  return Math.floor((cell - size) / 2);
}

function readSprite(name: string): Image {
  return decodePng(fs.readFileSync(path.join(SPRITES, name)));
}

function buildUnitAtlas(): Image {
  const atlas = blank(UNIT_CELL * UNIT_COLUMNS.length, UNIT_CELL);
  UNIT_COLUMNS.forEach((col, i) => {
    const clip = { x: i * UNIT_CELL, y: 0, w: UNIT_CELL, h: UNIT_CELL };
    const src =
      "sprite" in col ? readSprite(col.sprite) : whiteSquare(col.square);
    blit(
      atlas,
      src,
      clip.x + centred(UNIT_CELL, src.width),
      centred(UNIT_CELL, src.height),
      clip,
    );
  });
  return atlas;
}

function whiteSquare(size: number): Image {
  const img = blank(size, size);
  img.rgba.fill(255);
  return img;
}

function buildFxAtlas(): { image: Image; meta: object } {
  const strips = FX_ROWS.map((row) => readSprite(row.sprite));
  const width = Math.max(...strips.map((s) => s.width));
  const height = strips.reduce((sum, s) => sum + s.height, 0);
  const atlas = blank(width, height);
  const rows: object[] = [];
  let y = 0;
  strips.forEach((strip, i) => {
    blit(atlas, strip, 0, y, { x: 0, y, w: strip.width, h: strip.height });
    rows.push({
      yOffset: y,
      height: strip.height,
      worldWidth: FX_ROWS[i].frameWidth,
      worldHeight: strip.height,
    });
    y += strip.height;
  });
  return { image: atlas, meta: { width, height, rows } };
}

/** Icon columns come from the committed atlas where it has them (see the
 *  header), otherwise from a Chromium render of the SVG. */
async function buildIconAtlas(
  existing: Image | null,
  rerender: (name: string) => boolean,
): Promise<Image> {
  const atlas = blank(ICON_CELL * ICON_COLUMNS.length, ICON_CELL);
  const toRender: number[] = [];
  ICON_COLUMNS.forEach((col, i) => {
    const clip = { x: i * ICON_CELL, y: 0, w: ICON_CELL, h: ICON_CELL };
    if ("png" in col) {
      blit(atlas, readSprite(col.png), clip.x, 0, clip);
    } else if (
      !rerender(col.name) &&
      existing !== null &&
      existing.width >= clip.x + ICON_CELL
    ) {
      blit(atlas, existing, 0, 0, clip);
    } else {
      toRender.push(i);
    }
  });
  if (toRender.length === 0) return atlas;
  const glyphs = await renderSvgs(
    toRender.map((i) => {
      const col = ICON_COLUMNS[i];
      return path.join(IMAGES, "svg" in col ? col.svg : "");
    }),
    ICON_GLYPH,
  );
  toRender.forEach((i, k) => {
    const clip = { x: i * ICON_CELL, y: 0, w: ICON_CELL, h: ICON_CELL };
    const pad = centred(ICON_CELL, ICON_GLYPH);
    blit(atlas, glyphs[k], clip.x + pad, pad, clip);
  });
  return atlas;
}

/** Rasterises SVGs as white-on-transparent alpha masks at size×size, fitting
 *  the drawing (viewBox, or the declared width/height) into the square. */
async function renderSvgs(files: string[], size: number): Promise<Image[]> {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error(
      `${files.length} icon(s) need rendering but playwright is not installed: ` +
        "npm i --no-save playwright && npx playwright install chromium",
    );
  }
  const browser = await playwright.chromium.launch();
  try {
    const page = await browser.newPage();
    const out: Image[] = [];
    for (const file of files) {
      let svg = fs.readFileSync(file, "utf8");
      if (!/viewBox=/.test(svg)) {
        const w = /\bwidth="([\d.]+)"/.exec(svg)?.[1];
        const h = /\bheight="([\d.]+)"/.exec(svg)?.[1];
        if (w === undefined || h === undefined) {
          throw new Error(
            `${file}: no viewBox and no width/height to derive one`,
          );
        }
        svg = svg.replace("<svg", `<svg viewBox="0 0 ${w} ${h}"`);
      }
      const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
      const rgba: number[] = await page.evaluate(
        async ({ url, size }) => {
          const img = new Image();
          img.src = url;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0, size, size);
          return Array.from(ctx.getImageData(0, 0, size, size).data);
        },
        { url: dataUrl, size },
      );
      const img = blank(size, size);
      for (let i = 0; i < size * size; i++) {
        const a = rgba[i * 4 + 3];
        if (a === 0) continue;
        img.rgba[i * 4] = img.rgba[i * 4 + 1] = img.rgba[i * 4 + 2] = 255;
        img.rgba[i * 4 + 3] = a;
      }
      out.push(img);
    }
    return out;
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function readAtlas(name: string): Image | null {
  const file = path.join(ATLASES, name);
  return fs.existsSync(file) ? decodePng(fs.readFileSync(file)) : null;
}

function samePixels(a: Image | null, b: Image): boolean {
  if (a === null || a.width !== b.width || a.height !== b.height) return false;
  return Buffer.compare(Buffer.from(a.rgba), Buffer.from(b.rgba)) === 0;
}

function pixelDiff(a: Image | null, b: Image): string {
  if (a === null) return "missing";
  if (a.width !== b.width || a.height !== b.height) {
    return `size ${a.width}×${a.height} → ${b.width}×${b.height}`;
  }
  let n = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (
      a.rgba[i] !== b.rgba[i] ||
      a.rgba[i + 1] !== b.rgba[i + 1] ||
      a.rgba[i + 2] !== b.rgba[i + 2] ||
      a.rgba[i + 3] !== b.rgba[i + 3]
    ) {
      n++;
    }
  }
  return `${n} of ${a.width * a.height} pixels differ`;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const check = args.has("--check");
  const rerenderAll = args.has("--rerender-icons");
  const rerenderOne = new Set(
    [...args]
      .filter((a) => a.startsWith("--rerender-icon="))
      .map((a) => a.slice("--rerender-icon=".length)),
  );
  const rerender = (name: string) => rerenderAll || rerenderOne.has(name);
  let dirty = 0;

  const outputs: { name: string; image: Image }[] = [
    { name: "unit-atlas.png", image: buildUnitAtlas() },
  ];
  const fx = buildFxAtlas();
  outputs.push({ name: "fx-atlas.png", image: fx.image });
  outputs.push({
    name: "icon-atlas.png",
    image: await buildIconAtlas(readAtlas("icon-atlas.png"), rerender),
  });

  for (const { name, image } of outputs) {
    const existing = readAtlas(name);
    if (samePixels(existing, image)) {
      console.log(`${name}: unchanged`);
      continue;
    }
    dirty++;
    console.log(`${name}: ${pixelDiff(existing, image)}`);
    if (!check) fs.writeFileSync(path.join(ATLASES, name), encodePng(image));
  }

  const metaFile = path.join(ATLASES, "fx-atlas-meta.json");
  const metaText = JSON.stringify(fx.meta, null, 2) + "\n";
  const metaOld = fs.existsSync(metaFile)
    ? fs.readFileSync(metaFile, "utf8")
    : "";
  if (metaOld === metaText) {
    console.log("fx-atlas-meta.json: unchanged");
  } else {
    dirty++;
    console.log("fx-atlas-meta.json: changed");
    if (!check) fs.writeFileSync(metaFile, metaText);
  }

  if (check && dirty > 0) {
    console.error(
      `${dirty} atlas file(s) out of date; run without --check to rebuild`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
