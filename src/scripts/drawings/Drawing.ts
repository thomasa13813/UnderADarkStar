/**
 * Shared tools for the generated map drawings in this folder: a canvas in
 * the map kit's palette (docs/MapMaking.md), seeded noise, rounded blobs,
 * wide strokes, a nation placer and the PNG writer. Each map is a script
 * that describes its parts with these and writes
 * map-generator/drawings/<Map Name>.png for `npm run map "<Map Name>"`.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { encodePng } from "../mapkit/Png";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export type Point = [number, number];
export type RGB = [number, number, number];

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

export const Cell = {
  Space: 0,
  Void: 1,
  Plains: 2,
  Highland: 3,
  Mountain: 4,
} as const;
export type CellClass = (typeof Cell)[keyof typeof Cell];
export const isLand = (c: number): boolean => c >= Cell.Plains;

/** The engine's standard Dark Star on an 1800 map. */
export const STANDARD_STAR_RADIUS = 162;
export const STANDARD_MOAT = 18;

// ---------------------------------------------------------------------------
// Geometry

export const deg = (d: number): number => (d * Math.PI) / 180;
export const len = (p: Point): number => Math.hypot(p[0], p[1]);
export const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: Point, k: number): Point => [a[0] * k, a[1] * k];
export const unit = (p: Point): Point => mul(p, 1 / len(p));
export const dist = (a: Point, b: Point): number => len(sub(a, b));
export const polar = (from: Point, angle: number, r: number): Point =>
  add(from, [Math.cos(angle) * r, Math.sin(angle) * r]);

