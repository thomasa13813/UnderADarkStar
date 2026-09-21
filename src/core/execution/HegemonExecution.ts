import {
  Execution,
  Game,
  Player,
  PlayerType,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { AttackExecution } from "./AttackExecution";
import { PlayerExecution } from "./PlayerExecution";
import { RazeExecution } from "./RazeExecution";

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
//
// It also drives an AI Hegemon's punitive strikes (H11): see punish().
export class HegemonExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private seated = false;

  private invader: Player | null = null;
  private lastGainTick = 0;
  private lastWaveTick = 0;
  // While stalled, the Hegemon's troops are pinned here: anything above is sent.
  private stallTroops: number | null = null;

  // An AI Hegemon's punitive strike (H11), one at a time.
  private strike: RazeExecution | null = null;
  private fullSinceTick: number | null = null;
  private lastStrikeEndTick = 0;

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
    if (hegemon.type() !== PlayerType.Human) {
      this.punish(hegemon, ticks);
    }
  }

  // H11/H15, the AI's balance-of-power role: idle at full strength, it strikes
  // the strongest challenger, and brings the strike home once they are no
  // longer the strongest — or the moment the Dark Star itself is invaded.
  private punish(hegemon: Player, ticks: number): void {
    const mg = this.mg!;
    const cfg = mg.config().hegemonConfig();
    if (this.strike !== null && !this.strike.isActive()) {
      this.strike = null;
      this.lastStrikeEndTick = ticks;
    }
    if (mg.darkStarInvader() !== null) {
      this.strike?.recall();
      this.fullSinceTick = null;
      return;
    }
    if (ticks % 10 !== 0) return;

    const ceiling = mg.config().maxTroops(hegemon);
    if (hegemon.troops() * 100 < ceiling * cfg.punitiveFullPercent) {
      this.fullSinceTick = null;
    } else {
      this.fullSinceTick ??= ticks;
    }

    // Strongest by troop CAPACITY (land and cities), not troops in hand: those
    // swing by millions as a challenger spends them, and measured on World the
    // leader by troops changed every few seconds, recalling every strike.
    let strongest: Player | null = null;
    let strongestCap = 0;
    let rivalCap = 0; // the strongest challenger other than the strike's target
    const struck = this.strike?.targetPlayer() ?? null;
    for (const p of mg.players()) {
      if (p === hegemon || !p.isAlive()) continue;
      const cap = mg.config().maxTroops(p);
      if (cap > strongestCap) {
        strongest = p;
        strongestCap = cap;
      }
      if (p !== struck && cap > rivalCap) rivalCap = cap;
    }
    if (this.strike !== null && struck !== null) {
      // Cut down to clearly below the runner-up, not merely level with them:
      // with close leaders, one razed city would otherwise end every strike.
      if (
        !struck.isAlive() ||
        mg.config().maxTroops(struck) * 100 <
          rivalCap * cfg.punitiveRecallPercentOfRival
      ) {
        this.strike.recall();
      }
      return;
    }
    if (
      strongest === null ||
      this.fullSinceTick === null ||
      ticks - this.fullSinceTick < cfg.punitiveFullSeconds * 10 ||
      ticks - this.lastStrikeEndTick < cfg.punitiveCooldownSeconds * 10 ||
      strongestCap * 100 < ceiling * cfg.punitiveThreatPercentOfCeiling
    ) {
      return;
    }
    const aim = this.aimAt(strongest);
    if (aim === null) return;
    this.strike = new RazeExecution(
      hegemon,
      aim,
      Math.floor((hegemon.troops() * cfg.punitiveStrikePercent) / 100),
    );
    mg.addExecution(this.strike);
    this.fullSinceTick = null;
  }

  // The target's greatest city: land is soon resettled, so the lasting harm of
  // a strike is what it destroys. Failing that, its border tile nearest the
  // Dark Star.
  private aimAt(target: Player): TileRef | null {
    const mg = this.mg!;
    const g = mg.darkStar()!;
    let city: Unit | null = null;
    for (const unit of target.units(UnitType.City)) {
      if (mg.isInDarkStar(unit.tile())) continue;
      if (city === null || unit.level() > city.level()) city = unit;
    }
    if (city !== null) return city.tile();

    let best: TileRef | null = null;
    let bestDist = Infinity;
    for (const tile of target.borderTiles()) {
      if (mg.isInDarkStar(tile)) continue;
      const dx = mg.x(tile) - g.cx;
      const dy = mg.y(tile) - g.cy;
      const dist = dx * dx + dy * dy;
      // Ties go to the lower ref: set order must not decide it.
      if (dist < bestDist || (dist === bestDist && tile < (best ?? tile))) {
        bestDist = dist;
        best = tile;
      }
    }
    return best;
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
      if (
        !hegemon
          .outgoingAttacks()
          // A raze strike (it has a source tile) is not a defence of the domain.
          .some((a) => a.target() === invader && a.sourceTile() === null)
      ) {
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
