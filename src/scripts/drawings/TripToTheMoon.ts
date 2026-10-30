/**
 * Draws the map "Trip to the Moon" (map-generator/drawings/Trip to the Moon.png).
 *
 *   npx tsx src/scripts/drawings/TripToTheMoon.ts    writes the drawing
 *   npm run map "Trip to the Moon"                   builds the map from it
 *
 * The idea (Tom, from the most famous frame of Georges Méliès's 1902 film
 * A Trip to the Moon): the Man in the Moon with the explorers' shell stuck
 * in his right eye, and the Dark Star where the shell strikes the eye.
 *
 * Positions are measured off the 258 × 263 frame (`IMG_*`, frame pixels)
 * and carried onto the map by `fromImg`. The moon is a cratered disc of
 * nebula with the face in high ground: heavy brows, the open left eye as a
 * lake of deep space with the pupil an island in it, the nose a ridge, the
 * mouth an inland sea between two lips. The shell is its own piece: a long
 * cylinder ringed at the open back, lying across the moon's upper left with
 * a channel of space round it, its nose buried in the moat.
 *
 * The standard Dark Star is wider than the space between the face's eyes,
 * so this star is drawn smaller (as on Wurm and Periodic).
 *
 * Play: the star sits near the middle of one great continent, so the face
 * and the shell are Baron land and the Lords ring the moon's lower and
 * right limb, beyond STAR_EXCLUSION. The large craters are lakes of deep
 * space, which keep the moon's land near budget and give fleets short hops
 * across the face.
 */
import {
  add,
  Cell,
  CellClass,
  dist,
  Drawing,
  fbm,
  isLand,
  mul,
  mulberry32,
  Point,
  polar,
  STANDARD_MOAT,
} from "./Drawing";

const W = 1800;
const H = 1800;
const SEED = 19020901;
const d = new Drawing(W, H);
const rand = mulberry32(SEED);
const between = (lo: number, hi: number): number => lo + (hi - lo) * rand();

// ---------------------------------------------------------------------------
// The frame and the map

/** The moon's centre and radius in the frame. */
const IMG_CENTRE: Point = [136, 136];
const IMG_R = 118;
/** The moon on the map. */
const MOON: Point = [940, 905];
const MOON_R = 610;
/** Map tiles per frame pixel. */
const S = MOON_R / IMG_R;
const fromImg = (p: Point): Point =>
  add(MOON, mul([p[0] - IMG_CENTRE[0], p[1] - IMG_CENTRE[1]], S));
const px = (n: number): number => n * S;

/** The Dark Star: the moon's right eye, where the shell strikes. */
const STAR: Point = (() => {
  const p = fromImg([104, 124]);
  return [Math.round(p[0]), Math.round(p[1])];
})();
const STAR_R = 120;
const MOAT = STANDARD_MOAT;
const STAR_EXCLUSION = 500;

// The shell: from the centre of its open back to the tip of its nose.
const SHELL_BACK = fromImg([24, 84]);
const SHELL_NOSE = fromImg([117, 119]);
const SHELL_AXIS = mul(
  [SHELL_NOSE[0] - SHELL_BACK[0], SHELL_NOSE[1] - SHELL_BACK[1]],
  1 / dist(SHELL_NOSE, SHELL_BACK),
);
const SHELL_LEN = dist(SHELL_NOSE, SHELL_BACK);
const SHELL_HW = px(29);
/** The cylinder runs this share of the length; the nose rounds off after it. */
const SHELL_BODY = 0.62;
/** The open back seen at an angle: an ellipse, half its depth along the axis. */
const SHELL_BACK_DEPTH = px(11);
const SHELL_BACK_HW = px(31);
/** The channel of space between the shell and the moon. */
const SHELL_GAP = 8;

// ---------------------------------------------------------------------------
// The moon

