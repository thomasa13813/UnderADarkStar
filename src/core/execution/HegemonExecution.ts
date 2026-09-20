import { Execution, Game } from "../game/Game";
import { PlayerExecution } from "./PlayerExecution";

// The rules of the Hegemon role (docs/DarkStar-Design.md), registered by
// GameRunner when hegemon mode is on. For now it only gives the Hegemon its
// PlayerExecution: the seat is filled by GameImpl, never by a SpawnExecution,
// which is what registers one for everybody else. The invasion slot (H6, H12)
// and the stalled-invasion counter-attack (H13) will live here.
export class HegemonExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private seated = false;

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.mg === null) throw new Error("Not initialized");
    if (this.seated) return;
    this.seated = true;
    const hegemon = this.mg.hegemon();
    if (hegemon === null) {
      this.active = false;
      return;
    }
    // From tick(), not init(): executions added during the init pass are lost.
    this.mg.addExecution(new PlayerExecution(hegemon));
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
