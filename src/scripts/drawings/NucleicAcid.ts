/**
 * Draws the map "Nucleic Acid" (map-generator/drawings/Nucleic Acid.png).
 *
 *   npx tsx src/scripts/drawings/NucleicAcid.ts    writes the drawing
 *   npm run map "Nucleic Acid"                     builds the map from it
 *
 * The idea (Tom's sketch, MapImages/Nucleic Acid.png): a double helix of
 * land runs top to bottom with the Dark Star at its centre. The two strands
 * are solid walls; in each bulge between them a row of closely packed round
 * islands, the base pairs, almost bridges the gap.
 *
 * Play: the strands are long roads that end on the moat from the four
 * diagonals, so land armies can march at the throne along them. Where the
 * strands cross, one passes behind the other with a short gap, so each
 * strand is several pieces and a crossing costs a fleet hop. The base pairs
 * are stepping stones between the strands; the two rows nearest the throne
 * are staging islands that nobody starts on.
 */
import {
  Cell,
  dist,
  Drawing,
  fbm,
  mulberry32,
  Point,
  polar,
  ringNoise,
  STANDARD_MOAT,
  STANDARD_STAR_RADIUS,
} from "./Drawing";

const W = 1800;
const H = 1800;
const SEED = 20261004;
const d = new Drawing(W, H);
const rand = mulberry32(SEED);
const between = (lo: number, hi: number): number => lo + (hi - lo) * rand();

const STAR: Point = [900, 900];
const STAR_R = STANDARD_STAR_RADIUS;

/** The helix: how far each strand swings from the axis, and its period. */
const SWING = 400;
const PERIOD = 1200;
/** The first full bulge is centred here; crossings are a quarter period
 * either side, so one crossing is the Dark Star itself. */
const BULGE_Y = 600;
const WALL_HW = 27;
/** The gap where one strand passes behind the other at a crossing. */
const CROSSING_GAP = 95;

const strandX = (side: 1 | -1, y: number): number =>
  STAR[0] + side * SWING * Math.cos((2 * Math.PI * (y - BULGE_Y)) / PERIOD);

// ---------------------------------------------------------------------------

function paintVoid(): void {
  d.each((x, y) => {
    const wobble = 50 * fbm(x / 120, y / 120, 11, 3);
    if (x < 130 + wobble || x > W - 130 + wobble) return Cell.Void;
    return null;
  });
}

function paintStrands(): void {
  // At the crossing above the star the left-swinging strand passes behind;
  // at the one below, the other does.
  const crossings: { at: Point; behind: 1 | -1 }[] = [
    { at: [STAR[0], BULGE_Y - PERIOD / 4], behind: -1 },
    { at: [STAR[0], BULGE_Y + (3 * PERIOD) / 4], behind: 1 },
  ];
  for (const side of [1, -1] as const) {
    let piece: Point[] = [];
    const pieces: Point[][] = [piece];
    for (let y = -40; y <= H + 40; y += 6) {
      const x = strandX(side, y) + 7 * fbm(y / 90, side * 3, 20 + side, 3);
      const p: Point = [x, y];
      const cut = crossings.some(
        (c) => c.behind === side && dist(p, c.at) < CROSSING_GAP,
      );
      if (cut) {
        if (piece.length > 0) {
          piece = [];
          pieces.push(piece);
        }
        continue;
      }
      piece.push(p);
    }
    for (const points of pieces) {
      d.stroke(
        points,
        (t) => WALL_HW * (1 + 0.08 * fbm(t * 30, side * 7, 30 + side, 2)),
        (dd, hw) => {
          if (dd <= hw * 0.65) return Cell.Plains;
          if (dd <= hw) return Cell.Highland;
          return null;
        },
      );
    }
  }
}

interface Row {
  y: number;
  r: number;
  n: number;
}

/** One row of base pairs per bulge; the edge rows are partly off the map. */
const ROWS: Row[] = [
  { y: 70, r: 48, n: 4 },
  { y: BULGE_Y, r: 66, n: 4 },
  { y: BULGE_Y + PERIOD / 2, r: 66, n: 4 },
  { y: 1730, r: 48, n: 4 },
];

function paintBasePairs(): void {
  ROWS.forEach((row, ri) => {
    const a = strandX(1, row.y);
    const b = strandX(-1, row.y);
    const left = Math.min(a, b) + WALL_HW;
    const right = Math.max(a, b) - WALL_HW;
    const span = right - left;
    const gap = (span - row.n * 2 * row.r) / (row.n + 1);
    for (let i = 0; i < row.n; i++) {
      const r = row.r * between(0.9, 1.1);
      const cx = left + gap + row.r + i * (2 * row.r + gap);
      const cy = row.y + between(-12, 12);
      const seed = 100 + ri * 10 + i;
      // The high ground sits off-centre so the islands are not bullseyes.
      const high = polar([cx, cy], rand() * Math.PI * 2, r * 0.25);
      d.blob([cx, cy], r, { amp: 0.06, freq: 3, seed }, (_dd, th, x, y) => {
        const dd = dist([x, y], high) / r;
        const wob = 1 + 0.3 * ringNoise(th, 2, seed + 50);
        if (r >= 60 && dd < 0.2 * wob) return Cell.Mountain;
        if (dd < 0.46 * wob) return Cell.Highland;
        return Cell.Plains;
      });
    }
  });
}

// ---------------------------------------------------------------------------

function main(): void {
  paintVoid();
  paintStrands();
  paintBasePairs();
  d.clearDisc(STAR, STAR_R + STANDARD_MOAT);
  const nations = d.placeNations({
    star: STAR,
    // 500 keeps every base pair of the two middle rows free of nations: at
    // 380, which seated the outer two of each row, one of those four
    // overthrew the throne in all three AI rounds.
    starExclusion: 500,
    minInterior: 16,
    minHome: 7_000,
    tilesPerNation: 22_000,
    maxPerHome: 4,
    minSpacing: 180,
    edgeMargin: 50,
  });
  d.write("Nucleic Acid", { at: STAR, r: STAR_R }, nations);
}

main();