function paintMoon(): void {
  d.each((x, y) => {
    const dx = x - MOON[0];
    const dy = y - MOON[1];
    const r = Math.hypot(dx, dy);
    if (r > MOON_R * 1.05) return null;
    const th = Math.atan2(dy, dx);
    // A lumpy limb, as the plaster moon has.
    const limb =
      MOON_R *
      (1 +
        0.012 * fbm(Math.cos(th) * 4 + 50, Math.sin(th) * 4 + 50, 1, 3) +
        0.006 * fbm(Math.cos(th) * 30 + 9, Math.sin(th) * 30 + 9, 2, 2));
    if (r > limb) return null;
    // Lumps all over the surface.
    const lump = fbm(x / 34, y / 34, 3, 3);
    if (lump > 0.56) return Cell.Mountain;
    if (lump > 0.3) return Cell.Highland;
    return Cell.Plains;
  });
}

const onMoon = (p: Point, margin = 0): boolean =>
  dist(p, MOON) <= MOON_R - margin;

/**
 * A crater: a rim of high ground round a floor. The floor of a large crater
 * is deep space, of a small one plains; the largest keep a central peak.
 * Paints only where there is moon.
 */
function crater(at: Point, r: number, seed: number): void {
  const lake = r >= 34;
  // Some craters are worn, with broad rims; some fresh, with sharp ones.
  const floor = 0.62 + 0.14 * ((seed * 0.618) % 1);
  const elong = 1 + 0.2 * ((seed * 0.377) % 1);
  const angle = seed * 2.4;
  d.blob(at, r, { elong, angle, amp: 0.13, freq: 3, seed }, (dd, _th, x, y) => {
    if (!isLand(d.at(x, y))) return null;
    if (dd > floor + 0.2) return Cell.Highland;
    if (dd > floor) return r >= 40 ? Cell.Mountain : Cell.Highland;
    if (r >= 80 && dd < 0.12) return Cell.Mountain;
    return lake ? Cell.Space : Cell.Plains;
  });
}

/** Craters seen in the frame: [x, y, radius] in frame pixels. */
const FRAME_CRATERS: [number, number, number][] = [
  [68, 58, 6],
  [116, 34, 5],
  [147, 42, 6],
  [205, 45, 8],
  [224, 72, 7],
  [231, 106, 11],
  [227, 151, 8],
  [45, 140, 12],
  [57, 166, 9],
  [42, 192, 8],
  [96, 162, 6],
  [108, 197, 7],
  [80, 228, 9],
  [126, 246, 7],
  [180, 236, 9],
  [211, 210, 9],
  [200, 182, 5],
];
/** Frame craters are drawn this much larger: holes worth sailing round. */
const FRAME_CRATER_SCALE = 1.7;

/** More craters scattered by seed: how many, and their radii in tiles. */
const EXTRA_CRATERS = 44;
const EXTRA_R: [number, number] = [px(4), px(14)];

/** The face's features, [x, y, radius] in frame pixels: no scattered
 * crater lands on them. */
const FEATURES: [number, number, number][] = [
  [168, 120, 27],
  [104, 102, 14],
  [143, 136, 14],
  [150, 156, 13],
  [159, 188, 40],
  [160, 216, 15],
  [204, 150, 11],
];
const onFeature = (at: Point, r: number): boolean =>
  FEATURES.some(([x, y, fr]) => dist(at, fromImg([x, y])) < px(fr) + r * 0.6);

function paintCraters(): void {
  const placed: { at: Point; r: number }[] = [];
  FRAME_CRATERS.forEach(([x, y, r], i) => {
    const at = fromImg([x, y]);
    const rr = px(r) * FRAME_CRATER_SCALE;
    placed.push({ at, r: rr });
    crater(at, rr, 100 + i);
  });
  let made = 0;
  for (let tries = 0; tries < 5000 && made < EXTRA_CRATERS; tries++) {
    // Bigger first, so the large ones find room.
    const k = made / EXTRA_CRATERS;
    const r =
      EXTRA_R[1] - (EXTRA_R[1] - EXTRA_R[0]) * Math.sqrt(k) * between(0.8, 1);
    const at = polar(MOON, rand() * Math.PI * 2, Math.sqrt(rand()) * MOON_R);
    if (!onMoon(at, r * 0.3)) continue;
    if (onFeature(at, r)) continue;
    if (dist(at, STAR) < STAR_R + MOAT + r + 40) continue;
    if (inShell(at, r + SHELL_GAP)) continue;
    // Craters may overlap a little, as old ones do.
    if (placed.some((c) => dist(c.at, at) < (c.r + r) * 0.95)) continue;
    placed.push({ at, r });
    crater(at, r, 200 + made);
    made++;
  }
}

