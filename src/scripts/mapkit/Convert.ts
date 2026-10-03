import { computeDarkStarGeometry } from "../../core/game/DarkStar";
import { Image } from "./Png";

// The map kit's converter (docs/MapMaking.md): a drawing in a friendly
// palette in, the map-generator's exact pixel encoding out, plus where the
// nations and the Dark Star are and a plain-language report of anything the
// author should look at.
//
// Paint programs smooth the edges of brushes and shapes, so a drawing is never
// exactly the seven palette colours. Pixels close to a palette colour are
// taken as that colour; everything else (the blended rim of a shape) is
// filled in from its nearest neighbours.

export const Terrain = {
  Unknown: 0,
  Space: 1,
  Void: 2,
  Plains: 3,
  Highland: 4,
  Mountain: 5,
  Nation: 6,
  DarkStar: 7,
} as const;
export type TerrainClass = (typeof Terrain)[keyof typeof Terrain];

export interface PaletteColor {
  terrain: TerrainClass;
  rgb: [number, number, number];
  /** The colour's name on Paint's default palette, for the guide. */
  swatch: string;
  /** True for the colour the guide and the template use. */
  primary: boolean;
}

// Paint's default swatches first, then the pure colours other programs offer.
export const PALETTE: PaletteColor[] = [
  {
    terrain: Terrain.Space,
    rgb: [63, 72, 204],
    swatch: "Indigo",
    primary: true,
  },
  {
    terrain: Terrain.Space,
    rgb: [0, 162, 232],
    swatch: "Turquoise",
    primary: false,
  },
  {
    terrain: Terrain.Space,
    rgb: [0, 0, 255],
    swatch: "pure blue",
    primary: false,
  },
  { terrain: Terrain.Void, rgb: [0, 0, 0], swatch: "Black", primary: true },
  {
    terrain: Terrain.Plains,
    rgb: [255, 255, 255],
    swatch: "White",
    primary: true,
  },
  {
    terrain: Terrain.Highland,
    rgb: [195, 195, 195],
    swatch: "Gray-25%",
    primary: true,
  },
  {
    terrain: Terrain.Mountain,
    rgb: [127, 127, 127],
    swatch: "Gray-50%",
    primary: true,
  },
  { terrain: Terrain.Nation, rgb: [237, 28, 36], swatch: "Red", primary: true },
  {
    terrain: Terrain.Nation,
    rgb: [255, 0, 0],
    swatch: "pure red",
    primary: false,
  },
  {
    terrain: Terrain.DarkStar,
    rgb: [255, 242, 0],
    swatch: "Yellow",
    primary: true,
  },
  {
    terrain: Terrain.DarkStar,
    rgb: [255, 255, 0],
    swatch: "pure yellow",
    primary: false,
  },
];

// How far (in RGB distance) a pixel may sit from a palette colour and still
// count as it. The blend of any two palette colours lands further away than
// this from every third one, except greys between black and white, which the
// elevation clean-up below deals with.
const MATCH_DISTANCE = 40;

// What the map-generator reads (map-generator/map_generator.go): blue 106 is
// water, pure black is impassable, anything else is land whose blue channel
// sets the elevation (plains below 159, highland below 179, mountain above).
const OUT_SPACE: [number, number, number] = [0, 0, 106];
const OUT_VOID: [number, number, number] = [0, 0, 0];
const OUT_PLAINS: [number, number, number] = [236, 226, 145];
const OUT_HIGHLAND: [number, number, number] = [236, 226, 168];
const OUT_MOUNTAIN: [number, number, number] = [236, 226, 190];

// The engine's own Dark Star sizing (HEGEMON_DEFAULTS in Config.ts), used
// when the drawing has no yellow circle and for the moat in every case.
export const DARK_STAR_SIZING = {
  domainRadiusPermille: 90,
  moatWidthPermille: 10,
  moatMinTiles: 15,
};

// GameImpl ignores a nation placed within this margin of the moat.
const NATION_KEEP_OUT_MARGIN = 30;
// The map-generator deletes islands and lakes smaller than these.
const MIN_ISLAND = 30;
const MIN_LAKE = 200;
// A yellow blob smaller than this is a stray mark, not the Dark Star.
const MIN_DARK_STAR_PIXELS = 20;
// How far a nation dot that missed the land is moved to reach it.
const NATION_SNAP = 12;
// Two dots closer than this are probably one nation drawn twice.
const NATION_MIN_SPACING = 30;

