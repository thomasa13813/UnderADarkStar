/**
 * Draws the map "Wurm" (map-generator/drawings/Wurm.png).
 *
 *   npx tsx src/scripts/drawings/Wurm.ts    writes the drawing
 *   npm run map "Wurm"                      builds the map from it
 *
 * The idea (Tom's sketch, MapImages/Wurm.png, taken as a reference rather
 * than a template): a sand worm out of Dune, long and thick, undulating down
 * a long, narrow map, its mouth open at one end with the Dark Star in its
 * mouth. The body is a row of thick segments with deep space between them.
 *
 * Shape: a spine that swings gently up and down along the map, straightening
 * at the neck so the mouth faces the star square on. Each body segment is a
 * thick, straight plate set square across the spine, so the plates lean with
 * the swing and the gaps open wider on the outside of each bend. The worm
 * thickens from the tail to the neck. The mouth is seen from the side, as
 * in the sketch: three broad, rounded flaps hinged just ahead of the last
 * segment, the upper and lower ones opened forward and curled round the top
 * and bottom of the star, the third seen edge on between them, reaching for
 * it. Each has a ridge round its edge and ribs across it.
 *
 * Play: Lords on the body segments, none within STAR_EXCLUSION of the star,
 * so the flaps and the nearest segments are Baron land; each flap is its
 * own piece, no bigger than a body segment. Every gap is a short fleet
 * hop and open space runs along both flanks, so the map is a long march to
 * the throne: the Lords near the head fight for it first, the tail has time
 * to build.
 */
import { Cell, CellClass, dist, Drawing, fbm, isLand, Point } from "./Drawing";

const W = 3800;
const H = 960;
const d = new Drawing(W, H);

const STAR: Point = [W - 300, H / 2];
const STAR_R = 115;
/** The kit's moat on a map whose shorter side is 960 (its 15-tile floor). */
const MOAT = 15;
// At 500 and 850 on the first Wurm the throne fell 3 of 3 just the same.
const STAR_EXCLUSION = 700;

// The spine ----------------------------------------------------------------

/** The tail's tip and the end of the last body segment, along x. */
const TAIL_X = 60;
const NECK_X = STAR[0] - 400;
/** The swing: height of a crest and length of one full wave. */
const SWING = 118;
const WAVE = 1700;
const PHASE = 0.9;
/** Over this far before the neck the swing dies away to a straight neck. */
const STRAIGHTEN = 650;

// The body segments ---------------------------------------------------------

/** Spine length per segment, and the space between plates at the spine. */
const PITCH = 214;
const GAP = 72;
/** Half the body's thickness at the tail and at the neck. */
const HALF_TAIL = 105;
const HALF_NECK = 225;
/** Plate rims facing a gap are highland this many tiles deep. */
const RIM = 10;

// The mouth: three flaps hinged at the head, seen from the side ------------

/** Where the flaps are hinged, just ahead of the last body segment. */
const HINGE_X = NECK_X + 34;
/** The widest half width of the upper and lower flaps, and of the middle one. */
const OUTER_FLAP_HALF = 82;
const MIDDLE_FLAP_HALF = 64;
/** The space between the middle flap's tip and the moat. */
const MIDDLE_FLAP_CLEAR = 32;
/** How far along its length a flap is broadest, as a share of it. */
const WIDEST = 0.4;
/** Ribs across the flaps: one every RIB_PITCH tiles, this thick. */
const RIB_PITCH = 40;
const RIB = 9;

// ---------------------------------------------------------------------------

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function spineY(x: number): number {
  const fade = 1 - smoothstep(NECK_X - STRAIGHTEN, NECK_X - 80, x);
  return STAR[1] + SWING * fade * Math.sin((2 * Math.PI * x) / WAVE + PHASE);
}

/** Half thickness along the spine, s from 0 (tail) to 1 (neck). */
const halfAt = (s: number): number =>
  HALF_TAIL + (HALF_NECK - HALF_TAIL) * smoothstep(0, 0.55, s) ** 0.8;

