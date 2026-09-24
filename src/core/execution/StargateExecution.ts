import { Execution, Game, Unit } from "../game/Game";

// A stargate (C4 in docs/DarkStar-Design.md) reloads like a missile silo:
// firing pushes the launch tick onto the unit's missile timer queue, and the
// shot is ready again once stargateCooldown() ticks have passed. Unlike a
// silo, a gate never holds more than one charge whatever its level — upgrades
// buy range (Config.stargateRange), not throughput.
export class StargateExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(private gate: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.gate.isUnderConstruction()) return;
    if (!this.gate.isActive()) {
      this.active = false;
      return;
    }
    const firedAt = this.gate.missileTimerQueue()[0];
    if (firedAt === undefined) return;
    if (this.mg.ticks() - firedAt >= this.mg.config().stargateCooldown()) {
      this.gate.reloadMissile();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
