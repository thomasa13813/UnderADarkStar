/**
 * Draws the map "Nucleus" (map-generator/drawings/Nucleus.png).
 *
 *   npx tsx src/scripts/drawings/Nucleus.ts    writes the drawing
 *   npm run map "Nucleus"                      builds the map from it
 *
 * The idea (Tom's sketch, MapImages/Nucleus.png): a Bohr atom. The Dark
 * Star is the heart of the nucleus, ringed by closely packed round particles
 * of land. Three long ovals of land are the electron orbits, each carrying
 * solid electrons.
 *
 * Play: the particles hug the moat. Nobody starts on them (see
 * NUCLEUS_SEATS); they are Tribe land in the throne's shadow, the prize for
 * whoever reaches the front first and the staging ground for the landing.
 * The orbits pass behind the nucleus, so each is two long arcs that reach
 * from near the particles out to the map's edge and back: roads from the
 * quiet rim to the front. The electrons are the broad spots on those roads
 * where their nations start.
 */
import {
  add,
  Cell,
  deg,
  dist,
  Drawing,
  fbm,
  mulberry32,
  Nation,
  Point,
  polar,
  ringNoise,
  STANDARD_STAR_RADIUS,
} from "./Drawing";

const W = 1800;
const H = 1800;
const SEED = 20261005;
const d = new Drawing(W, H);
const rand = mulberry32(SEED);
const between = (lo: number, hi: number): number => lo + (hi - lo) * rand();

const STAR: Point = [900, 900];
const STAR_R = STANDARD_STAR_RADIUS;

/** The particles round the Dark Star. */
const NUCLEONS = 8;
const NUCLEON_RING = 300;
const NUCLEON_R = 90;
/**
 * Whether nations start on every other particle. Off: in three AI rounds
 * with them on, a particle nation overthrew the throne every time, twice
 * inside 15 minutes; the particles are Tribe land to be taken instead.
 */
const NUCLEUS_SEATS = false;

/** The orbits: ellipses through the nucleus, cut where they pass behind. */
const ORBIT_A = 800;
const ORBIT_B = 200;
const ORBIT_ANGLES = [90, 30, 150];
const ORBIT_CUT = 440;
const ORBIT_HW = 22;
const ELECTRON_R = 56;

// ---------------------------------------------------------------------------

function paintVoid(): void {
  d.each((x, y) => {
    const wobble = 60 * fbm(x / 140, y / 140, 11, 3);
    if (dist([x, y], STAR) > 1150 + wobble) return Cell.Void;
    return null;
  });
}

/** Paints the particles and returns the centres of the ones nations start on. */
function paintNucleus(): Nation[] {
  const seats: Nation[] = [];
  for (let i = 0; i < NUCLEONS; i++) {
    const a = deg(22.5 + (360 / NUCLEONS) * i + between(-3, 3));
    const at = polar(STAR, a, NUCLEON_RING + between(-8, 8));
    const r = NUCLEON_R * between(0.94, 1.06);
    const seed = 100 + i;
    d.blob(at, r, { amp: 0.05, freq: 3, seed }, (dd, th) => {
      const wob = 1 + 0.3 * ringNoise(th, 2, seed + 50);
      if (dd < 0.3 * wob) return Cell.Mountain;
      if (dd < 0.62 * wob) return Cell.Highland;
      return Cell.Plains;
    });
    if (i % 2 === 0) seats.push({ at, where: "nucleus" });
  }
  return seats;
}

function paintOrbits(): void {
  ORBIT_ANGLES.forEach((angleDeg, oi) => {
    const a = deg(angleDeg);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // Walk the ellipse from a point behind the nucleus so each visible arc
    // is one run of points.
    const lobes: Point[][] = [];
    let run: Point[] = [];
    for (let t = Math.PI / 2; t <= Math.PI * 2.5; t += 0.006) {
      const wobble = 6 * fbm(t * 4, oi * 5, 40 + oi, 3);
      const ex = (ORBIT_A + wobble) * Math.cos(t);
      const ey = (ORBIT_B + wobble) * Math.sin(t);
      const p: Point = add(STAR, [ex * ca - ey * sa, ex * sa + ey * ca]);
      if (dist(p, STAR) > ORBIT_CUT) {
        run.push(p);
      } else if (run.length > 0) {
        lobes.push(run);
        run = [];
      }
    }
    if (run.length > 0) lobes.push(run);
    lobes.forEach((points, li) => {
      d.stroke(
        points,
        (t) => ORBIT_HW * (1 + 0.08 * fbm(t * 40, oi * 3 + li, 60 + oi, 2)),
        (dd, hw) => {
          if (dd <= hw * 0.62) return Cell.Plains;
          if (dd <= hw) return Cell.Highland;
          return null;
        },
      );
      // One electron per arc, at a different point along each.
      const share = [0.3, 0.62, 0.42, 0.7, 0.36, 0.58][(oi * 2 + li) % 6];
      const at = points[Math.floor(points.length * share)];
      const seed = 200 + oi * 2 + li;
      d.blob(at, ELECTRON_R, { amp: 0.06, freq: 3, seed }, (dd, th) => {
        const wob = 1 + 0.3 * ringNoise(th, 2, seed + 50);
        if (dd < 0.32 * wob) return Cell.Mountain;
        if (dd < 0.68 * wob) return Cell.Highland;
        return Cell.Plains;
      });
    });
  });
}

// ---------------------------------------------------------------------------

function main(): void {
  paintVoid();
  const seats = paintNucleus();
  paintOrbits();
  const nations = d.placeNations({
    star: STAR,
    starExclusion: 480,
    minInterior: 14,
    minHome: 7_000,
    tilesPerNation: 25_000,
    maxPerHome: 4,
    minSpacing: 200,
    edgeMargin: 50,
    manual: NUCLEUS_SEATS ? seats : [],
  });
  d.write("Nucleus", { at: STAR, r: STAR_R }, nations);
}

main();
