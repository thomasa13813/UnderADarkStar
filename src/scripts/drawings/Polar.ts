/**
 * Draws the map "Polar" (map-generator/drawings/Polar.png).
 *
 *   npx tsx src/scripts/drawings/Polar.ts    writes the drawing
 *   npm run map "Polar"                      builds the map from it
 *
 * The idea (Tom, 2026-10-17): Earth seen from above the north pole, so
 * the Arctic Ocean is the Dark Star and its moat, the continents fan out
 * around it, and Antarctica, which the projection stretches into a circle,
 * is a ring of nebula at the rim. The map is round: beyond the rim is void.
 *
 * The coastlines, lakes, rivers and mountain ranges are Natural Earth data
 * (public domain, naturalearthdata.com), kept as longitude and latitude in
 * data/Polar.json by a one-off script and projected here: azimuthal about
 * the pole with the Greenwich meridian pointing down, the radius a power of
 * the distance from the pole rather than linear in it (RADIAL_POWER), so the
 * northern lands get more of the disc than a true equidistant view gives
 * them and the far south less (Tom, 2026-10-17: "the northern hemisphere is
 * too shrunken"). The picture Tom gave as reference (a commercial map, not
 * in the repo) is only that.
 *
 * Play: the continents keep their real shapes, with the big rivers and
 * lakes as waterways and the ranges as high ground. The Suez and Panama
 * canals are cut, so Africa, Eurasia and the two Americas are separate
 * pieces. A few mid-ocean islands are enlarged into stepping stones across
 * the Pacific, Atlantic and Southern oceans. The Antarctic ring is trimmed
 * to a fraction of its projected width, keeping its shape (the peninsula
 * bulges inward, the Ross and Weddell seas bite in), unbroken, with Lords
 * spaced evenly round it. The Lord exclusion is smaller than usual (400)
 * because the land nearer the throne is the continents' northern parts,
 * which are Baron land either way.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  Cell,
  deg,
  Drawing,
  fbm,
  isLand,
  Nation,
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
/** The rim of the world: the south pole, stretched into this circle. */
const RIM = 900;
/**
 * Radius as a share of the rim = (angle from the pole / 180°) ^ this. 1 is
 * the true azimuthal equidistant view; below 1 swells the north.
 */
const RADIAL_POWER = 0.7;

/** Lords sit no nearer the pole than this (450 tiles is about 23° N). */
const LORD_EXCLUSION = 450;

/** Rivers are this wide; the canals a little less. */
const RIVER_HALF_WIDTH = 2.5;
const CANAL_HALF_WIDTH = 2.5;

/**
 * The Antarctic ring: its width is this share of the real projected width
 * (the coast's distance from the rim) plus a floor, so it keeps the shape
 * of the real coast at a fraction of the area.
 */
const RING_SHARE = 0.36;
const RING_FLOOR = 10;
/** Lords round the ring, evenly spaced from this longitude. */
const RING_LORDS = 6;
const RING_LORD_START = -15;

// ---------------------------------------------------------------------------
// Data

type Ring = Point[];
interface Named {
  name: string;
  rings: Ring[];
}
interface PolarData {
  land: Ring[][];
  antarctica: Ring[][];
  lakes: Named[];
  rivers: { name: string; pts: Point[] }[];
  mountain: Named[];
  highland: Named[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA: PolarData = JSON.parse(
  fs.readFileSync(path.join(here, "data", "Polar.json"), "utf8"),
);

/** Longitude and latitude to the drawing. */
function proj(lon: number, lat: number): Point {
  const r = ((90 - lat) / 180) ** RADIAL_POWER * RIM;
  const a = deg(lon);
  return [RIM + r * Math.sin(a), RIM + r * Math.cos(a)];
}

const projRing = (ring: Ring): Ring => ring.map(([lon, lat]) => proj(lon, lat));

/**
 * Scanline fill of a polygon with holes (even-odd), given in longitude and
 * latitude, clipped to the map.
 */
function fillPolygon(geo: Ring[], paint: (x: number, y: number) => void) {
  const rings = geo.map(projRing);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(H - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    xs.length = 0;
    const sy = y + 0.5;
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[(i + 1) % ring.length];
        if (ay === by) continue;
        if (sy < Math.min(ay, by) || sy >= Math.max(ay, by)) continue;
        xs.push(ax + ((sy - ay) * (bx - ax)) / (by - ay));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.ceil(xs[i] - 0.5));
      const xb = Math.min(W - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = xa; x <= xb; x++) paint(x, y);
    }
  }
}

