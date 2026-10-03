/**
 * Draws the map "Jovian System" (map-generator/drawings/Jovian System.png).
 *
 *   npx tsx src/scripts/drawings/JovianSystem.ts    writes the drawing
 *   npm run map "Jovian System"                     builds the map from it
 *
 * The idea (Tom's sketch, MapImages/Jovian System.png): Jupiter and the
 * four Galilean moons. The planet is a great disc of land whose dark belts
 * are open space, so it is a stack of zones. The Great Red Spot is the Dark
 * Star, low on the planet and left of centre. The thin ring runs out from
 * the equatorial belt to both edges of the map. The moons sit towards the
 * four corners.
 *
 * Play: the zones are long roads; each is cut off from the next by a belt,
 * so a zone is its own front and the belts are where fleets cross. The
 * zones round the Spot are Tribe land in the throne's shadow, the far
 * zones and the moons seat the nations. Io is a short hop from the planet,
 * Callisto needs a stargate or the small moons in between. The ring is a
 * road in from the map's edge, with the four inner moons on it.
 */
import {
  add,
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
} from "./Drawing";

const W = 1800;
const H = 1800;
const SEED = 20261006;
const d = new Drawing(W, H);
const rand = mulberry32(SEED);
const between = (lo: number, hi: number): number => lo + (hi - lo) * rand();

// ---------------------------------------------------------------------------
// Layout

const PLANET: Point = [900, 900];
const PLANET_R = 500;
/** The planet's axis leans a little, as in the sketch; the ring lies in
 * its equatorial plane, so it leans the same way. */
const TILT = deg(7);
const U: Point = [Math.cos(TILT), Math.sin(TILT)];
const V: Point = [-Math.sin(TILT), Math.cos(TILT)];
/** Planet coordinates: u along the equator, v towards the south pole. */
const toUV = (x: number, y: number): Point => {
  const dx = x - PLANET[0];
  const dy = y - PLANET[1];
  return [dx * U[0] + dy * U[1], dx * V[0] + dy * V[1]];
};
const fromUV = (u: number, v: number): Point =>
  add(PLANET, add(mul(U, u), mul(V, v)));

/** The belts: dark bands of open space. [v of the centre line, half width] */
const BELTS: [number, number][] = [
  [-335, 37],
  [-170, 39],
  [0, 42],
  [170, 39],
  [335, 37],
];

/** The Great Red Spot, where the sketch has it. */
const STAR_UV: Point = [-185, 195];
const STAR: Point = (() => {
  const p = fromUV(STAR_UV[0], STAR_UV[1]);
  return [Math.round(p[0]), Math.round(p[1])];
})();
const STAR_R = STANDARD_STAR_RADIUS;

/** The ring: a thin strip of land along the equator outside the planet. */
const RING_HW = 11;

interface Moon {
  name: string;
  /** Direction from the planet, degrees (screen angles, y down). */
  angle: number;
  /** Open space between the planet's rim and the moon's. */
  gap: number;
  r: number;
}

/** The Galilean moons, nearest to farthest as in the sky. */
const MOONS: Moon[] = [
  { name: "Io", angle: 225, gap: 110, r: 95 },
  { name: "Europa", angle: 315, gap: 150, r: 82 },
  { name: "Ganymede", angle: 135, gap: 200, r: 135 },
  { name: "Callisto", angle: 45, gap: 240, r: 124 },
];
const moonAt = (m: Moon): Point => {
  const p = polar(PLANET, deg(m.angle), PLANET_R + m.gap + m.r);
  return [Math.round(p[0]), Math.round(p[1])];
};

/** The inner moons, on the ring: u along the equator from the planet. */
const INNER_MOONS: { name: string; u: number; r: number; elong: number }[] = [
  { name: "Metis", u: -600, r: 13, elong: 1.2 },
  { name: "Thebe", u: -800, r: 20, elong: 1.3 },
  { name: "Adrastea", u: 590, r: 12, elong: 1.4 },
  { name: "Amalthea", u: 740, r: 30, elong: 1.7 },
];

/** Small irregular moons: stepping stones between the big ones. */
const MOONLETS: { angle: number; out: number; r: number }[] = [
  { angle: 128, out: 95, r: 24 },
  { angle: 40, out: 90, r: 22 },
  { angle: 54, out: 175, r: 26 },
  { angle: 280, out: 140, r: 20 },
  { angle: 100, out: 120, r: 18 },
  { angle: 300, out: 300, r: 26 },
  { angle: 168, out: 300, r: 22 },
  { angle: 350, out: 320, r: 20 },
  { angle: 243, out: 330, r: 18 },
];

// ---------------------------------------------------------------------------

function paintVoid(): void {
  d.each((x, y) => {
    const wobble = 50 * fbm(x / 140, y / 140, 11, 3);
    if (dist([x, y], PLANET) > 1230 + wobble) return Cell.Void;
    return null;
  });
}

