/**
 * StructureRangeHoverController — DarkStar: when the cursor rests on a
 * stargate or a shield array, push that structure's footprint to the
 * renderer (RangeCirclePass draws it as a translucent disc) so players can
 * read a gate's reach and the ground a shield dome protects.
 *
 * Any owner's structure counts: an enemy shield shows where a warhead
 * cannot hurt, an enemy gate what it can hit. Structures under construction
 * are shown too; the disc tells the player what the building will cover.
 *
 * Input flows InputHandler → MouseMoveEvent on the EventBus, like
 * HoverHighlightController. The hit box mirrors the structure sprite's
 * on-screen size (StructurePass vertex shader), so what you can see you can
 * hover, at every zoom.
 */

import { EventBus } from "../../core/EventBus";
import { UnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { Controller } from "../Controller";
import { MouseMoveEvent } from "../InputHandler";
import { MapRenderer } from "../render/gl";
import type { RenderSettings } from "../render/gl/RenderSettings";
import type { HoverRangeCircle } from "../render/types";
import { TransformHandler } from "../TransformHandler";
import { GameView, UnitView } from "../view";

const RANGED_TYPES: readonly UnitType[] = [
  UnitType.Stargate,
  UnitType.ShieldArray,
];

// The aim ring's blue for a gate; a soft green for the shield's dome.
export const STARGATE_RANGE_COLOR: readonly [number, number, number] = [
  0.6, 0.85, 1.0,
];
export const SHIELD_RANGE_COLOR: readonly [number, number, number] = [
  0.55, 1.0, 0.75,
];

/** Never smaller than this, so a dot-sized structure can still be hovered. */
const MIN_HIT_RADIUS_TILES = 2;

/**
 * Half the structure sprite's on-screen size, in world tiles, for the given
 * renderer zoom (device pixels per tile). Mirrors structure.vert.glsl.
 */
export type StructureSizing = Pick<
  RenderSettings["structure"],
  | "iconSize"
  | "dotsZoomThreshold"
  | "dotScale"
  | "iconScaleFactorZoomedOut"
  | "iconGrowZoom"
>;

export function structureHitRadius(
  zoom: number,
  s: StructureSizing | undefined,
): number {
  if (!s || !(zoom > 0)) return MIN_HIT_RADIUS_TILES;
  let iconScale: number;
  if (zoom <= s.dotsZoomThreshold) {
    iconScale = s.dotScale;
  } else if (zoom >= s.iconGrowZoom) {
    iconScale = zoom / s.iconGrowZoom;
  } else {
    iconScale = Math.min(1, zoom / s.iconScaleFactorZoomedOut);
  }
  const half = (s.iconSize * iconScale * 0.5) / zoom;
  return Math.max(MIN_HIT_RADIUS_TILES, half);
}

export class StructureRangeHoverController implements Controller {
  private lastCell: { x: number; y: number } | null = null;
  private lastUnitId: number | null = null;
  private lastLevel = 0;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
    private view: MapRenderer,
  ) {}

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => this.onMouseMove(e));
  }

  /** Re-check each tick so a destroyed gate's disc goes, and an upgraded one grows. */
  tick() {
    if (this.lastUnitId === null) return;
    this.refresh();
  }

  private onMouseMove(e: MouseMoveEvent): void {
    const cell = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    this.lastCell = cell;
    this.refresh();
  }

  private refresh(): void {
    const cell = this.lastCell;
    const unit =
      cell !== null && this.game.isValidCoord(cell.x, cell.y)
        ? this.structureAt(this.game.ref(cell.x, cell.y))
        : null;
    if (unit === null) {
      if (this.lastUnitId !== null) {
        this.lastUnitId = null;
        this.view.updateHoverRange(null);
      }
      return;
    }
    const level = unit.level();
    if (unit.id() === this.lastUnitId && level === this.lastLevel) return;
    this.lastUnitId = unit.id();
    this.lastLevel = level;
    this.view.updateHoverRange(this.circleFor(unit));
  }

  private structureAt(tile: TileRef): UnitView | null {
    const dpr =
      typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : 1;
    const hit = structureHitRadius(
      this.transformHandler.scale * dpr,
      this.view.getSettings().structure,
    );
    let best: UnitView | null = null;
    let bestDist = hit * hit;
    for (const { unit, distSquared } of this.game.nearbyUnits(
      tile,
      Math.ceil(hit),
      RANGED_TYPES,
    )) {
      if (!unit.isActive()) continue;
      if (distSquared <= bestDist) {
        bestDist = distSquared;
        best = unit;
      }
    }
    return best;
  }

  private circleFor(unit: UnitView): HoverRangeCircle {
    const config = this.game.config();
    const gate = unit.type() === UnitType.Stargate;
    return {
      x: this.game.x(unit.tile()),
      y: this.game.y(unit.tile()),
      r: gate
        ? config.stargateRange(unit.level())
        : config.shieldArrayRadius(unit.level()),
      color: gate ? STARGATE_RANGE_COLOR : SHIELD_RANGE_COLOR,
    };
  }
}
