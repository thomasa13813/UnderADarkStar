import { renderTroops } from "../../client/Utils";
import { Execution, Game, MessageType, Player } from "../game/Game";

// The struck player's answer to a landed Hegemon strike (H17): troops
// committed against it cancel its troops, as opposing attacks cancel
// (RazeExecution.counter sets the rate). The bubble is never retaken; what
// the strike has razed is lost when it pops. Only what it takes to cancel
// the strike leaves the pool.
export class CounterStrikeExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private troops: number | null = null,
  ) {}

  init(mg: Game, ticks: number): void {
    this.active = false;
    const strike = mg
      .hegemonStrikes()
      .find((s) => s.targetPlayer() === this.player);
    if (strike === undefined || !this.player.isAlive()) return;
    const offered = Math.min(
      this.player.troops(),
      this.troops ?? mg.config().attackAmount(this.player, this.player),
    );
    const spent = strike.counter(offered);
    if (spent < 1) return;
    this.player.removeTroops(spent);
    mg.displayMessage(
      "events_display.dark_star_strike_countered",
      MessageType.ATTACK_REQUEST,
      this.player.id(),
      undefined,
      { troops: renderTroops(spent) },
    );
  }

  tick(ticks: number): void {}

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
