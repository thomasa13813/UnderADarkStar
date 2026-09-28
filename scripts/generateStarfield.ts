/**
 * Draws the home-page background: a pixel-art deep-space field of stars,
 * nebulae and a couple of small galaxies, written as an indexed-colour PNG to
 * resources/images/background.png.
 *
 * The image is rendered at a small logical size and scaled up by the page
 * with `image-rendering: pixelated`, which keeps the file tiny and the pixels
 * crisp at any viewport. Everything is drawn from a seeded PRNG, so the same
 * seed always yields the same sky; change SEED (or pass one as the first
 * argument) for a different one.
 *
 *   npx tsx scripts/generateStarfield.ts [seed] [width] [height] [file]
 *
 * `file` defaults to background.png (the home page). The in-map starfield
 * (StarfieldPass, drawn under translucent deep space) is a second, larger
 * render of the same generator so its grain is about one map tile per pixel:
 *
 *   npx tsx scripts/generateStarfield.ts 11 2048 2048 starfield-map.png
 *
 * No dependencies: the PNG encoder below is the minimal RGBA writer (zlib
 * from Node, CRC32 by hand). Roadmap P1 step E / P2 share this generator.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SEED = Number(process.argv[2] ?? 11);
const W = Number(process.argv[3] ?? 640);
const H = Number(process.argv[4] ?? 360);
const FILE = process.argv[5] ?? "background.png";

// ---------------------------------------------------------------- PRNG ----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

// ---------------------------------------------------------- value noise ----
// Smooth 2-D value noise with a few octaves; used to shape the nebulae so
// they read as clouds rather than blobs.
function makeNoise(size: number): (x: number, y: number) => number {
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const at = (x: number, y: number) =>
    grid[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
const noiseA = makeNoise(64);
const noiseB = makeNoise(64);
function fbm(x: number, y: number): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < 4; o++) {
    v += amp * (o % 2 === 0 ? noiseA(x * f, y * f) : noiseB(x * f, y * f));
    amp *= 0.5;
    f *= 2;
  }
  return v;
}

// -------------------------------------------------------------- canvas ----
type RGB = [number, number, number];
const px = new Float32Array(W * H * 3);
const BASE: RGB = [5, 8, 20]; // a shade darker than --color-deep-navy
for (let i = 0; i < W * H; i++) {
  px[i * 3] = BASE[0];
  px[i * 3 + 1] = BASE[1];
  px[i * 3 + 2] = BASE[2];
}
function blend(x: number, y: number, c: RGB, a: number) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  px[i] += (c[0] - px[i]) * a;
  px[i + 1] += (c[1] - px[i + 1]) * a;
  px[i + 2] += (c[2] - px[i + 2]) * a;
}
function add(x: number, y: number, c: RGB, a: number) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  px[i] = Math.min(255, px[i] + c[0] * a);
  px[i + 1] = Math.min(255, px[i + 1] + c[1] * a);
  px[i + 2] = Math.min(255, px[i + 2] + c[2] * a);
}

// --------------------------------------------------------------- nebulae ----
// A soft band across the sky (the galactic plane) plus a few coloured clouds.
// Alpha is quantised to a handful of steps and dithered so the gradients keep
// the pixel-art feel instead of reading as a smooth blur.
const NEBULA_COLOURS: RGB[] = [
  [96, 40, 140], // violet
  [24, 110, 130], // teal
  [140, 40, 90], // magenta
  [40, 60, 150], // indigo
];
function quantise(a: number, steps: number, x: number, y: number): number {
  // Ordered 2x2 dither: the threshold varies by pixel parity so a mid-tone
  // becomes a checker of two neighbouring levels.
  const bayer = [0.125, 0.625, 0.875, 0.375][(y & 1) * 2 + (x & 1)];
  return Math.floor(a * steps + bayer) / steps;
}
const bandAngle = between(-0.35, 0.35);
const bandOffset = between(0.35, 0.65) * H;
const bandWidth = H * between(0.18, 0.26);
const clouds = Array.from({ length: 4 }, () => ({
  cx: between(0.1, 0.9) * W,
  cy: between(0.15, 0.85) * H,
  rx: between(0.12, 0.28) * W,
  ry: between(0.1, 0.22) * H,
  colour: pick(NEBULA_COLOURS),
  strength: between(0.32, 0.5),
}));
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const n = fbm(x / 48, y / 48);
    // Galactic band: distance from a tilted line, shaped by noise.
    const d = Math.abs(y - (bandOffset + (x - W / 2) * bandAngle)) / bandWidth;
    const band = Math.max(0, 1 - d * d) * (0.35 + 0.65 * n) * 0.16;
    if (band > 0.02) blend(x, y, [70, 60, 120], quantise(band, 6, x, y));
    for (const c of clouds) {
      const dx = (x - c.cx) / c.rx;
      const dy = (y - c.cy) / c.ry;
      const r = dx * dx + dy * dy;
      if (r > 1.6) continue;
      const shape =
        Math.max(0, 1 - r) * (0.3 + 0.7 * fbm(x / 22 + 9, y / 22 + 9));
      const a = quantise(shape * c.strength, 5, x, y);
      if (a > 0) blend(x, y, c.colour, a);
    }
  }
}

// ----------------------------------------------------------------- stars ----
const STAR_TINTS: RGB[] = [
  [255, 255, 255],
  [255, 255, 255],
  [200, 220, 255], // blue-white
  [255, 240, 200], // warm
  [255, 200, 140], // orange
  [180, 200, 255], // blue
];
const starCount = Math.round((W * H) / 380);
for (let i = 0; i < starCount; i++) {
  const x = Math.floor(rand() * W);
  const y = Math.floor(rand() * H);
  const tint = pick(STAR_TINTS);
  const roll = rand();
  if (roll < 0.72) {
    add(x, y, tint, between(0.18, 0.5)); // faint field star
  } else if (roll < 0.95) {
    add(x, y, tint, between(0.6, 1)); // bright point
  } else {
    // A big one: plus-shaped glint with a dim halo.
    add(x, y, tint, 1);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      add(x + dx, y + dy, tint, 0.55);
    for (const [dx, dy] of [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ])
      add(x + dx, y + dy, tint, 0.18);
  }
}

// -------------------------------------------------------------- galaxies ----
// Two small spirals: a bright core, two arms of dotted stars, tilted.
for (let g = 0; g < 2; g++) {
  const cx = between(0.12, 0.88) * W;
  const cy = between(0.15, 0.85) * H;
  const size = between(20, 32);
  const tilt = between(0, Math.PI);
  const squash = between(0.35, 0.7);
  const tint: RGB = pick([
    [255, 230, 200],
    [220, 225, 255],
  ]);
  const place = (r: number, theta: number, a: number) => {
    const ex = Math.cos(theta) * r;
    const ey = Math.sin(theta) * r * squash;
    const rx = ex * Math.cos(tilt) - ey * Math.sin(tilt);
    const ry = ex * Math.sin(tilt) + ey * Math.cos(tilt);
    add(Math.round(cx + rx), Math.round(cy + ry), tint, a);
  };
  for (let arm = 0; arm < 2; arm++) {
    for (let t = 0; t < 1; t += 0.02) {
      const theta = arm * Math.PI + t * Math.PI * 1.6;
      const r = 2 + t * size;
      place(r, theta + between(-0.12, 0.12), 0.35 + 0.5 * (1 - t) * rand());
      if (rand() < 0.35) place(r + between(-2, 2), theta, 0.2 * rand());
    }
  }
  for (let k = 0; k < 40; k++) {
    const r = Math.abs(between(0, 3));
    place(r, between(0, Math.PI * 2), 0.5);
  }
  add(Math.round(cx), Math.round(cy), [255, 255, 255], 1);
}

// ------------------------------------------------------------ PNG writer ----
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(Buffer.from(type, "ascii"), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
const raw = new Uint8Array(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const o = y * (1 + W * 3) + 1 + x * 3;
    raw[o] = Math.round(px[i]);
    raw[o + 1] = Math.round(px[i + 1]);
    raw[o + 2] = Math.round(px[i + 2]);
  }
}
const ihdr = new Uint8Array(13);
const iv = new DataView(ihdr.buffer);
iv.setUint32(0, W);
iv.setUint32(4, H);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", new Uint8Array(0)),
]);

const outPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "resources",
  "images",
  FILE,
);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${W}x${H}, seed ${SEED}, ${png.length} bytes)`);