export interface DarkStarPlacement {
  center: [number, number];
  radius: number;
  moat: number;
  /** False when the drawing had no yellow circle and the default was used. */
  drawn: boolean;
}

export interface ConvertedMap {
  /** The image the map-generator reads; null when there were errors. */
  image: Image | null;
  darkStar: DarkStarPlacement | null;
  /** Nation spawn points, clockwise from north around the Dark Star. */
  nations: [number, number][];
  tiles: { space: number; void: number; land: number; total: number };
  /** Problems that stop the map being built. */
  errors: string[];
  /** Things that will work but may not be what the author meant. */
  warnings: string[];
  /** Plain facts about the result. */
  notes: string[];
}

interface Component {
  size: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  sumX: number;
  sumY: number;
}

const isLand = (c: number): boolean =>
  c === Terrain.Plains || c === Terrain.Highland || c === Terrain.Mountain;
const isTerrain = (c: number): boolean =>
  c === Terrain.Space || c === Terrain.Void || isLand(c);

/** Each pixel's palette colour, or Unknown when it is not close to any. */
function classify(
  image: Image,
  width: number,
  height: number,
): { cls: Uint8Array; strays: Map<number, number> } {
  const cls = new Uint8Array(width * height);
  const cache = new Map<number, number>();
  const strays = new Map<number, number>();
  const limit = MATCH_DISTANCE * MATCH_DISTANCE;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * image.width + x) * 4;
      const r = image.rgba[o];
      const g = image.rgba[o + 1];
      const b = image.rgba[o + 2];
      // Transparent pixels are deep space, as in the map-generator.
      if (image.rgba[o + 3] < 20) {
        cls[y * width + x] = Terrain.Space;
        continue;
      }
      const key = (r << 16) | (g << 8) | b;
      let c = cache.get(key);
      if (c === undefined) {
        c = Terrain.Unknown;
        let best = limit + 1;
        for (const p of PALETTE) {
          const d =
            (r - p.rgb[0]) ** 2 + (g - p.rgb[1]) ** 2 + (b - p.rgb[2]) ** 2;
          if (d < best) {
            best = d;
            c = p.terrain;
          }
        }
        cache.set(key, c);
      }
      cls[y * width + x] = c;
      if (c === Terrain.Unknown) strays.set(key, (strays.get(key) ?? 0) + 1);
    }
  }
  return { cls, strays };
}

/**
 * Drops highland and mountain that is less than three pixels thick. The
 * smoothed rim between white land and black void is a line of greys, some of
 * which match the elevation colours; real elevation is painted in areas.
 */
function dropThinElevation(cls: Uint8Array, width: number, height: number) {
  const high = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return true;
    const c = cls[y * width + x];
    return c === Terrain.Highland || c === Terrain.Mountain;
  };
  // A pixel is solid when its whole 3x3 block is elevation.
  const solid = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!high(x, y)) continue;
      let all = true;
      for (let dy = -1; dy <= 1 && all; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!high(x + dx, y + dy)) {
            all = false;
            break;
          }
        }
      }
      if (all) solid[y * width + x] = 1;
    }
  }
  // Elevation survives when it touches a solid pixel.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (cls[i] !== Terrain.Highland && cls[i] !== Terrain.Mountain) continue;
      let keep = false;
      for (let dy = -1; dy <= 1 && !keep; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          if (solid[yy * width + xx] === 1) {
            keep = true;
            break;
          }
        }
      }
      if (!keep) cls[i] = Terrain.Unknown;
    }
  }
}

/** Connected groups of the pixels `match` accepts, with a label per pixel. */
function components(
  cls: Uint8Array,
  width: number,
  height: number,
  match: (c: number) => boolean,
  diagonal: boolean,
): { list: Component[]; label: Int32Array } {
  const label = new Int32Array(width * height).fill(-1);
  const list: Component[] = [];
  const stack = new Int32Array(width * height);
  for (let start = 0; start < cls.length; start++) {
    if (label[start] !== -1 || !match(cls[start])) continue;
    const id = list.length;
    const comp: Component = {
      size: 0,
      minX: width,
      maxX: -1,
      minY: height,
      maxY: -1,
      sumX: 0,
      sumY: 0,
    };
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    while (top > 0) {
      const i = stack[--top];
      const x = i % width;
      const y = (i - x) / width;
      comp.size++;
      comp.sumX += x;
      comp.sumY += y;
      if (x < comp.minX) comp.minX = x;
      if (x > comp.maxX) comp.maxX = x;
      if (y < comp.minY) comp.minY = y;
      if (y > comp.maxY) comp.maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (!diagonal && dx !== 0 && dy !== 0) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (label[j] !== -1 || !match(cls[j])) continue;
          label[j] = id;
          stack[top++] = j;
        }
      }
    }
    list.push(comp);
  }
  return { list, label };
}