function paintPlanet(): void {
  const rim = (th: number): number =>
    PLANET_R * (1 + 0.012 * ringNoise(th, 3, 1));
  const margin = Math.ceil(PLANET_R * 1.03);
  for (let y = PLANET[1] - margin; y <= PLANET[1] + margin; y++) {
    for (let x = PLANET[0] - margin; x <= PLANET[0] + margin; x++) {
      const th = Math.atan2(y - PLANET[1], x - PLANET[0]);
      if (dist([x, y], PLANET) > rim(th)) continue;
      const [u, v] = toUV(x, y);
      // The belts wander slowly and their edges are turbulent.
      let inBelt = false;
      for (const [bv, bhw] of BELTS) {
        const centre = bv + 10 * fbm(u / 300, bv, 30, 2);
        const hw = bhw * (1 + 0.3 * fbm(u / 60, bv * 2, 31, 3));
        if (Math.abs(v - centre) < hw) {
          inBelt = true;
          break;
        }
      }
      if (inBelt) {
        d.put(x, y, Cell.Space);
        continue;
      }
      // Streaks of cloud along the flow; the poles are rougher.
      const polar = Math.max(0, (Math.abs(v) - 360) / 140) * 0.25;
      const score = fbm(u / 150, v / 16, 32, 3) + polar;
      let c: CellClass = Cell.Plains;
      if (score > 0.72) c = Cell.Mountain;
      else if (score > 0.42) c = Cell.Highland;
      d.put(x, y, c);
    }
  }

  // White ovals: storms in the zones, high ground drawn out along the flow.
  const zones = [-435, -253, -86, 86, 253, 435];
  const ovals: Point[] = [];
  for (let tries = 0; tries < 400 && ovals.length < 7; tries++) {
    const zv = zones[Math.floor(rand() * zones.length)];
    const v = zv + between(-12, 12);
    const chord = Math.sqrt(Math.max(0, PLANET_R ** 2 - v * v)) - 90;
    if (chord < 60) continue;
    const u = between(-chord, chord);
    const at = fromUV(u, v);
    if (dist(at, STAR) < STAR_R + 90) continue;
    if (ovals.some((o) => dist(o, at) < 170)) continue;
    ovals.push(at);
    const r = between(20, 30);
    d.blob(
      at,
      r,
      { elong: 2.2, angle: TILT, amp: 0.15, freq: 3, seed: 100 + tries },
      (dd) => (dd < 0.45 ? Cell.Mountain : Cell.Highland),
    );
  }
}

function paintRing(): void {
  const reach = Math.ceil(W * 0.75);
  for (let u = -reach; u <= reach; u++) {
    const centre = fromUV(u, 0);
    if (dist(centre, PLANET) < PLANET_R + 3) continue;
    // Ringlets and gaps, as in a real ring.
    if (fbm(u / 25, 1, 51, 2) > 0.42) continue;
    const hw = RING_HW * (1 + 0.5 * fbm(u / 40, 0, 50, 3));
    const drift = 3 * fbm(u / 200, 2, 52, 2);
    for (let v = -hw; v <= hw; v += 0.5) {
      const p = fromUV(u, v + drift);
      d.put(Math.round(p[0]), Math.round(p[1]), Cell.Plains);
    }
  }
  INNER_MOONS.forEach((m, i) => {
    const at = fromUV(m.u, 0);
    d.blob(
      at,
      m.r,
      { elong: m.elong, angle: TILT, amp: 0.25, freq: 2, seed: 150 + i },
      (dd) => (m.r >= 25 && dd < 0.4 ? Cell.Highland : Cell.Plains),
    );
  });
}

// ---------------------------------------------------------------------------
// The Galilean moons, each with the face it has in the photographs.

function craterRing(at: Point, r: number, seed: number, lip: boolean): void {
  d.blob(at, r, { amp: 0.08, freq: 3, seed }, (dd, _th, x, y) => {
    if (!isLand(d.at(x, y))) return null;
    if (dd > 0.86) return lip ? Cell.Mountain : Cell.Highland;
    if (dd > 0.7) return Cell.Highland;
    if (dd < 0.72) return Cell.Plains;
    return null;
  });
}

/** Io: sulphur plains with volcanoes and their flows. */
function paintIo(at: Point, r: number): void {
  d.blob(at, r, { amp: 0.03, freq: 3, seed: 10 }, (_dd, _th, x, y) =>
    fbm(x / 40, y / 40, 12, 3) > 0.5 ? Cell.Highland : Cell.Plains,
  );
  const volcanoes: Point[] = [];
  for (let tries = 0; tries < 200 && volcanoes.length < 9; tries++) {
    const p = polar(at, rand() * Math.PI * 2, Math.sqrt(rand()) * (r - 24));
    if (volcanoes.some((q) => dist(q, p) < 42)) continue;
    volcanoes.push(p);
    const vr = between(9, 16);
    d.blob(p, vr * 1.9, { amp: 0.2, freq: 3, seed: 20 + tries }, (dd) =>
      dd < 1 / 1.9 ? Cell.Mountain : Cell.Highland,
    );
  }
}

