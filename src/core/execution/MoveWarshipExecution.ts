import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MoveWarshipExecution implements Execution {
  constructor(
    private readonly owner: Player,
    private readonly unitIds: number[],
    private readonly position: TileRef,
  ) {}

  init(mg: Game, _ticks: number): void {
    if (!mg.isValidRef(this.position)) {
      console.warn(`MoveWarshipExecution: position ${this.position} not valid`);
      return;
    }
    // The throne's destroyers never leave the moat (H10).
    if (this.owner.isHegemon() && !mg.isInMoat(this.position)) {
      console.warn(
        `MoveWarshipExecution: the Hegemon's ships stay in the moat`,
      );
      return;
    }
    // Get water component of new TargetTile for connectivity check
    const newPatrolTileWaterComponent = mg.getWaterComponent(this.position);
    // Armies (Tom, 2026-10-23) take the same order on their owner's own
    // nebula: a tile they could not walk to is refused.
    const armyMayGo =
      mg.isLand(this.position) &&
      mg.owner(this.position) === this.owner &&
      !mg.isInDarkStar(this.position);
    // Cache warship list and build a lookup map — avoids repeated iteration
    const warshipMap = new Map(
      this.owner.units(UnitType.Warship, UnitType.Army).map((u) => [u.id(), u]),
    );
    // Deduplicate ids so each warship is only moved once
    for (const unitId of new Set(this.unitIds)) {
      const warship = warshipMap.get(unitId);
      if (!warship) {
        console.warn(`MoveWarshipExecution: warship ${unitId} not found`);
        continue;
      }
      if (!warship.isActive()) {
        console.warn(`MoveWarshipExecution: warship ${unitId} is not active`);
        continue;
      }
      if (warship.type() === UnitType.Army) {
        if (!armyMayGo) continue;
      } else if (
        // Do not update the warship's patrolTile if it is in a different Water Component
        newPatrolTileWaterComponent === null ||
        !mg.hasWaterComponent(warship.tile(), newPatrolTileWaterComponent)
      ) {
        continue;
      }
      warship.updateWarshipState({
        patrolTile: this.position,
      });
      warship.setTargetTile(undefined);
    }
  }

  tick(_ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