/** Gives every non-terrain pixel the terrain of its nearest terrain pixel. */
function fillFromNeighbours(
  cls: Uint8Array,
  width: number,
  height: number,
): boolean {
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < cls.length; i++) {
    if (isTerrain(cls[i])) queue[tail++] = i;
  }
  if (tail === 0) return false;
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = (i - x) / width;
    const c = cls[i];
    if (x > 0 && !isTerrain(cls[i - 1])) {
      cls[i - 1] = c;
      queue[tail++] = i - 1;
    }
    if (x < width - 1 && !isTerrain(cls[i + 1])) {
      cls[i + 1] = c;
      queue[tail++] = i + 1;
    }
    if (y > 0 && !isTerrain(cls[i - width])) {
      cls[i - width] = c;
      queue[tail++] = i - width;
    }
    if (y < height - 1 && !isTerrain(cls[i + width])) {
      cls[i + width] = c;
      queue[tail++] = i + width;
    }
  }
  return true;
}

/** The Dark Star the engine would place on a map of this size. */
export function defaultDarkStar(
  width: number,
  height: number,
): DarkStarPlacement {
  const shorter = Math.min(width, height);
  return {
    center: [width >> 1, height >> 1],
    radius: Math.floor(
      (shorter * DARK_STAR_SIZING.domainRadiusPermille) / 1000,
    ),
    moat: moatFor(width, height),
    drawn: false,
  };
}

function moatFor(width: number, height: number): number {
  return Math.max(
    DARK_STAR_SIZING.moatMinTiles,
    Math.floor(
      (Math.min(width, height) * DARK_STAR_SIZING.moatWidthPermille) / 1000,
    ),
  );
}

const at = (p: [number, number]): string => `(${p[0]}, ${p[1]})`;
const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

