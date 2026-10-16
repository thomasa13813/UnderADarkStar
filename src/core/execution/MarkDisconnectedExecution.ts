import { Execution, Game, Player, UnitType } from "../game/Game";

export class MarkDisconnectedExecution implements Execution {
  constructor(
    private player: Player,
    private isDisconnected: boolean,
  ) {}

  init(mg: Game, ticks: number): void {
    if (this.isDisconnected) {
      const team = this.player.team();
      const teamTiles = team ? mg.teamTilesOwned(team) : 0;
      const totalLand = mg.totalLandTiles();
      this.player.markDisconnected(true, {
        currentTick: ticks,
        teamTiles,
        totalLand,
        wasAlive: this.player.isAlive(),
      });
      // A pirate who leaves (PR18): the corsair is scuttled, silently, so
      // no cooldown starts; a ghost ship raiding on autopilot serves nobody.
      // They embrace again from the death screen if they come back.
      if (this.player.isPirate()) {
        for (const ship of this.player.units(UnitType.Warship)) {
          if (ship.isActive()) ship.delete(false);
        }
        this.player.endPiracy();
      }
    } else {
      this.player.markDisconnected(false);
    }
  }

  tick(ticks: number): void {
    return;
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
