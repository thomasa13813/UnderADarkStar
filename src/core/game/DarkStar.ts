import { GameMap, TileRef } from "./GameMap";
import { CraterBounds, recomputeMagnitudesInBox } from "./WaterManager";

// The Dark Star: the Hegemon's domain (docs/DarkStar-Design.md, H1/H14). A solid
// disc of land at the map centre, ringed by a moat of deep space. It is carved
// into whatever map is being played, BEFORE the water graph is built, so every
// derived structure sees final terrain.
//
// Everything here is integer geometry floored once, so every client derives
// the identical tile set from the map size alone.

export const HEGEMON_PLAYER_ID = "HEGEMON0";
export const HEGEMON_AI_NAME = "The Hegemon";

// Terrain bytes (see GameMapImpl): bit 7 land, bit 6 shoreline, bit 5 ocean,
// bits 0-4 magnitude (31 on land = impassable).
const LAND_BIT = 0x80;
const MAG_MASK = 0x1f;
const IMPASSABLE_MAG = 31;
const DOMAIN_BYTE = LAND_BIT; // flat plains
const MOAT_BYTE = 0x00; // water; ocean/shoreline/magnitude are derived below
const IMPASSABLE_BYTE = LAND_BIT | IMPASSABLE_MAG;

// Mirrors MAX_MAG_DIST in WaterManager: how far a new coastline can change
// water magnitudes.
const MAG_REACH = 62;

export interface DarkStarGeometry {
  cx: number;
  cy: number;
  radius: number;
  moatWidth: number;
  rSq: number;
  outerSq: number; // (radius + moatWidth)²
  domainTileCount: number;
}

export interface DarkStarSizing {
  domainRadiusPermille: number;
  moatWidthPermille: number;
  moatMinTiles: number;
}

/**
 * A map's own Dark Star, from its info.json (`hegemon: { center, radius,
 * moat? }`, F5 in docs/DarkStar-Design.md): where the disc sits and how big
 * it is, in that map's tiles. Without one the disc is computed from the map
 * size and centred. The moat falls back to the sizing rule.
 */
export interface DarkStarOverride {
  center: [number, number];
  radius: number;
  moat?: number;
}

export function computeDarkStarGeometry(
  width: number,
  height: number,
  sizing: DarkStarSizing,
  override?: DarkStarOverride,
): DarkStarGeometry {
  const shorter = Math.min(width, height);
  const radius =
    override !== undefined
      ? Math.floor(override.radius)
      : Math.floor((shorter * sizing.domainRadiusPermille) / 1000);
  const moatWidth =
    override?.moat !== undefined
      ? Math.floor(override.moat)
      : Math.max(
          sizing.moatMinTiles,
          Math.floor((shorter * sizing.moatWidthPermille) / 1000),
        );
  const cx =
    override !== undefined ? Math.floor(override.center[0]) : width >> 1;
  const cy =
    override !== undefined ? Math.floor(override.center[1]) : height >> 1;
  const outer = radius + moatWidth;
  if (
    radius < 4 ||
    moatWidth < 1 ||
    cx - outer < 2 ||
    cy - outer < 2 ||
    cx + outer > width - 3 ||
    cy + outer > height - 3
  ) {
    throw new Error(
      `Map ${width}x${height} is too small to hold a Dark Star at ${cx},${cy} (radius ${radius}, moat ${moatWidth})`,
    );
  }
  const rSq = radius * radius;
  let domainTileCount = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= rSq) domainTileCount++;
    }
  }
  return {
    cx,
    cy,
    radius,
    moatWidth,
    rSq,
    outerSq: outer * outer,
    domainTileCount,
  };
}

export function isInDarkStar(
  g: DarkStarGeometry,
  x: number,
  y: number,
): boolean {
  const dx = x - g.cx;
  const dy = y - g.cy;
  return dx * dx + dy * dy <= g.rSq;
}

/** Disc or moat. */
export function isInDarkStarOrMoat(
  g: DarkStarGeometry,
  x: number,
  y: number,
): boolean {
  const dx = x - g.cx;
  const dy = y - g.cy;
  return dx * dx + dy * dy <= g.outerSq;
}

