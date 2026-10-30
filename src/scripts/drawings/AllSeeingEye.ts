/**
 * Draws the map "All Seeing Eye" (map-generator/drawings/All Seeing Eye.png).
 *
 *   npx tsx src/scripts/drawings/AllSeeingEye.ts    writes the drawing
 *   npm run map "All Seeing Eye"                    builds the map from it
 *
 * The idea (Tom, from a stock engraving of the Eye of Providence, which is
 * not in the repo; the motif is old and free): an eye in a triangle of
 * light, floating over an unfinished pyramid, rays of glory round it. The
 * Dark Star is the eye's pupil, and the mortar between the pyramid's
 * bricks is deep space.
 *
 * Taken as a reference, not a template: in the engraving the eye is far too
 * small to hold a Dark Star, so the capstone is drawn larger and a little
 * squatter, the eye wide open round a star smaller than the standard one.
 * The capstone is an outline with the eye and its brow inside and deep
 * space between, as the engraving is line work; the eye's corners meet the
 * outline, so the capstone is one piece. The rays are dashed, as drawn: chains of small
 * islands fanning out over the top. The pyramid is courses of bricks laid
 * in a stagger, cut by its sloping sides, with long stones in the bottom
 * course; its left side is in shadow (more high ground stippled on it).
 *
 * Play: every brick is an island, so the pyramid is a field of short
 * fleet hops, much like Periodic's cards. The capstone, the rays and the
 * top courses are Baron land; the Lords sit on bricks beyond
 * STAR_EXCLUSION, picked farthest-first.
 */
import {
  Cell,
  CellClass,
  deg,
  dist,
  Drawing,
  fbm,
  isLand,
  Nation,
  Point,
  polar,
} from "./Drawing";

const W = 1800;
const H = 1800;
const d = new Drawing(W, H);
const CX = W / 2;

// ---------------------------------------------------------------------------
// The capstone and the eye

/** The capstone: apex, height and the half width of its base. */
const CAP_APEX: Point = [CX, 294];
const CAP_H = 560;
const CAP_HALF = 370;
/** The outline's width. */
const CAP_RIM = 34;

/** The eye sits this far down the capstone, as a share of its height. */
const EYE_DEPTH = 0.68;
const EYE: Point = [CX, Math.round(CAP_APEX[1] + CAP_H * EYE_DEPTH)];
/** The eye's almond: half its length (to the outline) and half its height. */
const EYE_HALF_H = 140;
/** The lids' thickness. */
const LID = 14;

/** The pupil: the Dark Star, and the iris round its moat. */
const STAR: Point = EYE;
const STAR_R = 80;
const MOAT = 18;
const IRIS = 26;

/** The brow over the eye: how far above the almond, and its half width. */
const BROW_LIFT = 34;
const BROW_HW = 8;

// The rays of glory, round the eye.
const RAY_COUNT = 25;
/** The fan's spread either side of straight up, in degrees. */
const RAY_SPREAD = 112;
/** Where the rays end, from the eye; long and short rays take turns. */
const RAY_OUT: [number, number] = [640, 540];
const RAY_IN = 400;
/** Clearance between a ray and the capstone. */
const RAY_CLEAR = 45;
const DASH = 48;
const DASH_GAP = 26;
const DASH_HW = 5;

// ---------------------------------------------------------------------------
// The pyramid

/** The pyramid's top and base, and its half width at each. */
const PYR_TOP = CAP_APEX[1] + CAP_H + 60;
const PYR_BASE = 1740;
const PYR_TOP_HALF = 330;
const PYR_BASE_HALF = 760;
/** Courses of bricks, and the deep space between bricks. */
const COURSES = 15;
const BRICK_LEN = 108;
const MORTAR = 18;
/** The bottom course is laid in stones this many bricks long. */
const PLINTH_BRICKS = 3;

// At 600 the AI rounds came out no better (12m40s to 16m55s, 3 of 3 by gate).
const STAR_EXCLUSION = 500;
const LORDS = 20;

