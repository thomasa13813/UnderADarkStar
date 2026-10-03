/**
 * Draws the map "No Moon" (map-generator/drawings/No Moon.png) in the map
 * kit's palette (docs/MapMaking.md), so the picture can be re-made with
 * different numbers instead of repainted.
 *
 *   npx tsx src/scripts/drawings/NoMoon.ts     writes the drawing
 *   npm run map "No Moon"                      builds the map from it
 *
 * The idea (Tom's sketch, MapImages/NoMoon.png): the Dark Star sits in the
 * bottom right. A beam of land runs from it to the upper left, where it has
 * struck a moon. The disc is cratered at the impact, cracked radially and in
 * rings around it, and its debris is flung out to either side of the beam.
 *
 * Play: the beam is the direct road to the throne and will be fought over;
 * the debris fields on either flank are chains of stepping stones for fleets
 * and stargates. The moon's cracks split it into shards, so even expanding
 * across the moon takes fleets; the far side, where the cracks fade, is the
 * only open land on the map.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { encodePng } from "../mapkit/Png";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const OUT = path.join(ROOT, "map-generator", "drawings", "No Moon.png");

const W = 1800;
const H = 1800;
const SEED = 20261003;

type Point = [number, number];
type RGB = [number, number, number];

// The kit's palette.
const COLOUR = {
  space: [63, 72, 204] as RGB,
  void: [0, 0, 0] as RGB,
  plains: [255, 255, 255] as RGB,
  highland: [195, 195, 195] as RGB,
  mountain: [127, 127, 127] as RGB,
  nation: [237, 28, 36] as RGB,
  star: [255, 242, 0] as RGB,
};

const Cell = {
  Space: 0,
  Void: 1,
  Plains: 2,
  Highland: 3,
  Mountain: 4,
} as const;
type CellClass = (typeof Cell)[keyof typeof Cell];
const isLand = (c: number): boolean => c >= Cell.Plains;

const cls = new Uint8Array(W * H).fill(Cell.Space);

// ---------------------------------------------------------------------------
// Layout

/** The Dark Star, standard size for an 1800 map, in the bottom right. */
const STAR: Point = [1440, 1440];
const STAR_R = 162;
const MOAT = 18;

/** The moon: a disc in the top left, just inside the map's edges. */
const MOON: Point = [355, 335];
const MOON_R = 350;

const deg = (d: number): number => (d * Math.PI) / 180;
const len = (p: Point): number => Math.hypot(p[0], p[1]);
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Point, k: number): Point => [a[0] * k, a[1] * k];
const unit = (p: Point): Point => mul(p, 1 / len(p));
const dist = (a: Point, b: Point): number => len(sub(a, b));
const polar = (from: Point, angle: number, r: number): Point =>
  add(from, [Math.cos(angle) * r, Math.sin(angle) * r]);

/** Direction of the beam, moon to star. */
const U = unit(sub(STAR, MOON));
const U_ANGLE = Math.atan2(U[1], U[0]);
/** The direction from the impact back into the moon. */
const BACK = Math.atan2(-U[1], -U[0]);
/** Where the beam meets the moon's rim. */
const IMPACT: Point = add(MOON, mul(U, MOON_R));
/** The crater is bitten into the rim around the impact. */
const CRATER: Point = add(MOON, mul(U, MOON_R - 60));
const CRATER_R = 140;
/** The beam's tip burns into the crater; its far end is the moat. */
const BEAM_START: Point = add(CRATER, mul(U, -50));
const BEAM_LENGTH = dist(BEAM_START, STAR) - STAR_R - MOAT;
/** Where the single beam splits into the fan of rays. */
const FOCUS: Point = add(BEAM_START, mul(U, BEAM_LENGTH * 0.64));
/** The rays' angles from the beam; all must still hit the moat. */
const FAN_ANGLES = [-16, -5.5, 5.5, 16];

// ---------------------------------------------------------------------------
// Randomness and noise

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
const between = (lo: number, hi: number): number => lo + (hi - lo) * rand();

function hash(ix: number, iy: number, seed: number): number {
  let h =
    Math.imul(ix, 374761393) +
    Math.imul(iy, 668265263) +
    Math.imul(seed, 1013904223);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const smooth = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise in [-1, 1]. */
function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return (top + (bottom - top) * fy) * 2 - 1;
}

