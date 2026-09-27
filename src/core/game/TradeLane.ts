import { Game } from "./Game";
import { TileRef } from "./GameMap";

/**
 * A trade lane (S7, docs/DarkStar-Design.md §6.19): the railroad between two
 * stations is a straight line — the 8-connected Bresenham line from tile to
 * tile, inclusive — and connects only if that line is clear. Clear means: no
 * impassable tile, no tile of the Dark Star's disc, and every water tile on
 * it shoreline water (the narrow-strait rule the rail pathfinder always
 * applied), with water counting `WATER_COST` toward the length budget the
 * pathfinder's water penalty used to steer by. Empty when the line is
 * blocked or over budget: there is no bent fallback.
 */
export const WATER_COST = 6;

export function straightLane(
  game: Game,
  from: TileRef,
  to: TileRef,
): TileRef[] {
  const tiles = bresenham(game, from, to);
  const noDisc = game.darkStar() !== null;
  let cost = 0;
  for (const t of tiles) {
    if (game.isImpassable(t)) return [];
    if (noDisc && game.isInDarkStar(t)) return [];
    if (game.isWater(t)) {
      if (!game.isShoreline(t)) return [];
      cost += WATER_COST;
    } else {
      cost += 1;
    }
  }
  if (cost >= game.config().railroadMaxSize()) return [];
  return tiles;
}

/** The 8-connected line from `from` to `to`, both included. */
export function bresenham(game: Game, from: TileRef, to: TileRef): TileRef[] {
  let x0 = game.x(from);
  let y0 = game.y(from);
  const x1 = game.x(to);
  const y1 = game.y(to);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const out: TileRef[] = [];
  for (;;) {
    out.push(game.ref(x0, y0));
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return out;
}
