/**
 * Draws the map "Cube" (map-generator/drawings/Cube.png).
 *
 *   npx tsx src/scripts/drawings/Cube.ts    writes the drawing
 *   npm run map "Cube"                      builds the map from it
 *
 * The idea (Tom's sketch, MapImages/Cube.png): a cube drawn in three
 * dimensions, corner on, with the Dark Star at the vertex nearest the
 * viewer where the three visible faces meet.
 *
 * Solid faces would be about 1.8 million tiles of land, three times what a
 * map should carry, so each face is a grid of four by four cells with lanes
 * of space between them, like a puzzle cube. The faces are told apart by
 * their light: the top face is lit (plains), the right face half lit
 * (highland rims), the left face in shadow (highland and mountain).
 *
 * Play: the outer row of cells on each face seats the nations, three cell
 * hops from the moat. The inner cells are Tribe land; the three nearest the
 * star are cut by the moat and are the last stepping stones. Every move
 * between cells is a short fleet hop, so the map is an archipelago with
 * the shape of a cube.
 */
import {
  Cell,
  CellClass,
  dist,
  Drawing,
  fbm,
  Point,
  STANDARD_MOAT,
  STANDARD_STAR_RADIUS,
} from "./Drawing";

const W = 1800;
const H = 1800;
const d = new Drawing(W, H);

const STAR: Point = [900, 900];
const STAR_R = STANDARD_STAR_RADIUS;

/** The cube's edge on screen. */
const EDGE = 760;
/** Cells along each edge of a face. */
const CELLS = 4;
const PITCH = EDGE / CELLS;
/** Space between cells, and along the three edges that meet at the star. */
const LANE = 67;
const INNER_LANE = 100;
/** Beyond the cube the corners fade to void. */
const VOID_R = 1000;

const COS30 = Math.sqrt(3) / 2;
/** Screen directions of the three edges from the near vertex. */
const UP_LEFT: Point = [-COS30, -0.5];
const UP_RIGHT: Point = [COS30, -0.5];
const DOWN: Point = [0, 1];

interface Face {
  name: string;
  a: Point;
  b: Point;
  /** 0 lit, 1 half lit, 2 shadow. */
  shade: number;
}

const FACES: Face[] = [
  { name: "top", a: UP_LEFT, b: UP_RIGHT, shade: 0 },
  { name: "right", a: UP_RIGHT, b: DOWN, shade: 1 },
  { name: "left", a: UP_LEFT, b: DOWN, shade: 2 },
];

// ---------------------------------------------------------------------------

/** The face a screen point lies on and its coordinates along that face. */
function locate(
  x: number,
  y: number,
): { face: Face; a: number; b: number } | null {
  const px = x - STAR[0];
  const py = y - STAR[1];
  for (const face of FACES) {
    const det = face.a[0] * face.b[1] - face.a[1] * face.b[0];
    const a = (px * face.b[1] - py * face.b[0]) / det;
    const b = (face.a[0] * py - face.a[1] * px) / det;
    if (a >= 0 && b >= 0 && a < EDGE && b < EDGE) return { face, a, b };
  }
  return null;
}

function paintCube(): void {
  d.each((x, y) => {
    if (dist([x, y], STAR) > VOID_R + 60 * fbm(x / 140, y / 140, 11, 3)) {
      return Cell.Void;
    }
    const hit = locate(x, y);
    if (hit === null) return null;
    const { face, a, b } = hit;
    // The cell edges wander a little so the grid is not ruled.
    const wa = a + 5 * fbm(x / 45, y / 45, 20 + face.shade, 3);
    const wb = b + 5 * fbm(x / 45, y / 45, 30 + face.shade, 3);
    const i = Math.floor(wa / PITCH);
    const j = Math.floor(wb / PITCH);
    if (i < 0 || j < 0 || i >= CELLS || j >= CELLS) return null;
    // The three cells at the near vertex are the star's.
    if (i === 0 && j === 0) return null;
    const fa = wa - i * PITCH;
    const fb = wb - j * PITCH;
    const loA = i === 0 ? INNER_LANE / 2 : LANE / 2;
    const loB = j === 0 ? INNER_LANE / 2 : LANE / 2;
    const hi = PITCH - LANE / 2;
    if (fa < loA || fb < loB || fa > hi || fb > hi) return null;
    // Distance in from the cell's edge, roughly in tiles.
    const edge = Math.min(fa - loA, fb - loB, hi - fa, hi - fb) * COS30;
    const grain = fbm(x / 36, y / 36, 40 + face.shade, 3);
    let c: CellClass = Cell.Plains;
    if (face.shade === 0) {
      if (edge < 6) c = Cell.Highland;
    } else if (face.shade === 1) {
      if (edge < 12 || grain > 0.5) c = Cell.Highland;
    } else {
      if (edge < 6 && grain > 0) c = Cell.Mountain;
      else if (edge < 16 || grain > 0.4) c = Cell.Highland;
      if (grain > 0.72) c = Cell.Mountain;
    }
    return c;
  });
}

// ---------------------------------------------------------------------------

function main(): void {
  paintCube();
  d.clearDisc(STAR, STAR_R + STANDARD_MOAT);
  const nations = d.placeNations({
    star: STAR,
    // The third cell in from the star reaches just past 500, so three of
    // them seat a nation two hops from the moat; with 540 here (outer rows
    // only, 21 nations) the throne held in all three AI rounds.
    starExclusion: 500,
    minInterior: 14,
    minHome: 7_000,
    tilesPerNation: 26_000,
    maxPerHome: 1,
    minSpacing: 200,
    edgeMargin: 50,
  });
  d.write("Cube", { at: STAR, r: STAR_R }, nations);
}

main();