// ---------------------------------------------------------------------------
// The face

/** A ridge of high ground along a polyline, with a mountain spine. */
function ridge(points: Point[], hw: (t: number) => number, spine = 0.45): void {
  d.stroke(
    points.map(fromImg),
    (t) => px(hw(t)),
    (dd, h) => {
      if (dd > h) return null;
      return dd < h * spine ? Cell.Mountain : Cell.Highland;
    },
  );
}

/** Points along a quadratic Bézier, in frame pixels. */
function curve(a: Point, c: Point, b: Point, n = 24): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
    ]);
  }
  return out;
}

/**
 * A lens of deep space, pointed at both ends: the eye and the mouth. `bend`
 * lifts its middle line (frame pixels) so it can frown.
 */
function lens(
  centre: Point,
  halfLen: number,
  halfHeight: number,
  bend: number,
  paint: (inside: number, u: number) => CellClass | null,
): void {
  const c = fromImg(centre);
  const a = px(halfLen);
  const b = px(halfHeight);
  for (
    let y = Math.floor(c[1] - b - px(bend) - 30);
    y <= c[1] + b + px(bend) + 30;
    y++
  ) {
    for (let x = Math.floor(c[0] - a - 30); x <= c[0] + a + 30; x++) {
      const u = (x - c[0]) / a;
      if (Math.abs(u) > 1.25) continue;
      const mid = c[1] + px(bend) * u * u;
      const half = b * Math.max(0, 1 - u * u);
      // inside < 1 is in the lens; up to ~1.6 is its rim.
      const inside =
        Math.abs(u) <= 1 ? Math.abs(y - mid) / Math.max(half, 0.01) : 9;
      const rim = Math.abs(y - mid) - half;
      const c2 = paint(rim <= 0 ? inside : 1 + rim / 18, u);
      if (c2 !== null) d.put(x, y, c2);
    }
  }
}

function paintFace(): void {
  // The left brow, heavy and raised; the right one, knitted over the star.
  ridge(curve([145, 109], [165, 92], [192, 104]), (t) => 4.2 - 1.6 * t, 0.55);
  ridge(curve([84, 104], [100, 94], [127, 104]), (t) => 3.4 - 0.8 * t, 0.5);
  // The furrows between the brows.
  ridge(
    [
      [131, 110],
      [136, 122],
    ],
    () => 2,
    0.3,
  );

  // The open left eye: a lake with the pupil an island, the lids high ground.
  lens([170, 127], 22, 8, 1, (inside) => {
    if (inside < 1) return Cell.Space;
    if (inside < 1.6) return Cell.Highland;
    return null;
  });
  d.blob(
    fromImg([168, 127]),
    px(5.2),
    { amp: 0.05, freq: 3, seed: 21 },
    (dd) => (dd < 0.45 ? Cell.Mountain : Cell.Highland),
  );
  // The bag under it.
  ridge(curve([152, 140], [170, 147], [189, 137]), () => 2.4, 0.3);

  // The right eye's lids, screwed up round the star below and to the right.
  ridge(curve([96, 146], [118, 152], [132, 134]), () => 2.8, 0.4);

  // The nose: a ridge from between the eyes to a round tip, two nostrils.
  ridge(
    [
      [139, 112],
      [142, 128],
      [146, 146],
    ],
    (t) => 4.5 + 1.5 * t,
    0.4,
  );
  d.blob(
    fromImg([149, 154]),
    px(9.5),
    { amp: 0.08, freq: 3, seed: 22 },
    (dd) => (dd < 0.5 ? Cell.Mountain : Cell.Highland),
  );
  for (const n of [
    [140, 161],
    [158, 161],
  ] as Point[]) {
    d.blob(
      fromImg(n),
      px(2.8),
      { amp: 0.1, freq: 3, seed: 23 + n[0] },
      () => Cell.Space,
    );
  }

  // The folds from the nose to the corners of the mouth.
  ridge(curve([131, 150], [120, 166], [121, 184]), () => 2.2, 0.3);
  ridge(curve([166, 155], [190, 164], [197, 182]), () => 2.2, 0.3);

  // The mouth: an inland sea between a mountain upper lip and a lower one.
  lens([159, 187], 35, 6.5, 2.5, (inside, u) => {
    if (inside < 1) return Cell.Space;
    if (inside < 1.9) return Math.abs(u) < 0.8 ? Cell.Mountain : Cell.Highland;
    return null;
  });

  // The chin and the cheeks.
  d.blob(
    fromImg([160, 216]),
    px(11),
    { elong: 1.7, amp: 0.15, freq: 3, seed: 24 },
    (dd) => (dd < 0.4 ? Cell.Mountain : Cell.Highland),
  );
  d.blob(
    fromImg([204, 150]),
    px(10),
    { elong: 1.3, angle: 1.2, amp: 0.2, freq: 3, seed: 25 },
    (dd) => (dd < 0.35 ? Cell.Mountain : Cell.Highland),
  );
}

