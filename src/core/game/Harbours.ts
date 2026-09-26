import { Game } from "./Game";
import { TileRef } from "./GameMap";

/**
 * A spaceport's harbour (S7, docs/DarkStar-Design.md §6.17): the nearest
 * deep-space tile reachable over land from the port, with the overland path
 * to it. A coastal port's harbours are its adjacent water; an inland port's
 * harbour is where its freighters put to space and where its destroyers are
 * launched and repaired. One harbour per body of space at the nearest
 * distance; none when deep space lies further than `harbourMaxRange` tiles
 * over passable land, the Dark Star's disc never being crossed.
 */
export interface Harbour {
  readonly tile: TileRef;
  /** The overland tiles from the port (exclusive) to the harbour (inclusive). */
  readonly path: readonly TileRef[];
}

interface Entry {
  version: number;
  harbours: readonly Harbour[];
}

export class HarbourCache {
  private static readonly MAX_ENTRIES = 1024;
  private readonly cache = new Map<TileRef, Entry>();

  constructor(private readonly game: Game) {}

  harbours(portTile: TileRef): readonly Harbour[] {
    // Terrain only: neither owners nor units move a harbour, so an entry
    // lives until the map's water changes.
    const version = this.game.map().waterVersion();
    const cached = this.cache.get(portTile);
    if (cached !== undefined && cached.version === version) {
      return cached.harbours;
    }
    if (this.cache.size >= HarbourCache.MAX_ENTRIES) {
      this.cache.clear();
    }
    const harbours = this.compute(portTile);
    this.cache.set(portTile, { version, harbours });
    return harbours;
  }

  // Breadth-first over passable land, level by level, in the map's fixed
  // neighbour order so every client finds the same harbours. Stops at the
  // first level that touches water and keeps that level's first water tile
  // on each body of space.
  private compute(portTile: TileRef): readonly Harbour[] {
    const game = this.game;
    if (!game.isLand(portTile) || game.isImpassable(portTile)) {
      return [];
    }
    const maxRange = game.config().harbourMaxRange();
    const noDisc = game.darkStar() !== null;
    const parent = new Map<TileRef, TileRef>();
    parent.set(portTile, portTile);
    let level: TileRef[] = [portTile];
    const found: TileRef[] = [];
    const seenWater = new Set<TileRef>();

    for (let depth = 1; depth <= maxRange && level.length > 0; depth++) {
      const next: TileRef[] = [];
      for (const tile of level) {
        game.forEachNeighbor(tile, (n) => {
          if (parent.has(n)) return;
          if (game.isWater(n)) {
            if (seenWater.has(n)) return;
            seenWater.add(n);
            parent.set(n, tile);
            found.push(n);
            return;
          }
          if (game.isImpassable(n)) return;
          if (noDisc && game.isInDarkStar(n)) return;
          parent.set(n, tile);
          next.push(n);
        });
      }
      if (found.length > 0) break;
      level = next;
    }

    const harbours: Harbour[] = [];
    const components = new Set<number>();
    for (const tile of found) {
      const component = game.getWaterComponent(tile);
      if (component === null || components.has(component)) continue;
      components.add(component);
      const path: TileRef[] = [];
      for (let t = tile; t !== portTile; t = parent.get(t)!) {
        path.push(t);
      }
      path.reverse();
      harbours.push({ tile, path });
    }
    return harbours;
  }
}