function paintBody(): void {
  // The spine, sampled with its length so far.
  const pts: Point[] = [];
  for (let x = TAIL_X; x <= NECK_X; x += 0.5) pts.push([x, spineY(x)]);
  const arc: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    arc.push(arc[i - 1] + dist(pts[i - 1], pts[i]));
  }
  const total = arc[arc.length - 1];
  const sampleAt = (s: number): number => {
    let i = 0;
    while (i < arc.length - 1 && arc[i] < s) i++;
    return i;
  };

  // Each plate is straight, square across the spine at its middle; plates
  // are counted back from the neck so the last one ends there.
  const plates = Math.floor((total + GAP) / PITCH);
  const len = PITCH - GAP;
  for (let p = 0; p < plates; p++) {
    const sMid = total - len / 2 - p * PITCH;
    const i = sampleAt(sMid);
    const c = pts[i];
    const a = pts[Math.max(0, i - 2)];
    const b = pts[Math.min(pts.length - 1, i + 2)];
    const tl = dist(a, b);
    const t: Point = [(b[0] - a[0]) / tl, (b[1] - a[1]) / tl];
    const half = halfAt(sMid / total);
    const box = Math.ceil(Math.hypot(len / 2, half) * 1.15) + 4;
    for (let y = Math.round(c[1]) - box; y <= Math.round(c[1]) + box; y++) {
      for (let x = Math.round(c[0]) - box; x <= Math.round(c[0]) + box; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const dx = x - c[0];
        const dy = y - c[1];
        // Along the spine (u) and across it (v), the edges wandering a little.
        const u = dx * t[0] + dy * t[1] + 6 * fbm(x / 50, y / 50, 3, 3);
        const v = -dx * t[1] + dy * t[0];
        const h = half * (1 + 0.07 * fbm(x / 80, y / 80, 5 + p, 3));
        const ua = Math.abs(u) / (len / 2);
        const vb = Math.abs(v) / h;
        // Rounded at the flanks, squarer along the gaps: a thick ring of hide.
        if (ua ** 5 + vb ** 2.4 > 1) continue;
        const fromEnd = len / 2 - Math.abs(u);
        const grain = fbm(x / 40, y / 40, 9, 3);
        let cell: CellClass = Cell.Plains;
        if (fromEnd < RIM || vb > 0.92 || grain > 0.45) cell = Cell.Highland;
        d.put(x, y, cell);
      }
    }
  }
}

/** Points along a cubic Bézier, for a flap's curved middle line. */
function bezier(p: Point[], n = 60): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    out.push([
      k[0] * p[0][0] + k[1] * p[1][0] + k[2] * p[2][0] + k[3] * p[3][0],
      k[0] * p[0][1] + k[1] * p[1][1] + k[2] * p[2][1] + k[3] * p[3][1],
    ]);
  }
  return out;
}

/**
 * A flap's half width along its length: broad at the hinge, broadest a
 * little way out, then a rounded end.
 */
const flapWidth =
  (max: number, base: number) =>
  (t: number): number =>
    t < WIDEST
      ? max * (base + (1 - base) * smoothstep(0, WIDEST, t))
      : max * Math.sqrt(Math.max(0, 1 - ((t - WIDEST) / (1 - WIDEST)) ** 2));

/** The flaps are drawn here first, then cut at the hinge and copied over. */
const mouth = new Drawing(W, H);

function paintFlap(line: Point[], width: (t: number) => number): void {
  let length = 0;
  for (let i = 1; i < line.length; i++) length += dist(line[i - 1], line[i]);
  mouth.stroke(line, width, (dd, hw, t) => {
    if (dd > hw) return null;
    // A ridge round the edge and ribs across the flap, like the inside of
    // a sand worm's mouth.
    if (hw - dd < 9) return Cell.Mountain;
    if ((t * length) % RIB_PITCH < RIB && t > 0.08) return Cell.Highland;
    return Cell.Plains;
  });
}

function paintMouth(): void {
  const [sx, sy] = STAR;
  const hx = HINGE_X;
  // The upper and lower flaps open forward and curl round the star.
  for (const side of [-1, 1]) {
    const line = bezier([
      [hx + 48, sy + side * 135],
      [hx + 110, sy + side * 310],
      [sx + 15, sy + side * 355],
      [sx + 185, sy + side * 240],
    ]);
    paintFlap(line, flapWidth(OUTER_FLAP_HALF, 0.6));
  }
  // The third flap, seen edge on between them, reaches for the star.
  paintFlap(
    [
      [hx + 40, sy],
      [sx - STAR_R - MOAT - MIDDLE_FLAP_CLEAR, sy],
    ],
    flapWidth(MIDDLE_FLAP_HALF, 0.65),
  );
  // Cut the flaps' round ends off at the hinge, so a crease of space keeps
  // them apart from the neck, and let their edges wander a little.
  d.each((x, y) => {
    if (x < hx) return null;
    const c = mouth.at(
      Math.round(x + 5 * fbm(x / 45, y / 45, 61, 3)),
      Math.round(y + 5 * fbm(x / 45, y / 45, 62, 3)),
    );
    return isLand(c) ? (c as CellClass) : null;
  });
}
// ---------------------------------------------------------------------------

function main(): void {
  paintBody();
  paintMouth();
  d.clearDisc(STAR, STAR_R + MOAT);
  const nations = d.placeNations({
    star: STAR,
    starExclusion: STAR_EXCLUSION,
    minInterior: 16,
    minHome: 9_000,
    tilesPerNation: 26_000,
    maxPerHome: 2,
    minSpacing: 170,
    edgeMargin: 30,
  });
  d.write("Wurm", { at: STAR, r: STAR_R }, nations);
}

main();
