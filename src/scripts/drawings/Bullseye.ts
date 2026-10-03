/**
 * Draws the map "Bullseye" (map-generator/drawings/Bullseye.png).
 *
 *   npx tsx src/scripts/drawings/Bullseye.ts    writes the drawing
 *   npm run map "Bullseye"                      builds the map from it
 *
 * The idea (Tom's sketch, MapImages/Bullseye.png): the Dark Star is the
 * bull and three concentric rings of land surround it.
 *
 * Play: each ring is cracked into arcs, so every arc is its own piece of
 * land with its own nation, and the cracks of one ring do not line up with
 * the next. The inner ring is inside the throne's shadow and seats nobody:
 * it is Tribe land, the last stepping stone before the moat. The rings
 * face the star with a ridge, so a landing from the inside is the slow
 * way in; along the rings the land is open.
 */
import {
  Cell,
  CellClass,
  deg,
  dist,
  Drawing,
  fbm,
  Point,
  ringNoise,
  STANDARD_MOAT,
  STANDARD_STAR_RADIUS,
} from "./Drawing";

const W = 1800;
const H = 1800;
const d = new Drawing(W, H);

const STAR: Point = [900, 900];
const STAR_R = STANDARD_STAR_RADIUS;

interface Ring {
  /** Inner and outer radius before the edges wander. */
  r0: number;
  r1: number;
  /** How many arcs the ring is cracked into, and how wide the cracks are. */
  arcs: number;
  gap: number;
  /** Where the first crack is, degrees. */
  phase: number;
  seed: number;
}

const RINGS: Ring[] = [
  { r0: 320, r1: 362, arcs: 6, gap: 34, phase: 0, seed: 1 },
  { r0: 505, r1: 562, arcs: 8, gap: 48, phase: 22.5, seed: 2 },
  { r0: 715, r1: 780, arcs: 12, gap: 52, phase: 7, seed: 3 },
];

/** Beyond the outer ring the corners fade to void. */
const VOID_R = 1010;

// ---------------------------------------------------------------------------

const angleDiff = (a: number, b: number): number => {
  let x = a - b;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return Math.abs(x);
};

function paintRings(): void {
  d.each((x, y) => {
    const r = dist([x, y], STAR);
    const th = Math.atan2(y - STAR[1], x - STAR[0]);
    if (r > VOID_R + 60 * fbm(x / 140, y / 140, 11, 3)) return Cell.Void;
    for (const ring of RINGS) {
      // The ring swells and thins slowly round the circle; its two edges
      // ripple on top of that.
      const swell = 12 * ringNoise(th, 2, ring.seed + 10);
      const inner = ring.r0 - swell + 7 * ringNoise(th, 7, ring.seed);
      const outer = ring.r1 + swell + 7 * ringNoise(th, 7, ring.seed + 20);
      if (r < inner || r > outer) continue;
      // The cracks.
      const step = (2 * Math.PI) / ring.arcs;
      for (let k = 0; k < ring.arcs; k++) {
        const jitter = deg(5) * ringNoise(k * 1.7, 1, ring.seed + 40);
        const crackAt = deg(ring.phase) + k * step + jitter;
        const s = angleDiff(th, crackAt) * r;
        const hw =
          (ring.gap / 2) * (1 + 0.3 * fbm(r / 18, k * 3.1, ring.seed + 50, 2));
        if (s < hw) return Cell.Space;
      }
      // The ridge facing the star, then open ground with a few pocks.
      const fromInner = r - inner;
      const width = outer - inner;
      let c: CellClass = Cell.Plains;
      if (fromInner < 7 && width > 50) c = Cell.Mountain;
      else if (fromInner < 18) c = Cell.Highland;
      else if (fbm(x / 30, y / 30, ring.seed + 60, 3) > 0.52) c = Cell.Highland;
      return c;
    }
    return null;
  });
}

// ---------------------------------------------------------------------------

function main(): void {
  paintRings();
  d.clearDisc(STAR, STAR_R + STANDARD_MOAT);
  const nations = d.placeNations({
    star: STAR,
    starExclusion: 500,
    minInterior: 14,
    minHome: 7_000,
    tilesPerNation: 26_000,
    maxPerHome: 2,
    minSpacing: 200,
    edgeMargin: 50,
  });
  d.write("Bullseye", { at: STAR, r: STAR_R }, nations);
}

main();