/** Layered noise, roughly in [-0.7, 0.7]. */
function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq, seed + o * 7919);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Smooth noise around a circle, so an outline joins up. */
function ringNoise(th: number, freq: number, seed: number): number {
  return fbm(
    Math.cos(th) * freq + seed * 10,
    Math.sin(th) * freq + seed * 10,
    seed,
    3,
  );
}

// ---------------------------------------------------------------------------
// Painting

function put(x: number, y: number, c: CellClass): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  cls[y * W + x] = c;
}

interface BlobStyle {
  /** Stretch along `angle`; 1 is round. */
  elong?: number;
  angle?: number;
  /** How far the edge wanders, as a share of the radius. */
  amp?: number;
  /** How many bumps around the edge. */
  freq?: number;
  seed: number;
}

/**
 * A rounded, noisy shape. `paint` gets the pixel's distance from the centre
 * as a share of the local edge (0 centre, 1 edge) and its angle, and says
 * what to put there, or null to leave it.
 */
function blob(
  at: Point,
  r: number,
  style: BlobStyle,
  paint: (dNorm: number, th: number, x: number, y: number) => CellClass | null,
): void {
  const cx = Math.round(at[0]);
  const cy = Math.round(at[1]);
  const elong = style.elong ?? 1;
  const angle = style.angle ?? 0;
  const amp = style.amp ?? 0.25;
  const freq = style.freq ?? 2;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const margin = Math.ceil(r * elong * (1 + amp)) + 2;
  for (
    let y = Math.max(0, cy - margin);
    y <= Math.min(H - 1, cy + margin);
    y++
  ) {
    for (
      let x = Math.max(0, cx - margin);
      x <= Math.min(W - 1, cx + margin);
      x++
    ) {
      const dx = x - cx;
      const dy = y - cy;
      const u = (dx * ca + dy * sa) / elong;
      const v = -dx * sa + dy * ca;
      const d = Math.hypot(u, v);
      if (d > r * (1 + amp) + 1) continue;
      const th = Math.atan2(v, u);
      const edge = r * (1 + amp * ringNoise(th, freq, style.seed));
      if (d > edge) continue;
      const c = paint(d / edge, th, x, y);
      if (c !== null) put(x, y, c);
    }
  }
}

/**
 * A line with a width along a polyline. `halfWidth(t)` is the half width at
 * position t (0 start, 1 end); `paint` gets each nearby pixel's distance
 * from the line, that half width and t. `reach` is how far beyond the half
 * width `paint` still wants to see.
 */
function stroke(
  points: Point[],
  halfWidth: (t: number) => number,
  paint: (d: number, hw: number, t: number) => CellClass | null,
  reach = 0,
): void {
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + dist(points[i - 1], points[i]));
  }
  const total = cum[cum.length - 1];
  let maxHw = 0;
  for (let i = 0; i <= 20; i++) maxHw = Math.max(maxHw, halfWidth(i / 20));
  const margin = Math.ceil(maxHw + reach) + 2;
  let minX = W;
  let maxX = -1;
  let minY = H;
  let maxY = -1;
  for (const p of points) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  for (
    let y = Math.max(0, Math.floor(minY - margin));
    y <= Math.min(H - 1, Math.ceil(maxY + margin));
    y++
  ) {
    for (
      let x = Math.max(0, Math.floor(minX - margin));
      x <= Math.min(W - 1, Math.ceil(maxX + margin));
      x++
    ) {
      let best = Infinity;
      let bestT = 0;
      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1];
        const [bx, by] = points[i];
        const vx = bx - ax;
        const vy = by - ay;
        const l2 = vx * vx + vy * vy;
        let s = l2 === 0 ? 0 : ((x - ax) * vx + (y - ay) * vy) / l2;
        s = Math.max(0, Math.min(1, s));
        const d = Math.hypot(x - (ax + vx * s), y - (ay + vy * s));
        if (d < best) {
          best = d;
          bestT = (cum[i - 1] + s * (cum[i] - cum[i - 1])) / total;
        }
      }
      if (best > margin) continue;
      const c = paint(best, halfWidth(bestT), bestT);
      if (c !== null) put(x, y, c);
    }
  }
}

/** A crack: a wandering line of space that narrows from `hw0` to `hw1`. */
function crack(points: Point[], hw0: number, hw1: number, seed: number): void {
  stroke(
    points,
    (t) =>
      (hw0 * Math.pow(1 - t, 1.1) + hw1) *
      (1 + 0.4 * fbm(t * 14, seed * 5.3, 80 + seed, 2)),
    (d, hw) => (d <= hw ? Cell.Space : null),
  );
}

