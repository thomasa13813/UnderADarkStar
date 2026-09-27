import {
  Execution,
  Game,
  GameType,
  Player,
  PlayerType,
  PunitiveFlag,
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
// It also drives an AI Hegemon's leveller strikes (H11, punish()) and its
// answers to missile launches (H19, punishLaunches()).
function severity(flag: PunitiveFlag): number {
  return flag.warhead === UnitType.HydrogenBomb ? 2 : 1;
}

export class HegemonExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private seated = false;

  private invader: Player | null = null;
  private lastGainTick = 0;
  private lastWaveTick = 0;
  // While stalled, the Hegemon's troops are pinned here: anything above is sent.
  private stallTroops: number | null = null;
  // The AI's last stand: all-in against the invader until they are evicted.
  private lastStand = false;

  // The challengers' combined lifetime income at the last tick (shadow tax).
  private challengerGold: bigint | null = null;

  // An AI Hegemon's leveller strike (H11), one at a time.
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
    this.collectShadowTax(hegemon);
    if (this.mg.inSpawnPhase()) {
      this.maybeEndSpawnPhase(hegemon, ticks);
      return;
    }
    this.sweepBeyondTheMoat(hegemon, ticks);
    this.respondToInvasion(hegemon, ticks);
    if (hegemon.type() !== PlayerType.Human) {
      this.punish(hegemon, ticks);
      this.punishLaunches(hegemon, ticks);
    }
  }

  // H4: the throne has no economy of its own. Its income is the shadow tax —
  // a share of everything the challengers earned since the last tick,
  // deducted from nobody. Lifetime totals, so a challenger's death changes
  // nothing; the first tick only takes the reading.
  private collectShadowTax(hegemon: Player): void {
    const mg = this.mg!;
    let total = 0n;
    for (const p of mg.allPlayers()) {
      if (p !== hegemon) total += p.goldEarned();
    }
    if (this.challengerGold !== null) {
      const tax = mg.config().hegemonShadowTax(total - this.challengerGold);
      if (tax > 0n) {
        hegemon.addGold(tax);
        mg.stats().goldWork(hegemon, tax);
      }
    }
    this.challengerGold = total;
  }

  // H19: an AI Hegemon answers every flagged silo it may — the levy costs
  // the throne nothing — except on a challenger too small to be worth the
  // galaxy's troops. Of a player's flags, the severer first, then the
  // freshest.
  private punishLaunches(hegemon: Player, ticks: number): void {
    const mg = this.mg!;
    if (ticks % 10 !== 5) return;
    const cfg = mg.config().hegemonConfig();
    const minLand = (mg.numLandTiles() * cfg.punitiveAIMinLandPermille) / 1000;
    for (const p of mg.players()) {
      if (p === hegemon || !p.isAlive() || mg.hegemonStrikeOn(p)) continue;
      if (p.numTilesOwned() - p.domainTilesHeld() < minLand) continue;
      let best: Unit | null = null;
      let bestFlag: PunitiveFlag | null = null;
      for (const silo of p.units(UnitType.MissileSilo)) {
        const flag = silo.punitiveFlag();
        if (flag === undefined) continue;
        if (
          bestFlag === null ||
          severity(flag) > severity(bestFlag) ||
          (severity(flag) === severity(bestFlag) &&
            flag.expiresTick > bestFlag.expiresTick)
        ) {
          best = silo;
          bestFlag = flag;
        }
      }
      if (best !== null) {
        mg.addExecution(new RazeExecution(hegemon, best.tile(), null, true));
      }
    }
  }

  // A singleplayer round's spawn phase ends when the human spawns — but a
  // human Hegemon is seated, never spawns, and would wait forever. End it
  // once the nations have taken their places (they place themselves during
  // the spawn phase only), or after a short grace if any never does.
  private maybeEndSpawnPhase(hegemon: Player, ticks: number): void {
    const mg = this.mg!;
    if (
      hegemon.type() !== PlayerType.Human ||
      mg.config().gameConfig().gameType !== GameType.Singleplayer
    ) {
      return;
    }
    if (ticks < 10) return;
    // allPlayers: an unplaced nation owns nothing, so players() omits it.
    const nationsPlaced = mg
      .allPlayers()
      .every((p) => p.type() !== PlayerType.Nation || p.hasSpawned());
    if (nationsPlaced || ticks >= 100) {
      mg.endSpawnPhase();
    }
  }

  // H8, belt and braces: with no strike alive the Hegemon owns nothing beyond
  // the moat, whatever handed it over. A live strike's pop cleans up after
  // itself (RazeExecution.pop); this catches anything that slipped past.
  private sweepBeyondTheMoat(hegemon: Player, ticks: number): void {
    const mg = this.mg!;
    if (ticks % 10 !== 0 || mg.hegemonBubbleTiles() === 0) return;
    if (mg.hegemonStrikes().length > 0) return;
    for (const tile of Array.from(hegemon.tiles())) {
      if (!mg.isInDarkStar(tile)) hegemon.relinquish(tile);
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
    if (hegemon.troops() * 100 < ceiling * cfg.levellerFullPercent) {
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
          rivalCap * cfg.levellerRecallPercentOfRival
      ) {
        this.strike.recall();
      }
      return;
    }
    if (
      strongest === null ||
      this.fullSinceTick === null ||
      ticks - this.fullSinceTick < cfg.levellerFullSeconds * 10 ||
      ticks - this.lastStrikeEndTick < cfg.levellerCooldownSeconds * 10 ||
      strongestCap * 100 < ceiling * cfg.levellerThreatPercentOfCeiling
    ) {
      return;
    }
    const aim = this.aimAt(strongest);
    if (aim === null) return;
    this.strike = new RazeExecution(
      hegemon,
      aim,
      Math.floor((hegemon.troops() * cfg.levellerStrikePercent) / 100),
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
      this.lastStand = false;
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
    mg.setInvasionStalled(stalled);

    // The last stand (M4): the throne truly threatened, an AI Hegemon goes
    // all in — every second, everything above its reserve — and stays in
    // until the invader is gone. Its leveller strike is already recalled on
    // any landing (punish). A human Hegemon has the same tools by hand.
    if (hegemon.type() !== PlayerType.Human) {
      const g = mg.darkStar()!;
      if (
        invader.domainTilesHeld() * 100 >=
        g.domainTileCount * cfg.lastStandDomainLostPercent
      ) {
        this.lastStand = true;
      }
      if (this.lastStand) {
        if (ticks % 10 !== 0) return;
        const reserve =
          (mg.config().maxTroops(hegemon) * cfg.lastStandReservePercent) / 100;
        this.send(hegemon, invader, hegemon.troops() - reserve);
        return;
      }
    }

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
