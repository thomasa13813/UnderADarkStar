import type { NukeTelegraphData, UnitState } from "../../types";
import { NUKE_MAGNITUDES } from "../../types";

// Must match RelationMatrix.ts
const RELATION_FRIENDLY = 1;

export const TELEGRAPH_SELF = 0;
export const TELEGRAPH_FRIENDLY = 1;
export const TELEGRAPH_ENEMY = 2;

/**
 * Classify a nuke owner relative to the local player:
 * 0 = own nuke, 1 = ally/teammate, 2 = everyone else.
 * No local player (replay / spectator) → everything is 2 (enemy color).
 */
function classifyOwner(
  ownerID: number,
  localPlayerID: number,
  relationMatrix: Uint8Array | undefined,
  relationSize: number,
): number {
  if (localPlayerID <= 0) return TELEGRAPH_ENEMY;
  if (ownerID === localPlayerID) return TELEGRAPH_SELF;
  if (
    relationMatrix &&
    ownerID > 0 &&
    ownerID < relationSize &&
    localPlayerID < relationSize &&
    relationMatrix[localPlayerID * relationSize + ownerID] === RELATION_FRIENDLY
  ) {
    return TELEGRAPH_FRIENDLY;
  }
  return TELEGRAPH_ENEMY;
}

/**
 * Extract nuke telegraph circles for active nukes with targets.
 *
 * Each telegraph carries a `relation` (self / friendly / enemy) so the
 * renderer can color it by who launched the nuke. Pass the local player's
 * smallID plus the relation matrix from RelationMatrix.ts; omit them in
 * replay / spectator mode to color everything as enemy.
 */
export function extractNukeTelegraphs(
  units: ReadonlyMap<number, UnitState>,
  mapW: number,
  localPlayerID = 0,
  relationMatrix?: Uint8Array,
  relationSize = 0,
  motionPlans?: ReadonlyMap<number, { startTick: number }>,
  currentTick = 0,
): NukeTelegraphData[] {
  const telegraphs: NukeTelegraphData[] = [];
  for (const u of units.values()) {
    if (u.targetTile === null || !u.isActive || u.waitTicks > 0) continue;

    const plan = motionPlans?.get(u.id);
    if (plan && plan.startTick > currentTick) continue;

    const mag = NUKE_MAGNITUDES[u.unitType];
    if (!mag) continue;
    telegraphs.push({
      x: u.targetTile % mapW,
      y: (u.targetTile - (u.targetTile % mapW)) / mapW,
      innerRadius: mag.inner,
      outerRadius: mag.outer,
      relation: classifyOwner(
        u.ownerID,
        localPlayerID,
        relationMatrix,
        relationSize,
      ),
    });
  }
  return telegraphs;
}

export const BADGE_NUCLEAR = 3;
export const BADGE_ANTIMATTER = 4;

// What the badge's size is derived from: the structure pass's icon curve.
export interface BadgeSizing {
  iconSize: number;
  dotsZoomThreshold: number;
  iconScaleFactorZoomedOut: number;
  iconGrowZoom: number;
}

/**
 * The badge ring's radius in world tiles at a zoom: the structure icon's
 * half size on the structure pass's own curve — without its zoomed-out dot
 * regime, so the ring keeps the icon's size where the icon shrinks to a dot
 * — plus 15%, so the ring sits just outside the icon. The pass draws with
 * it and the click handler hit-tests with it, so the two agree.
 */
export function badgeWorldRadius(s: BadgeSizing, zoom: number): number {
  const z = Math.max(zoom, s.dotsZoomThreshold);
  const iconScale =
    z >= s.iconGrowZoom
      ? z / s.iconGrowZoom
      : Math.min(1, z / s.iconScaleFactorZoomedOut);
  return ((s.iconSize * iconScale * 0.5) / zoom) * 1.15;
}

/** The badge's stroke in world tiles: the style's, never under 3 px. */
export function badgeWorldStroke(strokeWidth: number, zoom: number): number {
  return Math.max(strokeWidth, 3 / zoom);
}
// The badge's ring, in tiles around the silo: the shader draws it solid,
// with no fill, so the sprite stays visible (inner = outer: one ring).
export const BADGE_INNER_RADIUS = 5;
export const BADGE_OUTER_RADIUS = 5;

/**
 * Punitive-strike badges (DarkStar H19): a ring around every silo flagged by
 * a missile launch, red for a Nuclear Warhead and white for Antimatter,
 * drawn through the telegraph pass. Seen by the Hegemon and by the silo's
 * owner only; a flag past its tick is gone whether or not the unit update
 * said so.
 */
export function extractPunitiveBadges(
  units: ReadonlyMap<number, UnitState>,
  mapW: number,
  localPlayerID: number,
  localIsHegemon: boolean,
  currentTick: number,
): NukeTelegraphData[] {
  const badges: NukeTelegraphData[] = [];
  if (localPlayerID <= 0) return badges;
  for (const u of units.values()) {
    const warhead = u.punitiveWarhead ?? null;
    const expires = u.punitiveExpiresTick ?? null;
    if (
      warhead === null ||
      expires === null ||
      !u.isActive ||
      expires <= currentTick
    ) {
      continue;
    }
    if (!localIsHegemon && u.ownerID !== localPlayerID) continue;
    badges.push({
      x: u.pos % mapW,
      y: (u.pos - (u.pos % mapW)) / mapW,
      innerRadius: BADGE_INNER_RADIUS,
      outerRadius: BADGE_OUTER_RADIUS,
      relation: warhead === 2 ? BADGE_ANTIMATTER : BADGE_NUCLEAR,
    });
  }
  return badges;
}

/**
 * Targeted variant — iterates only pre-classified nuke IDs instead of all units.
 * Used by the live path where UnitClassifier maintains the nuke ID set.
 */
export function extractNukeTelegraphsFromIds(
  nukeIds: readonly number[],
  units: ReadonlyMap<number, UnitState>,
  mapW: number,
  localPlayerID = 0,
  relationMatrix?: Uint8Array,
  relationSize = 0,
  motionPlans?: ReadonlyMap<number, { startTick: number }>,
  currentTick = 0,
): NukeTelegraphData[] {
  const telegraphs: NukeTelegraphData[] = [];
  for (const id of nukeIds) {
    const u = units.get(id);
    if (!u || u.targetTile === null || !u.isActive || u.waitTicks > 0) continue;

    const plan = motionPlans?.get(u.id);
    if (plan && plan.startTick > currentTick) continue;

    const mag = NUKE_MAGNITUDES[u.unitType];
    if (!mag) continue;
    telegraphs.push({
      x: u.targetTile % mapW,
      y: (u.targetTile - (u.targetTile % mapW)) / mapW,
      innerRadius: mag.inner,
      outerRadius: mag.outer,
      relation: classifyOwner(
        u.ownerID,
        localPlayerID,
        relationMatrix,
        relationSize,
      ),
    });
  }
  return telegraphs;
}