// ---------------------------------------------------------------------------
// The shell

/** A point in the shell's frame: along the axis from the back, and across. */
function shellFrame(p: Point): Point {
  const dx = p[0] - SHELL_BACK[0];
  const dy = p[1] - SHELL_BACK[1];
  return [
    dx * SHELL_AXIS[0] + dy * SHELL_AXIS[1],
    -dx * SHELL_AXIS[1] + dy * SHELL_AXIS[0],
  ];
}

/** The shell's half width at `a` along it (0 behind the back or past the nose). */
function shellHalf(a: number): number {
  if (a < 0 || a > SHELL_LEN) return 0;
  const body = SHELL_LEN * SHELL_BODY;
  if (a <= body) return SHELL_HW;
  const t = (a - body) / (SHELL_LEN - body);
  return SHELL_HW * Math.sqrt(Math.max(0, 1 - t * t));
}

/** How far outside the shell's outline a point is (negative inside). */
function shellOutside(p: Point): number {
  const [a, b] = shellFrame(p);
  const back = Math.hypot(a / SHELL_BACK_DEPTH, b / SHELL_BACK_HW);
  const inBack = (back - 1) * Math.min(SHELL_BACK_DEPTH, SHELL_BACK_HW);
  const hw = shellHalf(a);
  let inBody = Infinity;
  if (a >= 0 && a <= SHELL_LEN) inBody = Math.abs(b) - hw;
  if (a > SHELL_LEN) inBody = a - SHELL_LEN + Math.abs(b);
  if (a < 0) inBody = -a + Math.max(0, Math.abs(b) - SHELL_HW);
  return Math.min(inBack, inBody);
}

const inShell = (p: Point, margin = 0): boolean => shellOutside(p) < margin;

function paintShell(): void {
  d.each((x, y) => {
    const out = shellOutside([x, y]);
    if (out >= SHELL_GAP) return null;
    if (out >= 0) return Cell.Space;
    const [a, b] = shellFrame([x, y]);
    // The open back: rings round a dark bore.
    const back = Math.hypot(a / SHELL_BACK_DEPTH, b / SHELL_BACK_HW);
    if (back <= 1) {
      if (back > 0.86) return Cell.Mountain;
      if (back > 0.6) return Cell.Plains;
      if (back > 0.47) return Cell.Mountain;
      if (back > 0.28) return Cell.Plains;
      return Cell.Space;
    }
    // A band of rivets behind the back, and the lit top edge of the body.
    if (a > px(16) && a < px(21)) return Cell.Mountain;
    if (b < -SHELL_HW * 0.62 && a < SHELL_LEN * 0.9) return Cell.Mountain;
    if (b > SHELL_HW * 0.35) return Cell.Plains;
    return Cell.Highland;
  });
}

// ---------------------------------------------------------------------------

function main(): void {
  paintMoon();
  paintFace();
  paintCraters();
  paintShell();
  d.clearDisc(STAR, STAR_R + MOAT);
  const nations = d
    .placeNations({
      star: STAR,
      starExclusion: STAR_EXCLUSION,
      minInterior: 14,
      minHome: 9_000,
      tilesPerNation: 20_000,
      maxPerHome: 30,
      minSpacing: 145,
      edgeMargin: 40,
    })
    .filter((n) => !inShell(n.at));

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
  d.write("Trip to the Moon", { at: STAR, r: STAR_R }, nations);
}

main();
