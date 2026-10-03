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
import {
  add,
  BlobStyle,
  Cell,
  CellClass,
  deg,
  dist,
  Drawing,
  fbm,
  isLand,
  mul,
  mulberry32,
  Point,
  polar,
  ringNoise,
  STANDARD_MOAT,
  STANDARD_STAR_RADIUS,
  sub,
  unit,
} from "./Drawing";

const W = 1800;
const H = 1800;
const SEED = 20261003;
const d = new Drawing(W, H);

// ---------------------------------------------------------------------------
// Layout

/** The Dark Star, standard size for an 1800 map, in the bottom right. */
const STAR: Point = [1440, 1440];
const STAR_R = STANDARD_STAR_RADIUS;
const MOAT = STANDARD_MOAT;

/** The moon: a disc in the top left, just inside the map's edges. */
const MOON: Point = [355, 335];
const MOON_R = 350;

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

const rand = mulberry32(SEED);
const between = (lo: number, hi: number): number => lo + (hi - lo) * rand();

/** A crack: a wandering line of space that narrows from `hw0` to `hw1`. */
function crack(points: Point[], hw0: number, hw1: number, seed: number): void {
  d.stroke(
    points,
    (t) =>
      (hw0 * Math.pow(1 - t, 1.1) + hw1) *
      (1 + 0.4 * fbm(t * 14, seed * 5.3, 80 + seed, 2)),
    (dd, hw) => (dd <= hw ? Cell.Space : null),
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
  d.each((x, y) => {
    const wobble = 60 * fbm(x / 140, y / 140, 11, 3);
    if (x - y > 1460 + wobble || y - x > 1460 + wobble) return Cell.Void;
    return null;
  });
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
      d.put(x, y, c);
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
    d.blob(p, r, { amp: 0.12, freq: 3, seed: 400 + tries }, (dd) =>
      dd > 0.72 ? Cell.Highland : Cell.Plains,
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
  d.blob(CRATER, CRATER_R * 1.32, craterStyle, (dd, _th, x, y) => {
    if (!isLand(d.at(x, y))) return null;
    if (dd > 0.88) return Cell.Highland;
    if (dd > 0.76) return Cell.Mountain;
    return null;
  });
  d.blob(CRATER, CRATER_R, craterStyle, () => Cell.Space);

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
      if (points.length >= 2) {
        crack(points, ring.hw, ring.hw * 0.5, 50 + ri * 7 + i);
      }
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
    d.blob(
      f.at,
      r,
      { elong: f.elong ?? 1, angle, amp: 0.3, freq: 2, seed: 200 + i },
      (_dd, th, x, y) => {
        // The face that took the blast is the high side.
        const hot = polar(f.at, angle, r * 0.3);
        const dd = dist([x, y], hot) / r;
        const wob = 1 + 0.35 * ringNoise(th, 2, 250 + i);
        if (r >= 54 && dd < 0.24 * wob) return Cell.Mountain;
        if (r >= 42 && dd < 0.5 * wob) return Cell.Highland;
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
    d.blob(
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
  d.stroke(
    [BEAM_START, FOCUS],
    (t) => 22 * (1 + 0.12 * fbm(t * 8, 0.5, 500, 2)),
    (dd, hw) => {
      if (dd <= hw) return Cell.Plains;
      if (dd <= hw + 8) return Cell.Highland;
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
    if (disc < 0) {
      throw new Error(`The ray at ${offset} degrees misses the moat.`);
    }
    const s = (-b - Math.sqrt(disc)) / 2 + 6;
    d.stroke(
      [FOCUS, add(FOCUS, mul(dir, s))],
      (t) => 11 * (1 + 0.1 * fbm(t * 6, offset, 520, 2)),
      (dd, hw) => {
        if (dd <= hw) return Cell.Highland;
        if (dd <= hw + 5) return Cell.Mountain;
        return null;
      },
      5,
    );
  }
}

// ---------------------------------------------------------------------------

function main(): void {
  paintVoid();
  paintMoon();
  paintDebris();
  paintBeam();
  // The beam's own two nations sit on its moon-side half; the placer then
  // leaves the beam alone.
  const beamNations = [0.2, 0.55].map((share) => ({
    at: add(BEAM_START, mul(sub(FOCUS, BEAM_START), share)),
    where: "beam",
  }));
  const nations = d.placeNations({
    star: STAR,
    starExclusion: 600,
    minInterior: 22,
    minHome: 7_500,
    tilesPerNation: 26_000,
    maxPerHome: 6,
    minSpacing: 170,
    edgeMargin: 60,
    manual: beamNations,
  });
  d.write("No Moon", { at: STAR, r: STAR_R }, nations);
}

main();
