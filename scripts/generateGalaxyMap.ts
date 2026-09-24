/**
 * Authors a galaxy map for Under a Dark Star (docs/DarkStar-Design.md §5.3,
 * F5): `image.png` and `info.json` under map-generator/assets/maps/<name>/,
 * ready for `npm run gen-maps`.
 *
 * The map is a ring of star clusters around an open centre — deep space
 * (water) where the engine carves the Dark Star and its moat — bounded by
 * void (impassable) at the corners, like the shipped Milky Way. Three
 * logarithmic spiral arms carry the densest land; deep-space lanes between
 * the sectors keep some neighbours reachable only by fleet or stargate.
 * Nations sit in an annulus around the moat with sci-fi names (F14, this map
 * only); Tribes fill the rest.
 *
 * Deterministic for a seed, so the committed image can be regenerated:
 *   npx tsx scripts/generateGalaxyMap.ts [--seed 7] [--size 1800]
 *                                        [--land 450000] [--name eventhorizon]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import zlib from "zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined
    ? process.argv[i + 1]
    : fallback;
}

// ── Pixel rules (map-generator/map_generator.go) ────────────────────────
// Only the blue channel matters: 106 = water, 140–200 = land with rising
// elevation (plains < 159 ≤ highland < 179 ≤ mountain), pure black = void.
const WATER: [number, number, number] = [0, 0, 106];
const VOID: [number, number, number] = [0, 0, 0];
const LAND_R = 236;
const LAND_G = 226;

// ── Deterministic noise ──────────────────────────────────────────────────
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

class ValueNoise {
  private readonly perm = new Uint8Array(512);
  private readonly grad = new Float32Array(256);
  constructor(rand: () => number) {
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) this.grad[i] = rand();
  }
  private lattice(x: number, y: number): number {
    return this.grad[this.perm[(this.perm[x & 255] + y) & 255]];
  }
  /** Smooth value noise in [0, 1]. */
  at(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = this.lattice(x0, y0);
    const b = this.lattice(x0 + 1, y0);
    const c = this.lattice(x0, y0 + 1);
    const d = this.lattice(x0 + 1, y0 + 1);
    const top = a + (b - a) * sx;
    const bottom = c + (d - c) * sx;
    return top + (bottom - top) * sy;
  }
  /** Fractal sum, roughly in [0, 1]. */
  fbm(x: number, y: number, octaves: number, scale: number): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let f = 1 / scale;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.at(x * f, y * f);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}

// ── PNG encoder (RGBA8, no dependencies) ─────────────────────────────────
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
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

// ── The galaxy ───────────────────────────────────────────────────────────
const NATION_NAMES = [
  "Orion Combine",
  "Vega Ascendancy",
  "Tau Ceti Concord",
  "Kepler Directorate",
  "Rigel Syndicate",
  "Cygnus Dominion",
  "Lyra Commonwealth",
  "Draco Protectorate",
  "Sirius Republic",
  "Altair Mandate",
  "Procyon Free Worlds",
  "Aldebaran Sovereignty",
  "Deneb Collective",
  "Antares Crown",
  "Fomalhaut Assembly",
  "Arcturus Covenant",
  "Capella Trade League",
  "Betelgeuse Marches",
  "Polaris Order",
  "Spica Confederation",
  "Regulus Authority",
  "Canopus Union",
  "Andromeda Compact",
  "Perseus Reach",
];

interface Layout {
  size: number;
  cx: number;
  cy: number;
  innerWater: number; // deep space around the centre, out to this radius
  outerLand: number; // land ends here; void beyond
  nationRadius: number; // the nations' ring
  domainRadius: number; // the Dark Star the engine carves (info.json)
  moat: number;
}

function layoutFor(size: number): Layout {
  // F5: the disc is 9% of the shorter side and the moat 1% (min 15), as the
  // engine would size them; written into info.json so the override is live.
  const domainRadius = Math.floor(size * 0.09);
  const moat = Math.max(15, Math.floor(size * 0.01));
  return {
    size,
    cx: size >> 1,
    cy: size >> 1,
    innerWater: domainRadius + moat + Math.floor(size * 0.014),
    outerLand: Math.floor(size * 0.478),
    nationRadius: Math.floor(size * 0.222),
    domainRadius,
    moat,
  };
}

