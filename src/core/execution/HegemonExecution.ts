import { Execution, Game, Player, PlayerType } from "../game/Game";
import { AttackExecution } from "./AttackExecution";
import { PlayerExecution } from "./PlayerExecution";

// The rules of the Hegemon role (docs/DarkStar-Design.md), registered by
// GameRunner when hegemon mode is on.
//
// The invasion slot itself (H6, H12) is occupancy, tracked by GameImpl. This
// drives the Dark Star's response to whoever holds it:
//
//  - An AI Hegemon answers an invader at once, with a wave of its troops
//    repeated for as long as the invader holds domain tiles. (A human Hegemon
//    runs its own defence.)
//  - H13, for ANY Hegemon: once the invasion has stalled (the invader has
//    gained no domain tile for invasionStallSeconds) a wave is forced, and from
//    then on everything the Hegemon gains (regeneration, donations, returning
//    troops) is sent after it, until the invader is evicted or advances again.
//
// Opposing attacks cancel troop for troop, so the counter-attack spends the
// Hegemon's army directly against the invader's.
export class HegemonExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private seated = false;

  private invader: Player | null = null;
  private lastGainTick = 0;
  private lastWaveTick = 0;
  // While stalled, the Hegemon's troops are pinned here: anything above is sent.
  private stallTroops: number | null = null;

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.mg === null) throw new Error("Not initialized");
    const hegemon = this.mg.hegemon();
    if (hegemon === null || !hegemon.isAlive()) {
      this.active = false;
      return;
    }
    if (!this.seated) {
      this.seated = true;
      // The seat is filled by GameImpl, never by a SpawnExecution, which is what
      // registers a PlayerExecution for everybody else. From tick(), not
      // init(): executions added during the init pass are lost.
      this.mg.addExecution(new PlayerExecution(hegemon));
    }
    if (this.mg.inSpawnPhase()) return;
    this.respondToInvasion(hegemon, ticks);
  }

  private respondToInvasion(hegemon: Player, ticks: number): void {
    const mg = this.mg!;
    const cfg = mg.config().hegemonConfig();
    const invader = mg.darkStarInvader();
    if (invader === null) {
      this.invader = null;
      this.stallTroops = null;
      mg.setInvasionStalled(false);
      return;
    }

    if (invader !== this.invader) {
      this.invader = invader;
      this.lastWaveTick = ticks - cfg.responseWaveSeconds * 10; // answer at once
    }
    if (mg.lastInvaderGainTick() !== this.lastGainTick) {
      // Advancing (again): the forced response switches off (F2).
      this.lastGainTick = mg.lastInvaderGainTick();
      this.stallTroops = null;
    }

    const stalled = ticks - this.lastGainTick >= cfg.invasionStallSeconds * 10;
    const wave = () => {
      this.lastWaveTick = ticks;
      this.send(
        hegemon,
        invader,
        (hegemon.troops() * cfg.responseWavePercent) / 100,
      );
    };

    if (
      hegemon.type() !== PlayerType.Human &&
      ticks - this.lastWaveTick >= cfg.responseWaveSeconds * 10
    ) {
      wave();
    }

    mg.setInvasionStalled(stalled);
    if (!stalled) return;
    if (this.stallTroops === null) {
      if (!hegemon.outgoingAttacks().some((a) => a.target() === invader)) {
        wave();
      }
      this.stallTroops = hegemon.troops();
      return;
    }
    // Once a second, so the attacks it merges into are not rebuilt every tick.
    if (ticks % 10 !== 0) return;
    const surplus = hegemon.troops() - this.stallTroops;
    if (surplus >= 1) {
      this.send(hegemon, invader, surplus);
    } else {
      this.stallTroops = hegemon.troops();
    }
  }

  private send(hegemon: Player, invader: Player, troops: number): void {
    if (troops < 1) return;
    this.mg!.addExecution(
      new AttackExecution(Math.floor(troops), hegemon, invader.id()),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