// ---------------------------------------------------------------------------
// The parts

function paintContinents(): void {
  for (const rings of DATA.land) {
    fillPolygon(rings, (x, y) => d.put(x, y, Cell.Plains));
  }
}

/** Mid-ocean islands too small to survive, enlarged into stepping stones. */
const STEPPING_STONES: { name: string; lon: number; lat: number; r: number }[] =
  [
    { name: "Hawaii", lon: -155.5, lat: 19.6, r: 24 },
    { name: "Marquesas", lon: -139.5, lat: -9.5, r: 11 },
    { name: "Tahiti", lon: -149.4, lat: -17.6, r: 14 },
    { name: "Samoa", lon: -172, lat: -13.8, r: 13 },
    { name: "Fiji", lon: 178, lat: -17.8, r: 18 },
    { name: "Galápagos", lon: -90.5, lat: -0.6, r: 14 },
    { name: "Easter Island", lon: -109.4, lat: -27.1, r: 11 },
    { name: "Bermuda", lon: -64.7, lat: 32.3, r: 9 },
    { name: "Azores", lon: -27.5, lat: 38.5, r: 12 },
    { name: "Cape Verde", lon: -24, lat: 16, r: 13 },
    { name: "Saint Helena", lon: -5.7, lat: -15.9, r: 10 },
    { name: "Tristan da Cunha", lon: -12.3, lat: -37.1, r: 10 },
    { name: "South Georgia", lon: -36.5, lat: -54.3, r: 14 },
    { name: "Falklands", lon: -59, lat: -51.7, r: 16 },
    { name: "Mauritius", lon: 57.5, lat: -20.3, r: 13 },
    { name: "Kerguelen", lon: 69.5, lat: -49.3, r: 16 },
    { name: "Maldives", lon: 73.3, lat: 3, r: 10 },
    { name: "Seychelles", lon: 55.5, lat: -4.6, r: 10 },
    { name: "Chatham Islands", lon: -176.5, lat: -44, r: 11 },
    { name: "Macquarie", lon: 158.9, lat: -54.6, r: 11 },
  ];

function paintSteppingStones(): void {
  STEPPING_STONES.forEach((s, i) => {
    d.blob(
      proj(s.lon, s.lat),
      s.r,
      { amp: 0.3, freq: 3, seed: 100 + i },
      (dn) =>
        dn > 0.75 && fbm(dn * 9, i, 7, 2) > 0.2 ? Cell.Highland : Cell.Plains,
    );
  });
}

function paintWaterways(): void {
  for (const lake of DATA.lakes) {
    fillPolygon(lake.rings, (x, y) => d.put(x, y, Cell.Space));
  }
  for (const river of DATA.rivers) {
    d.stroke(
      projRing(river.pts),
      () => RIVER_HALF_WIDTH,
      (dist, hw) => (dist <= hw ? Cell.Space : null),
    );
  }
  const canals: Point[][] = [
    // Panama: Caribbean to Pacific.
    [proj(-80.3, 9.95), proj(-79.2, 8.3)],
    // Suez: Mediterranean to the open Red Sea (the Gulf of Suez is
    // narrower than a tile here).
    [proj(32.1, 31.9), proj(32.6, 29.9), proj(33.3, 28.3), proj(34.1, 27.4)],
    // Straits narrower than a tile at this scale, kept open: Bab-el-Mandeb
    // (Africa and Arabia) and Gibraltar (Africa and Spain).
    [proj(42.6, 13.3), proj(44.0, 12.0)],
    [proj(-6.4, 35.95), proj(-5.0, 35.95)],
  ];
  for (const canal of canals) {
    d.stroke(
      canal,
      () => CANAL_HALF_WIDTH,
      (dist, hw) => (dist <= hw ? Cell.Space : null),
    );
  }
}