/**
 * Carve the Dark Star into `map` and its half-resolution `miniMap` (which the
 * water pathfinder runs on). Idempotent: terrain maps are cached per process,
 * so a second game may be handed an already-carved map.
 *
 * Returns the full-map tiles whose terrain byte changed (the client loads its
 * own pristine map and must be sent these) and the domain tiles.
 */
export function generateDarkStarTerrain(
  map: GameMap,
  miniMap: GameMap,
  g: DarkStarGeometry,
): { changed: TileRef[]; domainTiles: TileRef[] } {
  const w = map.width();
  const h = map.height();
  const outer = g.radius + g.moatWidth;
  const box: CraterBounds = {
    minX: g.cx - outer,
    maxX: g.cx + outer,
    minY: g.cy - outer,
    maxY: g.cy + outer,
  };

  // Snapshot everything the passes below can touch, to report what changed.
  const snapMinX = Math.max(0, box.minX - MAG_REACH);
  const snapMaxX = Math.min(w - 1, box.maxX + MAG_REACH);
  const snapMinY = Math.max(0, box.minY - MAG_REACH);
  const snapMaxY = Math.min(h - 1, box.maxY + MAG_REACH);
  const snapW = snapMaxX - snapMinX + 1;
  const snapshot = new Uint8Array(snapW * (snapMaxY - snapMinY + 1));
  for (let y = snapMinY; y <= snapMaxY; y++) {
    for (let x = snapMinX; x <= snapMaxX; x++) {
      snapshot[(y - snapMinY) * snapW + (x - snapMinX)] = map.terrainByte(
        map.ref(x, y),
      );
    }
  }

  // ── Full map: disc → land, ring → water ──────────────────────────
  const domainTiles: TileRef[] = [];
  const rewritten = new Set<TileRef>();
  for (let y = box.minY; y <= box.maxY; y++) {
    for (let x = box.minX; x <= box.maxX; x++) {
      const dx = x - g.cx;
      const dy = y - g.cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > g.outerSq) continue;
      const tile = map.ref(x, y);
      if (d2 <= g.rSq) {
        map.setTerrainByte(tile, DOMAIN_BYTE);
        domainTiles.push(tile);
      } else {
        map.setTerrainByte(tile, MOAT_BYTE);
      }
      rewritten.add(tile);
    }
  }
  const oceanFlooded = fixDerivedBits(map, box, rewritten, true);

  // ── Minimap: water > impassable > land over each 2x2 block, the rule the
  // map generator uses (createMiniMap), for every cell the Dark Star touches.
  const mw = miniMap.width();
  const mh = miniMap.height();
  const miniBox: CraterBounds = {
    minX: Math.max(0, box.minX >> 1),
    maxX: Math.min(mw - 1, box.maxX >> 1),
    minY: Math.max(0, box.minY >> 1),
    maxY: Math.min(mh - 1, box.maxY >> 1),
  };
  const miniRewritten = new Set<TileRef>();
  for (let my = miniBox.minY; my <= miniBox.maxY; my++) {
    for (let mx = miniBox.minX; mx <= miniBox.maxX; mx++) {
      let touched = false;
      let anyWater = false;
      let anyImpassable = false;
      for (let oy = 0; oy < 2; oy++) {
        for (let ox = 0; ox < 2; ox++) {
          const fx = mx * 2 + ox;
          const fy = my * 2 + oy;
          if (fx >= w || fy >= h) continue;
          if (isInDarkStarOrMoat(g, fx, fy)) touched = true;
          const b = map.terrainByte(map.ref(fx, fy));
          if ((b & LAND_BIT) === 0) anyWater = true;
          else if ((b & MAG_MASK) === IMPASSABLE_MAG) anyImpassable = true;
        }
      }
      if (!touched) continue;
      const miniTile = miniMap.ref(mx, my);
      const old = miniMap.terrainByte(miniTile);
      const oldIsWater = (old & LAND_BIT) === 0;
      const oldIsImpassable =
        !oldIsWater && (old & MAG_MASK) === IMPASSABLE_MAG;
      if (anyWater) {
        if (!oldIsWater) miniMap.setTerrainByte(miniTile, MOAT_BYTE);
      } else if (anyImpassable) {
        if (!oldIsImpassable) miniMap.setTerrainByte(miniTile, IMPASSABLE_BYTE);
      } else if (oldIsWater || oldIsImpassable) {
        miniMap.setTerrainByte(miniTile, DOMAIN_BYTE);
      }
      miniRewritten.add(miniTile);
    }
  }
  // Unlike the full map, ANY land counts as coastline on the minimap.
  fixDerivedBits(miniMap, miniBox, miniRewritten, false);

  // ── Report what changed on the full map ──────────────────────────
  const changed: TileRef[] = [];
  for (let y = snapMinY; y <= snapMaxY; y++) {
    for (let x = snapMinX; x <= snapMaxX; x++) {
      const tile = map.ref(x, y);
      if (
        snapshot[(y - snapMinY) * snapW + (x - snapMinX)] !==
        map.terrainByte(tile)
      ) {
        changed.push(tile);
      }
    }
  }
  // The ocean flood can run down a lake the moat now joins to the sea, out of
  // the snapshot box.
  for (const tile of oceanFlooded) {
    const x = map.x(tile);
    const y = map.y(tile);
    if (x < snapMinX || x > snapMaxX || y < snapMinY || y > snapMaxY) {
      changed.push(tile);
    }
  }
  return { changed, domainTiles };
}