// ---------------------------------------------------------------------------

/** The capstone's half width at a y, or -1 above its apex or below its base. */
function capHalf(y: number): number {
  const t = (y - CAP_APEX[1]) / CAP_H;
  if (t < 0 || t > 1) return -1;
  return CAP_HALF * t;
}

/** The almond's half height at u, the offset along the eye from its centre. */
function almond(u: number, halfLen: number): number {
  const t = u / halfLen;
  return Math.abs(t) >= 1 ? 0 : EYE_HALF_H * (1 - t * t);
}

function paintCapstone(): void {
  // The eye reaches out to the outline.
  const eyeHalfLen = capHalf(EYE[1]);
  // How far the outline's inner edge is from the outer, along the normal.
  const slope = Math.hypot(CAP_H, CAP_HALF) / CAP_H;
  d.each((x, y) => {
    const half = capHalf(y);
    if (half < 0) return null;
    const dx = Math.abs(x - CX);
    if (dx > half) return null;
    // The outline: within CAP_RIM of a side or of the base.
    const toSide = (half - dx) / slope;
    const toBase = CAP_APEX[1] + CAP_H - y;
    if (toSide < CAP_RIM || toBase < CAP_RIM) {
      return toSide < CAP_RIM * 0.45 || toBase < CAP_RIM * 0.45
        ? Cell.Mountain
        : Cell.Highland;
    }
    // The eye.
    const u = x - EYE[0];
    const v = y - EYE[1];
    const ah = almond(u, eyeHalfLen);
    if (Math.abs(v) <= ah) {
      const r = Math.hypot(u, v);
      if (r <= STAR_R + MOAT + IRIS) {
        // The iris, streaked like the engraving's.
        const streak = Math.abs(Math.sin(Math.atan2(v, u) * 12));
        return streak < 0.35 ? Cell.Mountain : Cell.Highland;
      }
      if (Math.abs(v) > ah - LID) return Cell.Mountain;
      return Cell.Plains;
    }
    // The brow: an arc over the eye.
    const browY = EYE[1] - almond(u, eyeHalfLen * 0.95) - BROW_LIFT;
    if (Math.abs(u) < eyeHalfLen * 0.82 && Math.abs(y - browY) < BROW_HW) {
      return Cell.Highland;
    }
    return null;
  });
}

/** Distance from the eye to the capstone's outline along an angle. */
function capReach(angle: number): number {
  for (let r = 0; r < 1200; r += 2) {
    const [x, y] = polar(EYE, angle, r);
    const half = capHalf(y);
    if (half < 0 || Math.abs(x - CX) > half) return r;
  }
  return 1200;
}

function paintRays(): void {
  for (let i = 0; i < RAY_COUNT; i++) {
    const offset = -RAY_SPREAD + (2 * RAY_SPREAD * i) / (RAY_COUNT - 1);
    const angle = deg(-90 + offset);
    const start = Math.max(RAY_IN, capReach(angle) + RAY_CLEAR);
    const end = RAY_OUT[i % 2];
    // Dashes from the outside in, so every ray ends on a whole dash.
    for (let r = end; r - DASH >= start; r -= DASH + DASH_GAP) {
      d.stroke(
        [polar(EYE, angle, r - DASH), polar(EYE, angle, r)],
        () => DASH_HW,
        (dd, hw) => (dd <= hw ? Cell.Highland : null),
      );
    }
  }
}

// ---------------------------------------------------------------------------