/** Ranges as mountain with highland shoulders; plateaus as highland. */
function paintRelief(): void {
  // Antarctica's own relief loops round the pole and the ring is drawn
  // from scratch in any case.
  const antarctic = (p: Named) => p.rings[0].every(([, lat]) => lat < -60);
  for (const p of DATA.highland) {
    if (antarctic(p)) continue;
    fillPolygon(p.rings, (x, y) => {
      if (!isLand(d.at(x, y))) return;
      if (fbm(x / 14, y / 14, 31, 3) > -0.15) d.put(x, y, Cell.Highland);
    });
  }
  for (const p of DATA.mountain) {
    if (antarctic(p)) continue;
    fillPolygon(p.rings, (x, y) => {
      if (!isLand(d.at(x, y))) return;
      const n = fbm(x / 11, y / 11, 37, 3);
      if (n > -0.05) d.put(x, y, Cell.Mountain);
      else if (n > -0.35) d.put(x, y, Cell.Highland);
    });
  }
}

/**
 * Antarctica: the real coast's distance from the rim, by angle, then a
 * ring of that profile at a fraction of the width.
 */
function paintAntarcticRing(): Nation[] {
  // The main polygon's coast loops round the pole, so the even-odd fill
  // gives the ocean side; a polygon that contains the centre is inverted.
  const mask = new Uint8Array(W * H);
  const one = new Uint8Array(W * H);
  for (const rings of DATA.antarctica) {
    one.fill(0);
    fillPolygon(rings, (x, y) => (one[y * W + x] = 1));
    if (one[STAR[1] * W + STAR[0]]) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (
            !one[i] &&
            Math.hypot(x + 0.5 - STAR[0], y + 0.5 - STAR[1]) <= RIM
          ) {
            mask[i] = 1;
          }
        }
      }
    } else {
      for (let i = 0; i < one.length; i++) if (one[i]) mask[i] = 1;
    }
  }
  const BUCKETS = 3600;
  const coast = new Float64Array(BUCKETS).fill(RIM);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      const dx = x + 0.5 - STAR[0];
      const dy = y + 0.5 - STAR[1];
      const r = Math.hypot(dx, dy);
      const th = Math.atan2(dy, dx);
      const k =
        Math.floor(((th + Math.PI) / (2 * Math.PI)) * BUCKETS) % BUCKETS;
      if (r < coast[k]) coast[k] = r;
    }
  }
  // Fill gaps and smooth a little, round the circle.
  const width = new Float64Array(BUCKETS);
  for (let k = 0; k < BUCKETS; k++) {
    let sum = 0;
    let n = 0;
    for (let j = -8; j <= 8; j++) {
      const c = coast[(k + j + BUCKETS) % BUCKETS];
      if (c < RIM) {
        sum += RIM - c;
        n++;
      }
    }
    width[k] = n === 0 ? 0 : sum / n;
  }
  let realArea = 0;
  for (let k = 0; k < BUCKETS; k++) realArea += width[k];
  console.log(
    `Antarctic ring: real width ${Math.min(...width).toFixed(0)}–${Math.max(...width).toFixed(0)} px, mean ${(realArea / BUCKETS).toFixed(0)}`,
  );

  d.each((x, y) => {
    const dx = x + 0.5 - STAR[0];
    const dy = y + 0.5 - STAR[1];
    const r = Math.hypot(dx, dy);
    if (r > RIM) return Cell.Void;
    if (r < RIM - 160) return null;
    const th = Math.atan2(dy, dx);
    const k = Math.floor(((th + Math.PI) / (2 * Math.PI)) * BUCKETS) % BUCKETS;
    const w =
      RING_FLOOR +
      RING_SHARE * width[k] +
      4 * ringNoise(th, 9, 5) +
      10 * ringNoise(th, 3, 6);
    if (r < RIM - w) return null;
    // Ice and rock: the inner coast is highland, the interior pocked.
    const fromCoast = r - (RIM - w);
    if (fromCoast < 5 && w > 24) return Cell.Highland;
    if (fbm(x / 16, y / 16, 9, 3) > 0.4) return Cell.Mountain;
    if (fbm(x / 22, y / 22, 10, 3) > 0.15) return Cell.Highland;
    return Cell.Plains;
  });

  // Lords evenly round the ring, each mid-ring on its ray, nudged along
  // the ring if the ray finds it thin there.
  const lords: Nation[] = [];
  for (let i = 0; i < RING_LORDS; i++) {
    const [x0, y0] = proj(RING_LORD_START + (360 * i) / RING_LORDS, -80);
    const base = Math.atan2(y0 - STAR[1], x0 - STAR[0]);
    let best: Point[] = [];
    for (let nudge = 0; nudge <= 30 && best.length < 24; nudge++) {
      const th = base + deg(nudge % 2 === 0 ? nudge / 2 : -(nudge + 1) / 2);
      const run: Point[] = [];
      for (let r = RIM - 1; r > RIM - 160; r--) {
        const x = Math.round(STAR[0] + Math.cos(th) * r);
        const y = Math.round(STAR[1] + Math.sin(th) * r);
        if (isLand(d.at(x, y))) run.push([x, y]);
        else if (run.length > 0) break;
      }
      if (run.length > best.length) best = run;
    }
    if (best.length === 0) throw new Error(`No ring land near Lord ${i}`);
    lords.push({
      at: best[Math.floor(best.length / 2)],
      where: "Antarctic ring",
    });
  }
  return lords;
}