/** Points along a line from `from` that wanders more the further it goes. */
function wanderingLine(
  from: Point,
  angle: number,
  s0: number,
  length: number,
  wander: number,
  seed: number,
): Point[] {
  const dir: Point = [Math.cos(angle), Math.sin(angle)];
  const perp: Point = [-dir[1], dir[0]];
  const points: Point[] = [];
  for (let s = s0; s <= length; s += 16) {
    const w =
      ((wander * s) / length) * fbm(s / 110, seed * 3.1, 40 + seed, 3) +
      5 * fbm(s / 28, seed * 1.7, 60 + seed, 2);
    points.push(add(add(from, mul(dir, s)), mul(perp, w)));
  }
  return points;
}

// ---------------------------------------------------------------------------
// The void: the two corners the beam does not point at, for framing.

function paintVoid(): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const wobble = 60 * fbm(x / 140, y / 140, 11, 3);
      if (x - y > 1460 + wobble || y - x > 1460 + wobble) {
        cls[y * W + x] = Cell.Void;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The moon

function paintMoon(): void {
  // The disc, with a gently uneven rim. Rays of ejecta (highland, with
  // some mountain) streak out from the impact and fade with distance; the
  // far side is open plains.
  const rim = (th: number): number => MOON_R * (1 + 0.04 * ringNoise(th, 3, 1));
  const margin = Math.ceil(MOON_R * 1.05);
  for (let y = 0; y <= Math.min(H - 1, MOON[1] + margin); y++) {
    for (let x = 0; x <= Math.min(W - 1, MOON[0] + margin); x++) {
      const th = Math.atan2(y - MOON[1], x - MOON[0]);
      if (Math.hypot(x - MOON[0], y - MOON[1]) > rim(th)) continue;
      const r = Math.hypot(x - IMPACT[0], y - IMPACT[1]);
      const a = Math.atan2(y - IMPACT[1], x - IMPACT[0]) - BACK;
      // The angle from the impact, continuous across the moon.
      const spoke = Math.atan2(Math.sin(a), Math.cos(a));
      const streak = fbm(spoke * 9, r / 70, 5, 3);
      const score = streak + 0.6 * Math.max(0, 1 - r / 520);
      let c: CellClass = Cell.Plains;
      if (score > 0.85) c = Cell.Mountain;
      else if (score > 0.55) c = Cell.Highland;
      put(x, y, c);
    }
  }

  // Old craters on the quiet side: rings of highland round a flat floor.
  const craters: { at: Point; r: number }[] = [];
  for (let tries = 0; tries < 300 && craters.length < 6; tries++) {
    const a = rand() * Math.PI * 2;
    const p = polar(MOON, a, Math.sqrt(rand()) * (MOON_R - 80));
    const r = between(26, 60);
    if (dist(p, IMPACT) < 330 + r) continue;
    if (p[0] < r + 10 || p[1] < r + 10) continue;
    if (craters.some((c) => dist(c.at, p) < c.r + r + 30)) continue;
    craters.push({ at: p, r });
    blob(p, r, { amp: 0.12, freq: 3, seed: 400 + tries }, (d) =>
      d > 0.72 ? Cell.Highland : Cell.Plains,
    );
  }

  // The crater the beam has bitten out of the rim, with a raised lip.
  const craterStyle: BlobStyle = {
    elong: 1.25,
    angle: U_ANGLE,
    amp: 0.18,
    freq: 2.5,
    seed: 3,
  };
  blob(CRATER, CRATER_R * 1.32, craterStyle, (d, _th, x, y) => {
    if (!isLand(cls[y * W + x])) return null;
    if (d > 0.88) return Cell.Highland;
    if (d > 0.76) return Cell.Mountain;
    return null;
  });
  blob(CRATER, CRATER_R, craterStyle, () => Cell.Space);

  // Radial cracks from the impact. Each runs from inside the crater outward,
  // wandering more as it goes and narrowing to a hairline; some reach the
  // rim and some stop short, leaving the far shards joined. Some fork.
  const offsets = [-82, -64, -47, -31, -16, -2, 12, 27, 43, 60, 78];
  offsets.forEach((offset, k) => {
    const phi = deg(offset + between(-4, 4));
    const chord = 2 * MOON_R * Math.cos(phi);
    const share = between(0.68, 1.2);
    const reachesRim = share > 1;
    const length = Math.min(chord * share, chord + 60);
    const points = wanderingLine(
      IMPACT,
      BACK + phi,
      CRATER_R * 0.6,
      length,
      14,
      k,
    );
    if (points.length < 2) return;
    crack(points, 20, reachesRim ? 3.5 : 2.5, k);
    if (rand() < 0.6 && points.length > 6) {
      const i = Math.floor(points.length * between(0.3, 0.65));
      const side = rand() < 0.5 ? -1 : 1;
      const branchLength = between(0.25, 0.45) * (length - i * 16);
      const branch = wanderingLine(
        points[i],
        BACK + phi + side * deg(between(22, 38)),
        0,
        branchLength,
        10,
        20 + k,
      );
      if (branch.length >= 2) crack(branch, 6, 2, 20 + k);
    }
  });

  // Rings around the impact, broken into arcs: the nearer ring is the more
  // complete and the wider.
  const rings = [
    { r: 275, hw: 8, cover: 0.85, arcs: 5 },
    { r: 430, hw: 5, cover: 0.6, arcs: 4 },
  ];
  rings.forEach((ring, ri) => {
    const span = deg(170);
    const arcLen = (span * ring.cover) / ring.arcs;
    const gapLen = (span * (1 - ring.cover)) / ring.arcs;
    let a = BACK - span / 2 + between(0, gapLen);
    for (let i = 0; i < ring.arcs; i++) {
      const a1 = a + arcLen * between(0.8, 1.15);
      const points: Point[] = [];
      for (let t = a; t <= a1; t += deg(1.5)) {
        const r = ring.r + 10 * fbm(t * 3, ri * 2.3 + i, 120 + ri, 3);
        const p = polar(IMPACT, t, r);
        if (dist(p, MOON) < MOON_R - 6) points.push(p);
      }
      if (points.length >= 2)
        crack(points, ring.hw, ring.hw * 0.5, 50 + ri * 7 + i);
      a = a1 + gapLen * between(0.6, 1.4);
    }
  });
}

// ---------------------------------------------------------------------------
// The debris

interface Fragment {
  at: Point;
  r: number;
  elong?: number;
}

/** The larger pieces, flung to either flank of the beam. */
const FRAGMENTS: Fragment[] = [
  // Right-hand flank (above the beam), curving round to the star's north.
  { at: [900, 400], r: 46 },
  { at: [1130, 250], r: 56, elong: 1.3 },
  { at: [980, 560], r: 80, elong: 1.25 },
  { at: [1180, 480], r: 50, elong: 1.4 },
  { at: [1330, 640], r: 44 },
  { at: [1240, 820], r: 40, elong: 1.3 },
  { at: [1450, 870], r: 50 },
  { at: [1560, 1080], r: 36 },
  { at: [1630, 560], r: 40, elong: 1.5 },
  // Left-hand flank (below the beam), curving round to the star's west.
  { at: [560, 900], r: 48, elong: 1.3 },
  { at: [420, 1000], r: 56 },
  { at: [300, 880], r: 40 },
  { at: [660, 1040], r: 62, elong: 1.2 },
  { at: [520, 1180], r: 50, elong: 1.4 },
  { at: [380, 1320], r: 68 },
  { at: [640, 1320], r: 46 },
  { at: [860, 1300], r: 58, elong: 1.3 },
  { at: [1000, 1440], r: 42 },
  { at: [1130, 1600], r: 48 },
  { at: [200, 1150], r: 36 },
  { at: [760, 1480], r: 40, elong: 1.4 },
];
const FRAGMENT_SCALE = 0.88;

function paintDebris(): void {
  FRAGMENTS.forEach((f, i) => {
    const r = f.r * FRAGMENT_SCALE;
    const toImpact = sub(IMPACT, f.at);
    const angle = Math.atan2(toImpact[1], toImpact[0]);
    blob(
      f.at,
      r,
      { elong: f.elong ?? 1, angle, amp: 0.3, freq: 2, seed: 200 + i },
      (_d, th, x, y) => {
        // The face that took the blast is the high side.
        const hot = polar(f.at, angle, r * 0.3);
        const d = dist([x, y], hot) / r;
        const wob = 1 + 0.35 * ringNoise(th, 2, 250 + i);
        if (r >= 54 && d < 0.24 * wob) return Cell.Mountain;
        if (r >= 42 && d < 0.5 * wob) return Cell.Highland;
        return Cell.Plains;
      },
    );
  });

  // Small pieces still close to the crater, flung out to either side of the
  // beam but clear of it and of the moon's rim.
  const specks: Point[] = [];
  for (let tries = 0; tries < 600 && specks.length < 20; tries++) {
    const side = rand() < 0.5 ? -1 : 1;
    const a = U_ANGLE + side * deg(between(30, 80));
    const p = polar(IMPACT, a, between(160, 380));
    const r = between(7, 20);
    if (dist(p, MOON) < MOON_R + r + 28) continue;
    const rel = sub(p, IMPACT);
    const along = rel[0] * U[0] + rel[1] * U[1];
    const across = Math.abs(rel[0] * U[1] - rel[1] * U[0]);
    if (along > -40 && across < 30 + r + 30) continue;
    if (
      FRAGMENTS.some((f) => dist(f.at, p) < f.r * FRAGMENT_SCALE * 1.3 + r + 16)
    ) {
      continue;
    }
    if (specks.some((q) => dist(q, p) < 46)) continue;
    specks.push(p);
    blob(
      p,
      r,
      {
        elong: between(1, 1.6),
        angle: a,
        amp: 0.3,
        freq: 2,
        seed: 300 + tries,
      },
      () => Cell.Plains,
    );
  }
}

// ---------------------------------------------------------------------------
// The beam

function paintBeam(): void {
  // The single beam, moon to focus: a bright core with a hot rim.
  stroke(
    [BEAM_START, FOCUS],
    (t) => 22 * (1 + 0.12 * fbm(t * 8, 0.5, 500, 2)),
    (d, hw) => {
      if (d <= hw) return Cell.Plains;
      if (d <= hw + 8) return Cell.Highland;
      return null;
    },
    8,
  );
  // The fan: rays from the focus to the moat. Denser energy nearer the
  // throne, so higher ground: slower to cross.
  for (const offset of FAN_ANGLES) {
    const a = U_ANGLE + deg(offset);
    const dir: Point = [Math.cos(a), Math.sin(a)];
    // Length to the moat's outer edge along this ray (the kit clears the
    // moat; a little past it costs nothing).
    const rel = sub(FOCUS, STAR);
    const b = 2 * (rel[0] * dir[0] + rel[1] * dir[1]);
    const c = rel[0] ** 2 + rel[1] ** 2 - (STAR_R + MOAT) ** 2;
    const disc = b * b - 4 * c;
    if (disc < 0)
      throw new Error(`The ray at ${offset} degrees misses the moat.`);
    const s = (-b - Math.sqrt(disc)) / 2 + 6;
    stroke(
      [FOCUS, add(FOCUS, mul(dir, s))],
      (t) => 11 * (1 + 0.1 * fbm(t * 6, offset, 520, 2)),
      (d, hw) => {
        if (d <= hw) return Cell.Highland;
        if (d <= hw + 5) return Cell.Mountain;
        return null;
      },
      5,
    );
  }
}

// ---------------------------------------------------------------------------
// Nations: one dot per shard or fragment big enough to hold one, more on
// the large open shards, all well away from the star.

interface Nation {
  at: Point;
  where: string;
}

const MIN_HOME = 7_500;
const TILES_PER_NATION = 26_000;
const MAX_PER_HOME = 6;
const MIN_SPACING = 170;
const STAR_EXCLUSION = 600;
const MIN_INTERIOR = 22;
const EDGE_MARGIN = 60;

function placeNations(): Nation[] {
  // Land components, 4-connected, as the kit counts them.
  const label = new Int32Array(W * H).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(W * H);
  for (let start = 0; start < cls.length; start++) {
    if (label[start] !== -1 || !isLand(cls[start])) continue;
    const id = sizes.length;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    while (top > 0) {
      const i = stack[--top];
      size++;
      const x = i % W;
      const y = (i - x) / W;
      const next = [
        x > 0 ? i - 1 : -1,
        x < W - 1 ? i + 1 : -1,
        y > 0 ? i - W : -1,
        y < H - 1 ? i + W : -1,
      ];
      for (const j of next) {
        if (j < 0 || label[j] !== -1 || !isLand(cls[j])) continue;
        label[j] = id;
        stack[top++] = j;
      }
    }
    sizes.push(size);
  }

  // How far each land pixel is from the nearest space, void or map edge.
  const interior = new Int32Array(W * H).fill(-1);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < cls.length; i++) {
    const x = i % W;
    const y = (i - x) / W;
    if (!isLand(cls[i]) || x === 0 || y === 0 || x === W - 1 || y === H - 1) {
      interior[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % W;
    const d = interior[i] + 1;
    for (const j of [i - 1, i + 1, i - W, i + W]) {
      if (j < 0 || j >= cls.length) continue;
      if ((j === i - 1 && x === 0) || (j === i + 1 && x === W - 1)) continue;
      if (interior[j] !== -1) continue;
      interior[j] = d;
      queue[tail++] = j;
    }
  }

  // The beam's own two nations, on its moon-side half; the placer then
  // leaves the beam alone.
  const nations: Nation[] = [];
  const done = new Set<number>();
  for (const share of [0.2, 0.55]) {
    const p = add(BEAM_START, mul(sub(FOCUS, BEAM_START), share));
    const at: Point = [Math.round(p[0]), Math.round(p[1])];
    nations.push({ at, where: "beam" });
    done.add(label[at[1] * W + at[0]]);
  }

  // Every other home: candidates are a grid of interior land pixels, picked
  // farthest-first so each extra nation lands where there is most room.
  const byHome = new Map<number, Point[]>();
  for (let y = EDGE_MARGIN; y < H - EDGE_MARGIN; y += 5) {
    for (let x = EDGE_MARGIN; x < W - EDGE_MARGIN; x += 5) {
      const i = y * W + x;
      if (!isLand(cls[i]) || interior[i] < MIN_INTERIOR) continue;
      if (dist([x, y], STAR) < STAR_EXCLUSION) continue;
      const id = label[i];
      if (sizes[id] < MIN_HOME || done.has(id)) continue;
      let list = byHome.get(id);
      if (list === undefined) {
        list = [];
        byHome.set(id, list);
      }
      list.push([x, y]);
    }
  }
  const homes = [...byHome.entries()].sort((a, b) => sizes[b[0]] - sizes[a[0]]);
  for (const [id, candidates] of homes) {
    const want = Math.min(
      MAX_PER_HOME,
      Math.max(1, Math.round(sizes[id] / TILES_PER_NATION)),
    );
    const chosen: Point[] = [];
    // First: the most interior point, so a lone nation sits mid-shard.
    let first = candidates[0];
    for (const c of candidates) {
      if (interior[c[1] * W + c[0]] > interior[first[1] * W + first[0]]) {
        first = c;
      }
    }
    chosen.push(first);
    while (chosen.length < want) {
      let best: Point | null = null;
      let bestD = 0;
      for (const c of candidates) {
        const d = Math.min(...chosen.map((q) => dist(q, c)));
        if (d > bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best === null || bestD < MIN_SPACING) break;
      chosen.push(best);
    }
    const where = `home of ${sizes[id].toLocaleString("en-US")} tiles`;
    for (const at of chosen) nations.push({ at, where });
  }
  const homeSizes = sizes.filter((s) => s >= MIN_HOME).sort((a, b) => b - a);
  console.log(
    `${sizes.length} pieces of land; ${homeSizes.length} of ${MIN_HOME.toLocaleString("en-US")} tiles or more: ${homeSizes.map((s) => s.toLocaleString("en-US")).join(", ")}`,
  );
  return nations;
}

// ---------------------------------------------------------------------------

function main(): void {
  paintVoid();
  paintMoon();
  paintDebris();
  paintBeam();
  const nations = placeNations();

  const rgba = new Uint8Array(W * H * 4);
  const colours: RGB[] = [
    COLOUR.space,
    COLOUR.void,
    COLOUR.plains,
    COLOUR.highland,
    COLOUR.mountain,
  ];
  const counts = [0, 0, 0, 0, 0];
  for (let i = 0; i < cls.length; i++) {
    const x = i % W;
    const y = (i - x) / W;
    counts[cls[i]]++;
    let rgb = colours[cls[i]];
    if (dist([x, y], STAR) <= STAR_R) rgb = COLOUR.star;
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = 255;
  }
  for (const n of nations) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dy * dy > 16) continue;
        const i = (n.at[1] + dy) * W + (n.at[0] + dx);
        rgba[i * 4] = COLOUR.nation[0];
        rgba[i * 4 + 1] = COLOUR.nation[1];
        rgba[i * 4 + 2] = COLOUR.nation[2];
      }
    }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, encodePng({ width: W, height: H, rgba }));

  const land = counts[2] + counts[3] + counts[4];
  console.log(`Wrote ${path.relative(ROOT, OUT)}`);
  console.log(
    `Land ${land.toLocaleString("en-US")} (plains ${counts[2]}, highland ${counts[3]}, mountain ${counts[4]}), space ${counts[0]}, void ${counts[1]}`,
  );
  console.log(`${nations.length} nations:`);
  for (const n of nations) {
    console.log(`  (${n.at[0]}, ${n.at[1]})  ${n.where}`);
  }
}

main();