function build(seed: number, size: number, targetLand: number) {
  const rand = mulberry32(seed);
  const shape = new ValueNoise(rand);
  const detail = new ValueNoise(rand);
  const relief = new ValueNoise(rand);
  const edge = new ValueNoise(rand);
  const L = layoutFor(size);
  const N = size * size;
  const TAU = Math.PI * 2;

  // Density field: spiral arms plus noise, tapered at both shores and cut by
  // spiral lanes of deep space. Thresholded below to hit the land target.
  const density = new Float32Array(N);
  const ARMS = 3;
  const LANES = 5;
  const armTwist = 3.2; // radians of rotation per e-fold of radius
  const r0 = L.innerWater;
  const zone = new Uint8Array(N); // 0 void, 1 open water, 2 candidate land
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = x - L.cx;
      const dy = y - L.cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      const theta = Math.atan2(dy, dx);
      // Ragged outer rim, then void.
      const rimWobble = (edge.fbm(x, y, 3, 220) - 0.5) * size * 0.06;
      if (r > L.outerLand + rimWobble) {
        zone[i] = 0;
        continue;
      }
      // Ragged inner shore around the open centre.
      const shoreWobble = (edge.fbm(x + 4000, y, 3, 90) - 0.5) * size * 0.02;
      if (r < L.innerWater + shoreWobble) {
        zone[i] = 1;
        continue;
      }
      zone[i] = 2;
      const spiral = armTwist * Math.log(Math.max(r, r0) / r0);
      // Angular distance to the nearest arm centreline, 0..π/ARMS.
      let armPhase = ((theta - spiral) % (TAU / ARMS)) + TAU / ARMS;
      armPhase %= TAU / ARMS;
      const armDist = Math.min(armPhase, TAU / ARMS - armPhase);
      // Arms of a roughly constant width in tiles, widening a little outward.
      const armW = 60 + r * 0.13;
      const arm = Math.exp(-((armDist * r) ** 2) / (2 * armW * armW));
      // Lanes: narrow spiral gaps rotating the other way.
      let lanePhase =
        ((theta + spiral * 0.6 + 0.37) % (TAU / LANES)) + TAU / LANES;
      lanePhase %= TAU / LANES;
      const laneDist = Math.min(lanePhase, TAU / LANES - lanePhase);
      const lane = Math.exp(-((laneDist * r) ** 2) / (2 * 22 * 22));
      // Taper towards both shores so the coasts break into islands.
      const inner = Math.min(1, (r - L.innerWater) / (size * 0.03));
      const outer = Math.min(1, (L.outerLand - r) / (size * 0.03));
      const taper = Math.min(inner, outer);
      // Clusters follow the arms but are broken up by noise, and the gaps
      // between arms hold scattered clusters of their own.
      const cluster = Math.max(
        0,
        Math.min(1, (shape.fbm(x, y, 4, 120) - 0.5) * 2.2 + 0.5),
      );
      density[i] =
        (0.3 + 0.7 * arm) * (0.4 + 0.6 * cluster) +
        0.25 * detail.fbm(x, y, 3, 45) -
        0.4 * lane -
        0.5 * (1 - taper);
    }
  }

  // Binary search the threshold for the land target.
  let lo = -1;
  let hi = 2;
  let threshold = 0.5;
  let land = 0;
  for (let it = 0; it < 40; it++) {
    threshold = (lo + hi) / 2;
    land = 0;
    for (let i = 0; i < N; i++) {
      if (zone[i] === 2 && density[i] > threshold) land++;
    }
    if (land > targetLand) lo = threshold;
    else hi = threshold;
    if (Math.abs(land - targetLand) < targetLand * 0.002) break;
  }

  const isLand = new Uint8Array(N);
  const rgba = new Uint8Array(N * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let rgb: [number, number, number];
      if (zone[i] === 0) {
        rgb = VOID;
      } else if (zone[i] === 1 || density[i] <= threshold) {
        rgb = WATER;
      } else {
        isLand[i] = 1;
        // Elevation: relief noise lifted by how far above the threshold the
        // tile sits, so the arm cores are highland and the fringes plains.
        const above = Math.min(1, (density[i] - threshold) / 0.35);
        const e = 0.65 * relief.fbm(x, y, 3, 70) + 0.35 * above;
        const blue = Math.round(140 + Math.max(0, Math.min(1, e - 0.3)) * 75);
        rgb = [LAND_R, LAND_G, Math.min(200, blue)];
      }
      rgba[i * 4] = rgb[0];
      rgba[i * 4 + 1] = rgb[1];
      rgba[i * 4 + 2] = rgb[2];
      rgba[i * 4 + 3] = 255;
    }
  }

  // Nations: evenly around the ring with a little jitter, each snapped to
  // the nearest land tile that has room around it.
  const landAround = (x: number, y: number, half: number): number => {
    let n = 0;
    for (let yy = y - half; yy <= y + half; yy++) {
      if (yy < 0 || yy >= size) continue;
      for (let xx = x - half; xx <= x + half; xx++) {
        if (xx < 0 || xx >= size) continue;
        n += isLand[yy * size + xx];
      }
    }
    return n;
  };
  const nations: { name: string; coordinates: [number, number] }[] = [];
  const count = NATION_NAMES.length;
  const startAngle = rand() * TAU;
  for (let k = 0; k < count; k++) {
    const theta = startAngle + (k / count) * TAU + (rand() - 0.5) * 0.12;
    const r = L.nationRadius + (rand() - 0.5) * size * 0.04;
    const ix = Math.round(L.cx + r * Math.cos(theta));
    const iy = Math.round(L.cy + r * Math.sin(theta));
    let best: [number, number] | null = null;
    let bestD = Infinity;
    const reach = 90;
    for (let yy = iy - reach; yy <= iy + reach; yy++) {
      if (yy < 0 || yy >= size) continue;
      for (let xx = ix - reach; xx <= ix + reach; xx++) {
        if (xx < 0 || xx >= size) continue;
        if (isLand[yy * size + xx] === 0) continue;
        const d = (xx - ix) ** 2 + (yy - iy) ** 2;
        if (d >= bestD) continue;
        // Room for a spawn and some growth: most of a 41x41 window is land.
        if (landAround(xx, yy, 20) < 1100) continue;
        // Not on top of a neighbour.
        if (
          nations.some(
            (n) =>
              (n.coordinates[0] - xx) ** 2 + (n.coordinates[1] - yy) ** 2 <
              70 * 70,
          )
        ) {
          continue;
        }
        bestD = d;
        best = [xx, yy];
      }
    }
    if (best === null) {
      throw new Error(`no land for nation ${NATION_NAMES[k]} near ${ix},${iy}`);
    }
    nations.push({ name: NATION_NAMES[k], coordinates: best });
  }

  return { L, rgba, land, threshold, nations };
}

