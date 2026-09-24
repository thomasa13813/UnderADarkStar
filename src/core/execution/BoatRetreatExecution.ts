import { Execution, Game, Player, UnitType } from "../game/Game";

export class BoatRetreatExecution implements Execution {
  private active = true;
  constructor(
    private player: Player,
    private unitID: number,
  ) {}

  private mg: Game;

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    const mg = this.mg;
    const unit = this.player
      .units()
      .find(
        (unit) =>
          unit.id() === this.unitID && unit.type() === UnitType.TransportShip,
      );

    if (!unit) {
      // A stargate shot in flight rides the same recall (C4).
      const shot = mg
        .gateShotsInFlight()
        .find((s) => s.unitId() === this.unitID && s.owner() === this.player);
      if (shot !== undefined) {
        shot.recall();
      } else {
        console.warn(`Didn't find outgoing boat with id ${this.unitID}`);
      }
      this.active = false;
      return;
    }

    unit.updateTransportShipState({ isRetreating: true });
    this.active = false;
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