// ---------------------------------------------------------------------------
// Randomness and noise

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
export function noise(x: number, y: number, seed: number): number {
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
export function fbm(x: number, y: number, seed: number, octaves = 4): number {
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
export function ringNoise(th: number, freq: number, seed: number): number {
  return fbm(
    Math.cos(th) * freq + seed * 10,
    Math.sin(th) * freq + seed * 10,
    seed,
    3,
  );
}

// ---------------------------------------------------------------------------
// The canvas

export interface BlobStyle {
  /** Stretch along `angle`; 1 is round. */
  elong?: number;
  angle?: number;
  /** How far the edge wanders, as a share of the radius. */
  amp?: number;
  /** How many bumps around the edge. */
  freq?: number;
  seed: number;
}

export interface Nation {
  at: Point;
  where: string;
}

export interface NationOptions {
  star: Point;
  /** No nation nearer the star's centre than this. */
  starExclusion: number;
  /** A nation sits at least this far from any coast. */
  minInterior: number;
  /** Smallest piece of land that gets a nation. */
  minHome: number;
  /** One more nation per this many tiles of a piece. */
  tilesPerNation: number;
  maxPerHome: number;
  minSpacing: number;
  edgeMargin: number;
  /** Nations placed by hand; their pieces of land get no others. */
  manual?: Nation[];
}

export class Drawing {
  readonly cls: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cls = new Uint8Array(width * height).fill(Cell.Space);
  }

  put(x: number, y: number, c: CellClass): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.cls[y * this.width + x] = c;
  }

  at(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return Cell.Space;
    }
    return this.cls[y * this.width + x];
  }

  /**
   * Clears a disc to space: for the Dark Star and its moat, which the kit
   * clears in any case, so that the nation placer sees the pieces of land
   * the game will have.
   */
  clearDisc(at: Point, r: number): void {
    const cx = Math.round(at[0]);
    const cy = Math.round(at[1]);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.put(x, y, Cell.Space);
      }
    }
  }

  /** Runs `paint` over every pixel; null leaves a pixel as it is. */
  each(paint: (x: number, y: number) => CellClass | null): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const c = paint(x, y);
        if (c !== null) this.cls[y * this.width + x] = c;
      }
    }
  }

  /**
   * A rounded, noisy shape. `paint` gets the pixel's distance from the
   * centre as a share of the local edge (0 centre, 1 edge), its angle and
   * its position, and says what to put there, or null to leave it.
   */
  blob(
    at: Point,
    r: number,
    style: BlobStyle,
    paint: (
      dNorm: number,
      th: number,
      x: number,
      y: number,
    ) => CellClass | null,
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
    const y0 = Math.max(0, cy - margin);
    const y1 = Math.min(this.height - 1, cy + margin);
    const x0 = Math.max(0, cx - margin);
    const x1 = Math.min(this.width - 1, cx + margin);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
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
        if (c !== null) this.put(x, y, c);
      }
    }
  }

  /**
   * A line with a width along a polyline. `halfWidth(t)` is the half width
   * at position t (0 start, 1 end); `paint` gets each nearby pixel's
   * distance from the line, that half width and t. `reach` is how far
   * beyond the half width `paint` still wants to see.
   */
  stroke(
    points: Point[],
    halfWidth: (t: number) => number,
    paint: (d: number, hw: number, t: number) => CellClass | null,
    reach = 0,
  ): void {
    if (points.length < 2) return;
    const cum: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      cum.push(cum[i - 1] + dist(points[i - 1], points[i]));
    }
    const total = cum[cum.length - 1];
    let maxHw = 0;
    for (let i = 0; i <= 20; i++) maxHw = Math.max(maxHw, halfWidth(i / 20));
    const margin = Math.ceil(maxHw + reach) + 2;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    const bx0 = Math.max(0, Math.floor(minX - margin));
    const by0 = Math.max(0, Math.floor(minY - margin));
    const bx1 = Math.min(this.width - 1, Math.ceil(maxX + margin));
    const by1 = Math.min(this.height - 1, Math.ceil(maxY + margin));
    if (bx1 < bx0 || by1 < by0) return;
    const bw = bx1 - bx0 + 1;
    const bh = by1 - by0 + 1;
    const best = new Float32Array(bw * bh).fill(Infinity);
    const bestT = new Float32Array(bw * bh);
    // Each segment only looks at its own surroundings.
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      const vx = bx - ax;
      const vy = by - ay;
      const l2 = vx * vx + vy * vy;
      const sx0 = Math.max(bx0, Math.floor(Math.min(ax, bx) - margin));
      const sx1 = Math.min(bx1, Math.ceil(Math.max(ax, bx) + margin));
      const sy0 = Math.max(by0, Math.floor(Math.min(ay, by) - margin));
      const sy1 = Math.min(by1, Math.ceil(Math.max(ay, by) + margin));
      for (let y = sy0; y <= sy1; y++) {
        for (let x = sx0; x <= sx1; x++) {
          let s = l2 === 0 ? 0 : ((x - ax) * vx + (y - ay) * vy) / l2;
          s = Math.max(0, Math.min(1, s));
          const d = Math.hypot(x - (ax + vx * s), y - (ay + vy * s));
          const k = (y - by0) * bw + (x - bx0);
          if (d < best[k]) {
            best[k] = d;
            bestT[k] = (cum[i - 1] + s * (cum[i] - cum[i - 1])) / total;
          }
        }
      }
    }
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const k = (y - by0) * bw + (x - bx0);
        if (best[k] > margin) continue;
        const c = paint(best[k], halfWidth(bestT[k]), bestT[k]);
        if (c !== null) this.put(x, y, c);
      }
    }
  }

  /**
   * One nation per piece of land big enough to hold one, more on the large
   * pieces, spread farthest-first so each extra nation lands where there is
   * most room, all well away from the star.
   */
  placeNations(o: NationOptions): Nation[] {
    const W = this.width;
    const H = this.height;
    const cls = this.cls;

    // Pieces of land, 4-connected, as the kit counts them.
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

    const nations: Nation[] = [];
    const done = new Set<number>();
    for (const n of o.manual ?? []) {
      const at: Point = [Math.round(n.at[0]), Math.round(n.at[1])];
      if (!isLand(this.at(at[0], at[1]))) {
        throw new Error(
          `The nation placed at (${at[0]}, ${at[1]}) is not on land.`,
        );
      }
      nations.push({ at, where: n.where });
      done.add(label[at[1] * W + at[0]]);
    }

    // Candidates are a grid of interior land pixels.
    const byHome = new Map<number, Point[]>();
    for (let y = o.edgeMargin; y < H - o.edgeMargin; y += 5) {
      for (let x = o.edgeMargin; x < W - o.edgeMargin; x += 5) {
        const i = y * W + x;
        if (!isLand(cls[i]) || interior[i] < o.minInterior) continue;
        if (dist([x, y], o.star) < o.starExclusion) continue;
        const id = label[i];
        if (sizes[id] < o.minHome || done.has(id)) continue;
        let list = byHome.get(id);
        if (list === undefined) {
          list = [];
          byHome.set(id, list);
        }
        list.push([x, y]);
      }
    }
    const homes = [...byHome.entries()].sort(
      (a, b) => sizes[b[0]] - sizes[a[0]],
    );
    for (const [id, candidates] of homes) {
      const want = Math.min(
        o.maxPerHome,
        Math.max(1, Math.round(sizes[id] / o.tilesPerNation)),
      );
      const chosen: Point[] = [];
      // First: the most interior point, so a lone nation sits mid-piece.
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
        if (best === null || bestD < o.minSpacing) break;
        chosen.push(best);
      }
      const where = `home of ${sizes[id].toLocaleString("en-US")} tiles`;
      for (const at of chosen) nations.push({ at, where });
    }
    const homeSizes = sizes.filter((s) => s >= o.minHome).sort((a, b) => b - a);
    console.log(
      `${sizes.length} pieces of land; ${homeSizes.length} of ${o.minHome.toLocaleString("en-US")} tiles or more: ${homeSizes.map((s) => s.toLocaleString("en-US")).join(", ")}`,
    );
    return nations;
  }

  /** Writes the drawing as the kit's PNG and prints what is in it. */
  write(
    mapName: string,
    star: { at: Point; r: number },
    nations: Nation[],
  ): void {
    const file = path.join(ROOT, "map-generator", "drawings", `${mapName}.png`);
    const { width: W, height: H, cls } = this;
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
      if (dist([x, y], star.at) <= star.r) rgb = COLOUR.star;
      rgba[i * 4] = rgb[0];
      rgba[i * 4 + 1] = rgb[1];
      rgba[i * 4 + 2] = rgb[2];
      rgba[i * 4 + 3] = 255;
    }
    for (const n of nations) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          if (dx * dx + dy * dy > 16) continue;
          const x = n.at[0] + dx;
          const y = n.at[1] + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const i = y * W + x;
          rgba[i * 4] = COLOUR.nation[0];
          rgba[i * 4 + 1] = COLOUR.nation[1];
          rgba[i * 4 + 2] = COLOUR.nation[2];
        }
      }
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, encodePng({ width: W, height: H, rgba }));

    const land = counts[2] + counts[3] + counts[4];
    console.log(`Wrote ${path.relative(ROOT, file)}`);
    console.log(
      `Land ${land.toLocaleString("en-US")} (plains ${counts[2]}, highland ${counts[3]}, mountain ${counts[4]}), space ${counts[0]}, void ${counts[1]}`,
    );
    console.log(`${nations.length} nations:`);
    for (const n of nations) {
      console.log(`  (${n.at[0]}, ${n.at[1]})  ${n.where}`);
    }
  }
}