export function convertDrawing(drawing: Image): ConvertedMap {
  const errors: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const result: ConvertedMap = {
    image: null,
    darkStar: null,
    nations: [],
    tiles: { space: 0, void: 0, land: 0, total: 0 },
    errors,
    warnings,
    notes,
  };

  // The map-generator crops to multiples of 4; do it here so every
  // coordinate below is one the game will see.
  const width = drawing.width - (drawing.width % 4);
  const height = drawing.height - (drawing.height % 4);
  if (width < 200 || height < 200) {
    errors.push(
      `The drawing is ${drawing.width} x ${drawing.height} pixels. A map needs at least 200 x 200; 1800 x 1800 is a good size.`,
    );
    return result;
  }
  if (width !== drawing.width || height !== drawing.height) {
    notes.push(
      `Cropped from ${drawing.width} x ${drawing.height} to ${width} x ${height} (the game needs sizes that divide by 4).`,
    );
  }
  const total = width * height;
  result.tiles.total = total;
  if (total > 4_000_000) {
    warnings.push(
      `The map is ${width} x ${height} (${(total / 1e6).toFixed(1)} million tiles). Above about 3 million, slower computers struggle.`,
    );
  }

  const { cls, strays } = classify(drawing, width, height);
  dropThinElevation(cls, width, height);

  // Colours the kit did not recognise, beyond the thin smoothed rims.
  let strayCount = 0;
  for (const n of strays.values()) strayCount += n;
  if (strayCount > total * 0.01) {
    const top = [...strays.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const list = top
      .map(
        ([key, n]) =>
          `rgb(${key >> 16}, ${(key >> 8) & 0xff}, ${key & 0xff}) on ${n} pixels`,
      )
      .join("; ");
    warnings.push(
      `${((strayCount / total) * 100).toFixed(1)}% of the drawing is in colours the kit does not know (most common: ${list}). Those pixels took the terrain next to them. Check the palette in docs/MapMaking.md.`,
    );
  }

  // The Dark Star: the largest yellow shape.
  const yellow = components(
    cls,
    width,
    height,
    (c) => c === Terrain.DarkStar,
    true,
  ).list.filter((c) => c.size >= MIN_DARK_STAR_PIXELS);
  let darkStar: DarkStarPlacement;
  if (yellow.length === 0) {
    darkStar = defaultDarkStar(width, height);
    notes.push(
      `No yellow circle found, so the Dark Star is in the centre at its standard size (radius ${darkStar.radius}).`,
    );
  } else {
    // An outline circle can break into arcs where its line is thin, so all
    // the yellow is taken together; it must still look like one circle.
    const minX = Math.min(...yellow.map((c) => c.minX));
    const maxX = Math.max(...yellow.map((c) => c.maxX));
    const minY = Math.min(...yellow.map((c) => c.minY));
    const maxY = Math.max(...yellow.map((c) => c.maxY));
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (Math.abs(w - h) > Math.max(w, h) * 0.15) {
      if (yellow.length > 1) {
        errors.push(
          `Found ${yellow.length} separate yellow shapes. Draw one yellow circle for the Dark Star.`,
        );
      } else {
        warnings.push(
          `The yellow Dark Star is ${w} wide and ${h} tall. The Dark Star is always a circle, so the kit used the average.`,
        );
      }
    }
    darkStar = {
      center: [Math.round((minX + maxX) / 2), Math.round((minY + maxY) / 2)],
      radius: Math.round((w + h) / 4),
      moat: moatFor(width, height),
      drawn: true,
    };
  }
  try {
    computeDarkStarGeometry(width, height, DARK_STAR_SIZING, {
      center: darkStar.center,
      radius: darkStar.radius,
      moat: darkStar.moat,
    });
  } catch {
    errors.push(
      `The Dark Star at ${at(darkStar.center)} with radius ${darkStar.radius} does not fit: it and its ${darkStar.moat}-tile moat must sit at least 3 tiles inside the edge of the map, and its radius must be at least 4.`,
    );
  }
  result.darkStar = darkStar;

  // Nation dots.
  const dots = components(
    cls,
    width,
    height,
    (c) => c === Terrain.Nation,
    true,
  ).list;

  // Markers are not terrain: they and the smoothed rims take the terrain
  // around them.
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] === Terrain.Nation || cls[i] === Terrain.DarkStar) {
      cls[i] = Terrain.Unknown;
    }
  }
  if (!fillFromNeighbours(cls, width, height)) {
    errors.push(
      "The drawing has no space, void or land in the kit's colours. Check the palette in docs/MapMaking.md.",
    );
    return result;
  }

  // The engine carves the disc and floods the moat whatever is drawn there;
  // clear it here so the picture and the thumbnail show the truth.
  const [cx, cy] = darkStar.center;
  const outer = darkStar.radius + darkStar.moat;
  let cleared = 0;
  for (
    let y = Math.max(0, cy - outer);
    y <= Math.min(height - 1, cy + outer);
    y++
  ) {
    for (
      let x = Math.max(0, cx - outer);
      x <= Math.min(width - 1, cx + outer);
      x++
    ) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > outer * outer) continue;
      const i = y * width + x;
      if (
        isLand(cls[i]) &&
        (x - cx) ** 2 + (y - cy) ** 2 > darkStar.radius ** 2
      ) {
        cleared++;
      }
      cls[i] = Terrain.Space;
    }
  }
  if (cleared > 0) {
    notes.push(
      `${plural(cleared, "land tile", "land tiles")} inside the Dark Star's moat became space (the moat is ${darkStar.moat} tiles wide and always open).`,
    );
  }

  // Tile counts.
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] === Terrain.Space) result.tiles.space++;
    else if (cls[i] === Terrain.Void) result.tiles.void++;
    else result.tiles.land++;
  }
  if (result.tiles.land === 0) {
    errors.push(
      "The drawing has no land. Paint land in white (and grey for high ground).",
    );
    return result;
  }

  // Islands and lakes the map-generator will delete.
  const land = components(cls, width, height, isLand, false);
  const smallIslands = land.list.filter((c) => c.size < MIN_ISLAND);
  if (smallIslands.length > 0) {
    const where = smallIslands
      .slice(0, 3)
      .map((c) => at([c.minX, c.minY]))
      .join(", ");
    warnings.push(
      `${plural(smallIslands.length, "island is", "islands are")} smaller than ${MIN_ISLAND} tiles and will be removed (for example near ${where}).`,
    );
  }
  const lakes = components(
    cls,
    width,
    height,
    (c) => c === Terrain.Space,
    false,
  ).list.filter((c) => c.size < MIN_LAKE);
  if (lakes.length > 0) {
    const where = lakes
      .slice(0, 3)
      .map((c) => at([c.minX, c.minY]))
      .join(", ");
    warnings.push(
      `${plural(lakes.length, "patch of space is", "patches of space are")} smaller than ${MIN_LAKE} tiles and will be filled with land (for example near ${where}).`,
    );
  }
  const landmasses = land.list.length - smallIslands.length;
  notes.push(
    `${width} x ${height}: ${result.tiles.land.toLocaleString("en-US")} land tiles in ${plural(landmasses, "landmass", "landmasses")}, ${Math.round((result.tiles.space / total) * 100)}% space, ${Math.round((result.tiles.void / total) * 100)}% void.`,
  );

  // Nations.
  const keepOut = outer + NATION_KEEP_OUT_MARGIN;
  const placed: [number, number][] = [];
  for (const dot of dots) {
    let p: [number, number] = [
      Math.round(dot.sumX / dot.size),
      Math.round(dot.sumY / dot.size),
    ];
    if (!isLand(cls[p[1] * width + p[0]])) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dy = -NATION_SNAP; dy <= NATION_SNAP; dy++) {
        for (let dx = -NATION_SNAP; dx <= NATION_SNAP; dx++) {
          const x = p[0] + dx;
          const y = p[1] + dy;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          if (!isLand(cls[y * width + x])) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = [x, y];
          }
        }
      }
      if (best === null) {
        errors.push(
          `The nation dot at ${at(p)} is not on land. Move it onto land, or paint land under it.`,
        );
        continue;
      }
      p = best;
    }
    if ((p[0] - cx) ** 2 + (p[1] - cy) ** 2 <= keepOut * keepOut) {
      warnings.push(
        `The nation at ${at(p)} is too close to the Dark Star (within ${keepOut} tiles of its centre). The game will ignore the position and place it at random.`,
      );
    }
    const home = land.list[land.label[p[1] * width + p[0]]];
    if (home !== undefined && home.size < MIN_ISLAND) {
      warnings.push(
        `The nation at ${at(p)} sits on an island that is too small and will be removed.`,
      );
    }
    const twin = placed.find(
      (q) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < NATION_MIN_SPACING ** 2,
    );
    if (twin !== undefined) {
      warnings.push(
        `The nations at ${at(twin)} and ${at(p)} are less than ${NATION_MIN_SPACING} tiles apart. If that is one dot drawn twice, erase one.`,
      );
    }
    placed.push(p);
  }
  // Clockwise from north around the Dark Star, so the order is stable when
  // the drawing is edited.
  const angle = (p: [number, number]): number => {
    const a = Math.atan2(p[0] - cx, -(p[1] - cy));
    return a < 0 ? a + Math.PI * 2 : a;
  };
  placed.sort((a, b) => angle(a) - angle(b));
  result.nations = placed;
  if (placed.length === 0) {
    warnings.push(
      "No red nation dots found. The map will have no nations, only Tribes.",
    );
  } else {
    notes.push(`${plural(placed.length, "nation", "nations")}.`);
  }

  if (errors.length > 0) return result;

  const rgba = new Uint8Array(total * 4);
  const out: Record<number, [number, number, number]> = {
    [Terrain.Space]: OUT_SPACE,
    [Terrain.Void]: OUT_VOID,
    [Terrain.Plains]: OUT_PLAINS,
    [Terrain.Highland]: OUT_HIGHLAND,
    [Terrain.Mountain]: OUT_MOUNTAIN,
  };
  for (let i = 0; i < total; i++) {
    const rgb = out[cls[i]];
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = 255;
  }
  result.image = { width, height, rgba };
  return result;
}

/**
 * A starting drawing: space everywhere, with the Dark Star as a yellow disc
 * in the centre at the size the engine would give it.
 */
export function templateDrawing(size: number): Image {
  const space = PALETTE.find((p) => p.terrain === Terrain.Space && p.primary)!;
  const star = PALETTE.find(
    (p) => p.terrain === Terrain.DarkStar && p.primary,
  )!;
  const d = defaultDarkStar(size, size);
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside =
        (x - d.center[0]) ** 2 + (y - d.center[1]) ** 2 <= d.radius ** 2;
      const rgb = inside ? star.rgb : space.rgb;
      const o = (y * size + x) * 4;
      rgba[o] = rgb[0];
      rgba[o + 1] = rgb[1];
      rgba[o + 2] = rgb[2];
      rgba[o + 3] = 255;
    }
  }
  return { width: size, height: size, rgba };
}