/**
 * Recompute the bits derived from land/water layout — ocean, shoreline, water
 * magnitude — around `rewritten` tiles. The same rules WaterManager applies
 * when a nuke turns land into water. Returns the tiles that gained the ocean
 * bit by flooding.
 */
function fixDerivedBits(
  map: GameMap,
  box: CraterBounds,
  rewritten: Set<TileRef>,
  passableCoastOnly: boolean,
): TileRef[] {
  const w = map.width();
  const h = map.height();
  const total = w * h;
  const nb: TileRef[] = new Array(4);
  const neighbors = (tile: TileRef): number => {
    let n = 0;
    if (tile >= w) nb[n++] = tile - w;
    if (tile < total - w) nb[n++] = tile + w;
    const x = tile % w;
    if (x > 0) nb[n++] = tile - 1;
    if (x < w - 1) nb[n++] = tile + 1;
    return n;
  };

  // Ocean: by true connectivity. New water touching existing ocean becomes
  // ocean, and the flood carries on through any water it now joins. A moat
  // that touches no ocean stays a lake; transports route by water component,
  // not by this bit.
  const queue: TileRef[] = [];
  for (const tile of rewritten) {
    if (map.isLand(tile)) continue;
    const n = neighbors(tile);
    for (let i = 0; i < n; i++) {
      if (!rewritten.has(nb[i]) && map.isOcean(nb[i])) {
        map.setOcean(tile);
        queue.push(tile);
        break;
      }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const n = neighbors(queue[head]);
    for (let i = 0; i < n; i++) {
      if (map.isWater(nb[i]) && !map.isOcean(nb[i])) {
        map.setOcean(nb[i]);
        queue.push(nb[i]);
      }
    }
  }

  // Water magnitude: distance to the nearest coast.
  recomputeMagnitudesInBox(
    map,
    box,
    new Uint16Array(total),
    new Uint16Array(total),
    1,
    passableCoastOnly,
    null,
  );

  // Shoreline: a tile with a neighbour of the opposite kind. Impassable tiles
  // are void — they neither get a shoreline nor create one.
  const minX = Math.max(0, box.minX - 2);
  const maxX = Math.min(w - 1, box.maxX + 2);
  const minY = Math.max(0, box.minY - 2);
  const maxY = Math.min(h - 1, box.maxY + 2);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const tile = map.ref(x, y);
      let shoreline = false;
      if (!map.isImpassable(tile)) {
        const isLand = map.isLand(tile);
        const n = neighbors(tile);
        for (let i = 0; i < n; i++) {
          if (map.isImpassable(nb[i])) continue;
          if (map.isLand(nb[i]) !== isLand) {
            shoreline = true;
            break;
          }
        }
      }
      if (shoreline !== map.isShoreline(tile)) {
        if (shoreline) map.setShorelineBit(tile);
        else map.clearShorelineBit(tile);
      }
    }
  }
  return queue;
}