function main(): void {
  const seed = Number(arg("seed", "7"));
  const size = Number(arg("size", "1800"));
  const targetLand = Number(arg("land", "450000"));
  const name = arg("name", "eventhorizon");
  if (size % 4 !== 0) throw new Error("--size must be a multiple of 4");

  const { L, rgba, land, threshold, nations } = build(seed, size, targetLand);
  const dir = path.join(ROOT, "map-generator", "assets", "maps", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "image.png"), encodePng(size, size, rgba));

  const info = {
    id: "EventHorizon",
    name: "Event Horizon",
    translation_key: `map.${name}`,
    categories: ["cosmic"],
    multiplayer_frequency: 4,
    // The Dark Star this map is drawn around (docs/DarkStar-Design.md F5):
    // centred, sized as the engine would size it, so the override is
    // exercised on the map it was made for.
    hegemon: {
      center: [L.cx, L.cy],
      radius: L.domainRadius,
      moat: L.moat,
    },
    themes: ["space"],
    nations: nations.map((n) => ({
      coordinates: n.coordinates,
      name: n.name,
      flag: "",
    })),
  };
  fs.writeFileSync(
    path.join(dir, "info.json"),
    JSON.stringify(info, null, 2) + "\n",
  );
  console.log(
    `${name}: ${size}x${size}, ${land} land tiles (threshold ${threshold.toFixed(3)}), ` +
      `Dark Star r=${L.domainRadius} moat ${L.moat} at ${L.cx},${L.cy}, ` +
      `${nations.length} nations on r≈${L.nationRadius}`,
  );
  for (const n of nations) {
    const d = Math.round(
      Math.hypot(n.coordinates[0] - L.cx, n.coordinates[1] - L.cy),
    );
    console.log(
      `  ${n.name.padEnd(22)} ${n.coordinates[0]},${n.coordinates[1]}  r=${d}`,
    );
  }
}

main();
