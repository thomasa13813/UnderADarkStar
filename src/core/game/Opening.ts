import { UniversalPathFinding } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { GameMap, TileRef } from "./GameMap";

// The opening (C3 in docs/DarkStar-Design.md): when the spawn phase ends,
// every challenger launches from the Dark Star's centre to its spawn tile on
// the projectile's flight — the arc a strike and a gate shot fly, at the same
// speed. The flights themselves are drawn by the client alone; what the sim
// owns is the WINDOW: spawn immunity in Hegemon mode lasts until the last
// flight has landed, so play begins the moment the last challenger touches
// down. Both sides derive the same flight from the same path, so this module
// has no dependency beyond the map's geometry.

/**
 * The tiles a projectile flies through from `from` to `to`, `speed` tiles per
 * tick, exactly as RazeExecution / GateShotExecution step it: `path[0]` is
 * the launch tile, and the landing comes one tick after the last entry — so a
 * flight takes `path.length` ticks.
 */
export function flightPath(
  map: GameMap,
  from: TileRef,
  to: TileRef,
  speed: number,
): TileRef[] {
  const finder = UniversalPathFinding.Parabola(map, { increment: speed });
  const path: TileRef[] = [from];
  let result = finder.next(from, to, speed);
  while (result.status === PathStatus.NEXT) {
    path.push(result.node);
    result = finder.next(from, to, speed);
  }
  return path;
}

/** Ticks from launch to landing for one flight. */
export function flightTicks(
  map: GameMap,
  from: TileRef,
  to: TileRef,
  speed: number,
): number {
  return flightPath(map, from, to, speed).length;
}

/**
 * The opening's length: the longest flight, held between the ordinary
 * immunity and a cap. Flights longer than the cap are played faster on the
 * client, so the last landing and the end of immunity still coincide.
 */
export function openingWindowTicks(
  longestFlightTicks: number,
  minTicks: number,
  maxTicks: number,
): number {
  return Math.max(minTicks, Math.min(maxTicks, longestFlightTicks));
}