interface Brick {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The pyramid's half width at a y. */
function pyrHalf(y: number): number {
  const t = (y - PYR_TOP) / (PYR_BASE - PYR_TOP);
  return PYR_TOP_HALF + (PYR_BASE_HALF - PYR_TOP_HALF) * t;
}

function bricks(): Brick[] {
  const out: Brick[] = [];
  const course = (PYR_BASE - PYR_TOP) / COURSES;
  for (let c = 0; c < COURSES; c++) {
    const top = Math.round(PYR_TOP + c * course);
    const bottom = Math.round(PYR_TOP + (c + 1) * course) - MORTAR;
    const plinth = c === COURSES - 1;
    const len = plinth ? BRICK_LEN * PLINTH_BRICKS : BRICK_LEN;
    // Every other course is laid half a brick over.
    const shift = c % 2 === 0 ? 0 : BRICK_LEN / 2;
    const reach = pyrHalf(bottom) + len;
    for (
      let k = -Math.ceil(reach / len) - 1;
      k <= Math.ceil(reach / len);
      k++
    ) {
      const left = Math.round(CX + shift + k * len - (plinth ? len / 2 : 0));
      out.push({ left, right: left + len - MORTAR, top, bottom });
    }
  }
  return out;
}

function paintPyramid(all: Brick[]): void {
  for (const b of all) {
    for (let y = b.top; y < b.bottom; y++) {
      const half = pyrHalf(y);
      for (let x = b.left; x < b.right; x++) {
        if (Math.abs(x - CX) > half) continue;
        d.put(x, y, brickCell(x, y, b, half));
      }
    }
  }
}

function brickCell(x: number, y: number, b: Brick, half: number): CellClass {
  // A shadowed lower edge gives each brick some relief.
  if (b.bottom - y <= 5) return Cell.Highland;
  // Stipple, thicker towards the shaded left side.
  const across = (x - (CX - half)) / (2 * half);
  const shade = 0.22 * Math.max(0, 1 - across * 2.5);
  const dots = fbm(x / 5, y / 5, 31, 2) + shade;
  if (dots > 0.62) return Cell.Mountain;
  if (dots > 0.42) return Cell.Highland;
  return Cell.Plains;
}

/** How much of a brick is land once the sides cut it. */
function brickLand(b: Brick): number {
  let n = 0;
  for (let y = b.top; y < b.bottom; y++) {
    for (let x = b.left; x < b.right; x++) if (isLand(d.at(x, y))) n++;
  }
  return n;
}

function placeLords(all: Brick[]): Nation[] {
  const centre = (b: Brick): Point => [
    Math.round((b.left + b.right) / 2),
    Math.round((b.top + b.bottom) / 2),
  ];
  const full = (BRICK_LEN - MORTAR) * (all[0].bottom - all[0].top);
  const open = all.filter(
    (b) =>
      dist(centre(b), STAR) >= STAR_EXCLUSION &&
      brickLand(b) >= full * 0.9 &&
      isLand(d.at(...centre(b))),
  );
  console.log(
    `${open.length} whole bricks lie ${STAR_EXCLUSION}+ from the star`,
  );
  const chosen: Brick[] = [
    open.reduce((a, b) =>
      dist(centre(b), STAR) > dist(centre(a), STAR) ? b : a,
    ),
  ];
  while (chosen.length < LORDS && chosen.length < open.length) {
    let best = open[0];
    let bestD = -1;
    for (const b of open) {
      const dd = Math.min(...chosen.map((q) => dist(centre(q), centre(b))));
      if (dd > bestD) {
        bestD = dd;
        best = b;
      }
    }
    chosen.push(best);
  }
  return chosen.map((b) => ({
    at: centre(b),
    where: `brick ${Math.round(dist(centre(b), STAR))} from the star`,
  }));
}

function main(): void {
  paintCapstone();
  paintRays();
  const all = bricks();
  paintPyramid(all);
  d.clearDisc(STAR, STAR_R + MOAT);

  let near = 0;
  let far = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isLand(d.at(x, y))) continue;
      if (dist([x, y], STAR) < STAR_EXCLUSION) near++;
      else far++;
    }
  }
  console.log(
    `Star at (${STAR[0]}, ${STAR[1]}); land within ${STAR_EXCLUSION} of it ${near.toLocaleString("en-US")}, beyond ${far.toLocaleString("en-US")}`,
  );
  d.write("All Seeing Eye", { at: STAR, r: STAR_R }, placeLords(all));
}

main();