/** Europa: a smooth ice shell scored by long cracks. */
function paintEuropa(at: Point, r: number): void {
  d.blob(at, r, { amp: 0.02, freq: 3, seed: 11 }, () => Cell.Plains);
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2;
    const offset = between(-r * 0.7, r * 0.7);
    const dir: Point = [Math.cos(a), Math.sin(a)];
    const perp: Point = [-dir[1], dir[0]];
    const half = Math.sqrt(Math.max(0, r * r - offset * offset));
    const points: Point[] = [];
    for (let s = -half; s <= half; s += 10) {
      const w = offset + 5 * Math.sin(s / 60 + i) + 3 * fbm(s / 80, i, 60, 2);
      points.push(add(at, add(mul(dir, s), mul(perp, w))));
    }
    d.stroke(
      points,
      () => 2.8,
      (dd, hw) => (dd <= hw ? Cell.Highland : null),
    );
  }
  // Only the cracks within the disc stay.
  d.blob(at, r * 1.15, { amp: 0.02, freq: 3, seed: 11 }, (dd, _th, x, y) => {
    if (dd > 1 / 1.15 && d.at(x, y) === Cell.Highland) return Cell.Space;
    return null;
  });
}

/** Ganymede: grooved bright terrain between dark cratered regions. */
function paintGanymede(at: Point, r: number): void {
  d.blob(at, r, { amp: 0.025, freq: 3, seed: 13 }, (_dd, _th, x, y) => {
    const dx = x - at[0];
    const dy = y - at[1];
    // Dark regions are rough; the bright lanes between carry grooves.
    const region = fbm(x / 110, y / 110, 14, 3);
    if (region > 0.3) {
      return fbm(x / 22, y / 22, 15, 2) > 0.2 ? Cell.Highland : Cell.Plains;
    }
    // Grooves in two sets, each running its own way.
    const set = fbm(x / 160, y / 160, 16, 2) > 0 ? 0 : 1;
    const a = set === 0 ? deg(35) : deg(-50);
    const along = dx * Math.cos(a) + dy * Math.sin(a);
    const across = -dx * Math.sin(a) + dy * Math.cos(a);
    const groove = fbm(along / 120, across / 7, 17 + set, 2);
    return groove > 0.26 ? Cell.Highland : Cell.Plains;
  });
  for (let i = 0; i < 5; i++) {
    const p = polar(at, rand() * Math.PI * 2, Math.sqrt(rand()) * (r - 40));
    craterRing(p, between(14, 26), 30 + i, false);
  }
}

/** Callisto: the oldest surface, nothing but craters, and Valhalla. */
function paintCallisto(at: Point, r: number): void {
  d.blob(at, r, { amp: 0.025, freq: 3, seed: 18 }, (_dd, _th, x, y) =>
    fbm(x / 30, y / 30, 19, 3) > 0.55 ? Cell.Highland : Cell.Plains,
  );
  // Valhalla: a flat centre inside rings of ridges.
  const valhalla = polar(at, deg(160), r * 0.3);
  for (const ring of [86, 64, 42]) {
    d.blob(valhalla, ring, { amp: 0.06, freq: 4, seed: 40 + ring }, (dd) =>
      dd > 0.9 ? Cell.Highland : dd > 0.84 ? null : Cell.Plains,
    );
  }
  d.blob(valhalla, 22, { amp: 0.1, freq: 3, seed: 41 }, () => Cell.Plains);
  const craters: { at: Point; r: number }[] = [];
  for (let tries = 0; tries < 400 && craters.length < 16; tries++) {
    const p = polar(at, rand() * Math.PI * 2, Math.sqrt(rand()) * (r - 20));
    const cr = between(8, 28);
    if (dist(p, valhalla) < 100 + cr) continue;
    if (craters.some((c) => dist(c.at, p) < c.r + cr + 6)) continue;
    craters.push({ at: p, r: cr });
    craterRing(p, cr, 50 + tries, cr > 18);
  }
}

function paintMoons(): void {
  const painters: Record<string, (at: Point, r: number) => void> = {
    Io: paintIo,
    Europa: paintEuropa,
    Ganymede: paintGanymede,
    Callisto: paintCallisto,
  };
  for (const m of MOONS) painters[m.name](moonAt(m), m.r);
  MOONLETS.forEach((m, i) => {
    const at = polar(PLANET, deg(m.angle), PLANET_R + m.out + m.r);
    d.blob(
      at,
      m.r,
      {
        elong: between(1.1, 1.6),
        angle: rand() * Math.PI,
        amp: 0.3,
        freq: 2,
        seed: 300 + i,
      },
      (dd) => (m.r >= 24 && dd < 0.35 ? Cell.Highland : Cell.Plains),
    );
  });
}

// ---------------------------------------------------------------------------

function main(): void {
  paintVoid();
  paintPlanet();
  paintRing();
  paintMoons();
  d.clearDisc(STAR, STAR_R + STANDARD_MOAT);
  const nations = d.placeNations({
    star: STAR,
    starExclusion: 500,
    minInterior: 14,
    minHome: 9_000,
    tilesPerNation: 22_000,
    maxPerHome: 4,
    minSpacing: 110,
    edgeMargin: 50,
  });
  d.write("Jovian System", { at: STAR, r: STAR_R }, nations);
}

main();