/** Reports whether two places share a piece of land. */
function joined(a: Point, b: Point): boolean {
  const start = Math.round(a[1]) * W + Math.round(a[0]);
  const goal = Math.round(b[1]) * W + Math.round(b[0]);
  if (!isLand(d.cls[start]) || !isLand(d.cls[goal])) return false;
  const seen = new Uint8Array(W * H);
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const i = stack.pop()!;
    if (i === goal) return true;
    const x = i % W;
    for (const j of [
      x > 0 ? i - 1 : -1,
      x < W - 1 ? i + 1 : -1,
      i - W,
      i + W,
    ]) {
      if (j < 0 || j >= W * H || seen[j] || !isLand(d.cls[j])) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------

function main(): void {
  paintContinents();
  paintSteppingStones();
  paintRelief();
  paintWaterways();
  const ringLords = paintAntarcticRing();
  d.clearDisc(STAR, STAR_R + STANDARD_MOAT);
  console.log(
    `Africa joined to Eurasia: ${joined(proj(20, 5), proj(45, 25))}; the Americas joined: ${joined(proj(-100, 40), proj(-60, -10))}`,
  );
  const nations = d.placeNations({
    star: STAR,
    starExclusion: LORD_EXCLUSION,
    minInterior: 9,
    minHome: 2_500,
    tilesPerNation: 20_000,
    maxPerHome: 6,
    minSpacing: 130,
    edgeMargin: 6,
    manual: ringLords,
  });
  for (const n of nations) {
    const lon =
      (Math.atan2(n.at[0] - STAR[0], n.at[1] - STAR[1]) * 180) / Math.PI;
    const lat =
      90 -
      (Math.hypot(n.at[0] - STAR[0], n.at[1] - STAR[1]) / RIM) **
        (1 / RADIAL_POWER) *
        180;
    n.where += ` at ${Math.abs(lat).toFixed(0)}°${lat < 0 ? "S" : "N"} ${Math.abs(lon).toFixed(0)}°${lon < 0 ? "W" : "E"}`;
  }
  d.write("Polar", { at: STAR, r: STAR_R }, nations);
}

main();
