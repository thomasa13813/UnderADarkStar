import { renderTroops } from "../../client/Utils";
import { AttackLogicInput } from "../configuration/Config";
import {
  Attack,
  Execution,
  Game,
  HegemonStrike,
  MessageType,
  MissileLaunchers,
  Player,
  PunitiveFlag,
  PunitiveStrikeOption,
  StrikeInFlight,
  TerrainType,
  TrajectoryTile,
  Unit,
  UnitType,
  Warhead,
} from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { UniversalPathFinding } from "../pathfinding/PathFinder";
import { ParabolaUniversalPathFinder } from "../pathfinding/PathFinder.Parabola";
import { PathStatus } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { FlatBinaryHeap } from "./utils/FlatBinaryHeap";

// A Hegemon strike (H8, H16, H17 in docs/DarkStar-Design.md).
//
// The Hegemon borders nobody (the moat), so a strike flies from the Dark
// Star's centre to the tile it was aimed at as a Projectile unit on the nuke's
// arc (NukeExecution is the model: the Parabola pathfinder steps it each tick
// and a motion plan lets the client draw it between ticks), and lands the
// tick it arrives. From there it is an ordinary conquest with one front: the
// land it takes is the strike's BUBBLE, Hegemon-owned while the strike lasts
// and never retaken. The target fights it as any attack is fought, by
// cancelling it: troops it commits (CounterStrikeExecution) cancel the
// strike's troops, one for one up to a strike the size of the target's troop
// ceiling and at a better rate against a bigger one (counter()). When the
// strike stops advancing — its troops spent or cancelled, the target beneath
// the tyranny floor, nothing left in reach, recalled, or the Hegemon fallen —
// the bubble POPS: all of it is erased into deep space, as an Antimatter
// Reaction erases (2026-10-27), and the structures it captured die with it
// (PlayerExecution deletes units on unowned land). The Hegemon never keeps
// land beyond the Dark Star, and a strike's troops never come home
// (2026-10-24): recalled or spent, they are gone.
//
// Not all of the Hegemon's land beyond the moat was taken by a strike: the
// engine hands the Hegemon any pocket of the target's land a jagged bubble
// seals in (PlayerExecution.removeCluster), behind the strike's back. Such
// orphans are adopted into the bubble they touch (adoptOrphans), and a pop
// sweeps whatever else no live strike claims, so nothing is left standing.
//
// Costs are the engine's, scaled by razeAttackerLossPercent / razeSlowPercent
// and by tyranny: the smaller the target, the more each tile costs, without
// limit; at the floor a player cannot be struck at all, so a strike never
// eliminates anyone.
//
// A PUNITIVE strike (H19) is the same strike with the rules of a punishment:
// it answers a missile launch, aimed at the silo that fired (flagged by
// NukeExecution), and its troops are a LEVY on every living challenger's
// troops at home rather than the throne's own. It pays no tyranny multiplier
// but razes only within punitiveRadius of the silo and pops when nothing
// within reach is left. It cannot be recalled.
export class RazeExecution implements Execution, StrikeInFlight, HegemonStrike {
  private active = true;
  private mg: Game;
  private map: GameMap;
  private target: Player;
  private attack: Attack | null = null;
  private arrivalTick = 0;
  private projectile: Unit | null = null;
  private launchTile: TileRef = 0;
  private pathFinder: ParabolaUniversalPathFinder | null = null;
  // Set at launch; the landed Attack keeps it, so the HUD sees one strike.
  private strikeID = "";
  private inFlight = false;

  private bubble = new Set<TileRef>();
  private toConquer = new FlatBinaryHeap();
  private random = new PseudoRandom(123);
  private targetSmallID: number;
  private hegemonSmallID: number;
  private nbuf: TileRef[] = [0, 0, 0, 0];
  private nbuf2: TileRef[] = [0, 0, 0, 0];

  // Punitive strikes (H19): the flag answered and the reach.
  private punitive: {
    warhead: Warhead;
    radiusSquared: number;
  } | null = null;
  // Strike troops one troop committed against it cancels (counter()).
  private counterRate = 1;

  constructor(
    private hegemon: Player,
    private ref: TileRef,
    private troops: number | null = null,
    private punitiveStrike = false,
  ) {}

  // The levy a warhead draws, as a share of each challenger's troops at home:
  // the same for either warhead since the rework (WH4). The warhead is kept
  // in the signature so the lever can split again.
  static levyPercent(mg: Game, _warhead: Warhead): number {
    return mg.config().hegemonConfig().punitiveLevyPercent;
  }

  // What the galaxy would pay right now for a strike on this warhead.
  static levyTroops(mg: Game, warhead: Warhead): number {
    const percent = RazeExecution.levyPercent(mg, warhead);
    let total = 0;
    for (const p of mg.players()) {
      if (p.isHegemon() || !p.isAlive()) continue;
      total += Math.floor((p.troops() * percent) / 100);
    }
    return total;
  }

  // The punitive strike the Hegemon may order on a tile: the owner's flagged
  // silo standing there, while no strike on the owner is alive.
  // A silo stands on one tile but is drawn, with its badge, many tiles wide
  // (the ring's footprint grows as the camera zooms out). The client
  // hit-tests a click against the ring as drawn and sends the silo's tile;
  // this is the worker's own reach for a tile it is asked about (the radial
  // on a nearby tile, an intent from an older client): the nearest flagged
  // silo within this many tiles is the one meant.
  static readonly CLICK_RADIUS = 12;

  // The flagged launcher (a stargate under a Dark Star, a silo elsewhere) a
  // click on this tile means: the nearest one within CLICK_RADIUS whose
  // owner is a challenger not already under a strike.
  static flaggedSiloNear(mg: Game, tile: TileRef): Unit | null {
    if (mg.hegemon() === null || !mg.isValidRef(tile)) return null;
    const r2 = RazeExecution.CLICK_RADIUS * RazeExecution.CLICK_RADIUS;
    let best: Unit | null = null;
    let bestD2 = Infinity;
    for (const silo of mg.units(MissileLaunchers.types)) {
      if (!silo.isActive() || silo.owner().isHegemon()) continue;
      if (silo.punitiveFlag() === undefined) continue;
      const d2 = mg.euclideanDistSquared(silo.tile(), tile);
      if (d2 > r2 || d2 >= bestD2) continue;
      if (mg.hegemonStrikeOn(silo.owner())) continue;
      best = silo;
      bestD2 = d2;
    }
    return best;
  }

  static punitiveOption(mg: Game, tile: TileRef): PunitiveStrikeOption | null {
    const silo = RazeExecution.flaggedSiloNear(mg, tile);
    const flag = silo?.punitiveFlag();
    if (silo === null || flag === undefined) return null;
    return {
      siloTile: silo.tile(),
      warhead: flag.warhead,
      expiresTick: flag.expiresTick,
      levyPercent: RazeExecution.levyPercent(mg, flag.warhead),
      levyTroops: RazeExecution.levyTroops(mg, flag.warhead),
    };
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.map = mg.map();
    const geometry = mg.darkStar();
    if (
      geometry === null ||
      !this.hegemon.isHegemon() ||
      !mg.isValidRef(this.ref) ||
      // The Dark Star itself is defended by ordinary attacks on the invader.
      mg.isInDarkStar(this.ref)
    ) {
      this.active = false;
      return;
    }
    // A punitive strike answers a flag on the silo nearest the clicked tile
    // (H19) and is aimed at that silo; no tyranny check — its reach is
    // capped instead.
    let flag: PunitiveFlag | undefined;
    if (this.punitiveStrike) {
      const silo = RazeExecution.flaggedSiloNear(mg, this.ref);
      flag = silo?.punitiveFlag();
      if (silo === null || flag === undefined) {
        const clicked = mg.owner(this.ref);
        mg.displayMessage(
          "events_display.dark_star_punitive_none",
          MessageType.ATTACK_FAILED,
          this.hegemon.id(),
          undefined,
          { name: clicked.isPlayer() ? clicked.displayName() : "" },
        );
        this.active = false;
        return;
      }
      this.ref = silo.tile();
    }
    const owner = mg.owner(this.ref);
    if (
      !owner.isPlayer() ||
      owner === this.hegemon ||
      !this.hegemon.canAttackPlayer(owner)
    ) {
      this.active = false;
      return;
    }
    if (!this.punitiveStrike && this.tyrannyPercent(owner) === null) {
      mg.displayMessage(
        "events_display.dark_star_strike_tyranny",
        MessageType.ATTACK_FAILED,
        this.hegemon.id(),
        undefined,
        { name: owner.displayName() },
      );
      this.active = false;
      return;
    }
    // One live strike per target: in flight or on the ground.
    if (mg.hegemonStrikeOn(owner)) {
      mg.displayMessage(
        "events_display.dark_star_strike_busy",
        MessageType.ATTACK_FAILED,
        this.hegemon.id(),
        undefined,
        { name: owner.displayName() },
      );
      this.active = false;
      return;
    }
    this.target = owner;
    this.targetSmallID = owner.smallID();
    this.hegemonSmallID = this.hegemon.smallID();

    if (flag !== undefined) {
      const cfg = mg.config().hegemonConfig();
      this.punitive = {
        warhead: flag.warhead,
        radiusSquared: cfg.punitiveRadius * cfg.punitiveRadius,
      };
      this.troops = this.levy(owner, flag.warhead);
      // Answered: the player's other flags are spent with this one.
      for (const silo of owner.units(MissileLaunchers.types)) {
        silo.clearPunitiveFlag();
      }
    } else {
      this.troops ??= mg.config().attackAmount(this.hegemon, owner);
      this.troops = this.hegemon.removeTroops(
        Math.min(this.hegemon.troops(), this.troops),
      );
    }
    if (this.troops < 1) {
      this.active = false;
      return;
    }
    // Disproportion (H17): a strike bigger than the share of its target's
    // ceiling it could ever field is cancelled at a better rate.
    const ceiling =
      (mg.config().maxTroops(owner) *
        mg.config().hegemonConfig().strikeCounterCeilingPercent) /
      100;
    this.counterRate = ceiling > 0 ? Math.max(1, this.troops / ceiling) : 1;

    this.launch(ticks, mg.ref(geometry.cx, geometry.cy));

    mg.displayMessage(
      this.punitive !== null
        ? "events_display.dark_star_punitive_inbound"
        : "events_display.dark_star_strike_inbound",
      MessageType.NAVAL_INVASION_INBOUND,
      owner.id(),
      undefined,
      { troops: renderTroops(this.troops) },
    );
    mg.stats().attack(this.hegemon, owner, this.troops);

    this.strikeID = `strike-${ticks}-${this.ref}`;
    this.inFlight = true;
    mg.addStrikeInFlight(this);
    mg.addHegemonStrike(this);
  }

  // StrikeInFlight: what the HUD and a recall see between launch and landing.
  id(): string {
    return this.strikeID;
  }
  troopCount(): number {
    return this.troops ?? 0;
  }
  aimTile(): TileRef {
    return this.ref;
  }
  landsAtTick(): number {
    return this.arrivalTick;
  }

  targetPlayer(): Player {
    return this.target;
  }

  // The unit in the air, while there is one.
  unit(): Unit | null {
    return this.projectile;
  }

  // Build the projectile at the Dark Star's centre and record its flight, the
  // way NukeExecution does: the plan is the exact tile sequence tick() will
  // step through, so the client can derive the position between updates. The
  // arrival tick is known at launch, so the HUD can count down to it.
  private launch(ticks: number, from: TileRef): void {
    const speed = this.mg.config().hegemonConfig().strikeSpeed;
    this.launchTile = from;
    this.pathFinder = UniversalPathFinding.Parabola(this.mg, {
      increment: speed,
    });
    const replay = UniversalPathFinding.Parabola(this.mg, {
      increment: speed,
    });
    const path: TileRef[] = [from];
    let result = replay.next(from, this.ref, speed);
    while (result.status === PathStatus.NEXT) {
      path.push(result.node);
      result = replay.next(from, this.ref, speed);
    }
    // tick() first runs the tick after init: path[1] then, and the landing
    // step (COMPLETE) one tick after the last path tile.
    this.arrivalTick = ticks + path.length;

    const trajectory: TrajectoryTile[] = (
      this.pathFinder.findPath(from, this.ref) ?? []
    ).map((tile) => ({ tile, targetable: false }));
    this.projectile = this.hegemon.buildUnit(UnitType.Projectile, from, {
      targetTile: this.ref,
      trajectory,
    });
    this.mg.recordMotionPlan({
      kind: "grid",
      unitId: this.projectile.id(),
      planId: 1,
      startTick: ticks + 1,
      ticksPerStep: 1,
      path,
    });
  }

  // One step along the arc; true once the projectile has come down on the
  // aimed tile (it is deleted there, reachedTarget set, so the client plays
  // the impact).
  private fly(): boolean {
    if (this.projectile === null || this.pathFinder === null) return true;
    const speed = this.mg.config().hegemonConfig().strikeSpeed;
    const result = this.pathFinder.next(this.launchTile, this.ref, speed);
    if (result.status === PathStatus.NEXT) {
      this.projectile.move(result.node);
      this.projectile.setTrajectoryIndex(this.pathFinder.currentIndex());
      return false;
    }
    this.projectile.move(this.ref);
    this.projectile.setReachedTarget();
    this.projectile.delete(false);
    this.projectile = null;
    return true;
  }

  private landed(): void {
    if (!this.inFlight) return;
    this.inFlight = false;
    this.mg.removeStrikeInFlight(this);
    if (this.projectile !== null) {
      // Recalled, or nothing to land on: gone without an impact.
      if (this.projectile.isActive()) this.projectile.delete(false);
      this.projectile = null;
    }
  }

  // Tiles the bubble holds right now.
  bubbleSize(): number {
    return this.bubble.size;
  }

  // HegemonStrike: whether this strike's bubble holds the tile.
  holdsTile(tile: TileRef): boolean {
    return this.bubble.has(tile);
  }

  isPunitive(): boolean {
    return this.punitiveStrike;
  }

  // Call the strike off (the AI's recall; a human cancels the attack). Its
  // troops are lost, in flight or on the ground. A punitive strike is the
  // galaxy's, not the throne's to call off (H19).
  recall(): void {
    if (!this.active || this.punitiveStrike) return;
    if (this.attack === null) {
      this.calledOff(this.troops ?? 0);
      this.end();
      return;
    }
    this.attack.orderRetreat();
    this.attack.executeRetreat();
  }

  // The struck player's troops against the landed strike: each cancels
  // counterRate of the strike's, and only what it takes to cancel the strike
  // is spent. A strike cancelled to nothing pops on its next tick.
  counter(troops: number): number {
    if (!this.active || this.attack === null || troops <= 0) return 0;
    const strikeTroops = this.attack.troops();
    const spent = Math.min(troops, Math.ceil(strikeTroops / this.counterRate));
    this.attack.setTroops(Math.max(0, strikeTroops - spent * this.counterRate));
    return spent;
  }

  private calledOff(troops: number): void {
    this.mg.displayMessage(
      "events_display.dark_star_strike_called_off",
      MessageType.ATTACK_CANCELLED,
      this.hegemon.id(),
      undefined,
      { troops: renderTroops(troops), name: this.target.displayName() },
    );
  }

  tick(ticks: number): void {
    if (this.attack === null) {
      if (!this.hegemon.isAlive()) {
        // The throne fell while the strike was in the air.
        this.landed();
        this.mg.removeHegemonStrike(this);
        this.active = false;
        return;
      }
      if (this.projectile !== null && !this.projectile.isActive()) {
        // Something else removed the unit (the Hegemon's death sweep).
        this.end();
        return;
      }
      if (this.punitive !== null && this.mg.owner(this.ref) !== this.target) {
        // The gate changed hands in flight (H19, 2026-10-12): the punishment
        // was the launcher's owner's, not the captor's, so the strike is
        // cancelled on the spot, and the levy is spent.
        this.mg.displayMessage(
          "events_display.dark_star_punitive_lost",
          MessageType.ATTACK_CANCELLED,
          this.hegemon.id(),
          undefined,
          { name: this.target.displayName() },
        );
        this.end();
        return;
      }
      if (!this.fly()) return;
      this.land();
      return;
    }
    const attack = this.attack;
    if (!this.hegemon.isAlive()) {
      // The throne fell (GameImpl pops the bubble): nothing to come home to.
      attack.delete();
      this.bubble.clear();
      this.mg.removeHegemonStrike(this);
      this.active = false;
      return;
    }
    if (attack.retreated()) {
      this.calledOff(attack.troops());
      this.mg.stats().attackCancel(this.hegemon, this.target, 0);
      this.end();
      return;
    }
    if (attack.retreating()) return;
    if (!attack.isActive() || !this.target.isAlive()) {
      this.pop();
      this.active = false;
      return;
    }

    const cfg = this.mg.config().hegemonConfig();
    // The target's counter (counter()) and its Armies spend these too.
    let troopCount = attack.troops();

    const borderSize = attack.borderSize() + this.random.nextInt(0, 5);
    let tickBudget = 1;
    while (tickBudget > 0) {
      if (troopCount < 1) {
        this.end();
        return;
      }
      let tyranny = this.tyrannyPercent(this.target);
      if (tyranny !== null && this.punitive !== null) tyranny = 100;
      if (tyranny === null) {
        // Struck down to the floor: the target is beneath the throne's notice.
        this.end();
        return;
      }
      if (this.toConquer.size() === 0) {
        this.refreshFrontier();
        if (this.toConquer.size() === 0) {
          // Nothing left in reach: no longer advancing, so it pops.
          this.end();
          return;
        }
      }

      const tile = this.toConquer.dequeue();
      attack.removeBorderTile(tile);
      if (
        this.map.ownerID(tile) !== this.targetSmallID ||
        this.mg.isInDarkStar(tile) ||
        !this.bordersBubble(tile)
      ) {
        continue;
      }

      const { attackerTroopLoss, defenderTroopLoss, tickFraction } = this.mg
        .config()
        .attackLogic(this.attackLogicInput(troopCount, tile, borderSize));
      tickBudget -= (tickFraction * cfg.razeSlowPercent) / 100;
      troopCount -=
        (attackerTroopLoss * cfg.razeAttackerLossPercent * tyranny) / 10_000;
      attack.setTroops(troopCount);
      this.target.removeTroops(defenderTroopLoss);
      this.hegemon.conquer(tile);
      this.bubble.add(tile);
      this.addNeighbors(tile);
    }
  }

  private land(): void {
    const troops = this.troops ?? 0;
    if (
      this.mg.owner(this.ref) !== this.target ||
      !this.hegemon.canAttackPlayer(this.target)
    ) {
      // The tile changed hands in flight: nothing to strike, and the troops
      // are lost with it.
      this.end();
      return;
    }
    this.landed();
    this.attack = this.hegemon.createAttack(
      this.target,
      troops,
      this.ref,
      new Set<TileRef>(),
      this.strikeID,
    );
    if (this.punitive !== null) {
      this.attack.markPunitive();
    } else {
      this.attack.markStrike();
    }
    // The impact: the aimed tile is taken outright, and the bubble grows from it.
    this.hegemon.conquer(this.ref);
    this.bubble.add(this.ref);
    this.addNeighbors(this.ref);
    this.mg.stats().attackMaxIncoming(this.target, troops);
  }

  // The bubble pops: whatever it still holds is erased into deep space — with
  // the orphans it touches, and then anything else the Hegemon holds beyond
  // the moat that no other live strike's bubble claims.
  private pop(): void {
    this.adoptOrphans();
    for (const tile of this.bubble) {
      this.erase(tile);
    }
    this.bubble.clear();
    this.mg.removeHegemonStrike(this);

    if (this.mg.hegemonBubbleTiles() === 0) return;
    const others = this.mg.hegemonStrikes();
    for (const other of others) other.adoptOrphans();
    for (const tile of Array.from(this.hegemon.tiles())) {
      if (this.mg.isInDarkStar(tile)) continue;
      if (others.some((other) => other.holdsTile(tile))) continue;
      this.erase(tile);
    }
  }

  // A popped bubble tile is gone for good, as under an Antimatter Reaction:
  // unowned at once, and deep space when the water manager next flushes.
  private erase(tile: TileRef): void {
    this.hegemon.relinquish(tile);
    this.mg.queueWaterConversion(tile, true);
  }

  // Drop what the target took back, then take in every Hegemon tile beyond
  // the moat the bubble touches: land the engine handed over (an enclave the
  // bubble sealed in) is the bubble's to hold, fight over and pop.
  adoptOrphans(): void {
    const stack: TileRef[] = [];
    for (const tile of this.bubble) {
      if (this.map.ownerID(tile) === this.hegemonSmallID) {
        stack.push(tile);
      } else {
        this.bubble.delete(tile);
      }
    }
    while (stack.length > 0) {
      const tile = stack.pop()!;
      const n = this.map.neighbors4(tile, this.nbuf);
      for (let i = 0; i < n; i++) {
        const neighbor = this.nbuf[i];
        if (
          this.map.ownerID(neighbor) !== this.hegemonSmallID ||
          this.bubble.has(neighbor) ||
          this.mg.isInDarkStar(neighbor)
        ) {
          continue;
        }
        this.bubble.add(neighbor);
        stack.push(neighbor);
      }
    }
  }

  // The strike is over: the bubble pops and whatever troops it still had
  // are lost. They never return to the Dark Star.
  private end(): void {
    this.landed();
    this.pop();
    this.attack?.delete();
    this.active = false;
  }

  // The galaxy pays for a punitive strike (H19): a share of every living
  // challenger's troops at home — the offender's and the victim's too, and
  // Tribes' — each told what was taken and for whom.
  private levy(offender: Player, warhead: Warhead): number {
    const percent = RazeExecution.levyPercent(this.mg, warhead);
    let total = 0;
    for (const p of this.mg.players()) {
      if (p.isHegemon() || !p.isAlive()) continue;
      const share = Math.floor((p.troops() * percent) / 100);
      if (share < 1) continue;
      total += p.removeTroops(share);
      this.mg.displayMessage(
        "events_display.dark_star_levy",
        MessageType.ATTACK_REQUEST,
        p.id(),
        undefined,
        { name: offender.displayName(), troops: renderTroops(share) },
      );
    }
    return total;
  }

  private tyrannyPercent(target: Player): number | null {
    return this.mg
      .config()
      .hegemonTyrannyLossPercent(
        target.numTilesOwned() - target.domainTilesHeld(),
      );
  }

  // The domain borders nothing, so any Hegemon tile next to the target's land
  // is bubble.
  private bordersBubble(tile: TileRef): boolean {
    const n = this.map.neighbors4(tile, this.nbuf);
    for (let i = 0; i < n; i++) {
      if (this.map.ownerID(this.nbuf[i]) === this.hegemonSmallID) return true;
    }
    return false;
  }

  // The target may have taken bubble tiles back, resettled around them, or
  // lost an enclave to the bubble: pick the front up again from what the
  // bubble holds now.
  private refreshFrontier(): void {
    this.attack!.clearBorder();
    this.adoptOrphans();
    for (const tile of this.bubble) {
      this.addNeighbors(tile);
    }
  }

  private addNeighbors(tile: TileRef): void {
    const tickNow = this.mg.ticks();
    const n = this.map.neighbors4(tile, this.nbuf);
    for (let i = 0; i < n; i++) {
      const neighbor = this.nbuf[i];
      if (
        this.map.ownerID(neighbor) !== this.targetSmallID ||
        this.mg.isInDarkStar(neighbor) ||
        // A punitive strike reaches only so far from the silo (H19).
        (this.punitive !== null &&
          this.map.euclideanDistSquared(neighbor, this.ref) >
            this.punitive.radiusSquared)
      ) {
        continue;
      }
      this.attack!.addBorderTile(neighbor);
      let numOwned = 0;
      const numInner = this.map.neighbors4(neighbor, this.nbuf2);
      for (let j = 0; j < numInner; j++) {
        if (this.map.ownerID(this.nbuf2[j]) === this.hegemonSmallID) numOwned++;
      }

      let mag: number;
      switch (this.map.terrainType(neighbor)) {
        case TerrainType.Plains:
          mag = 1;
          break;
        case TerrainType.Highland:
          mag = 1.5;
          break;
        case TerrainType.Mountain:
          mag = 2;
          break;
        default:
          mag = 0;
          break;
      }
      // AttackExecution's priority.
      const priority =
        (this.random.nextInt(0, 7) + 10) * (1 - numOwned * 0.5 + mag / 2) +
        tickNow;
      this.toConquer.enqueue(neighbor, priority);
    }
  }

  private attackLogicInput(
    attackTroops: number,
    tile: TileRef,
    borderSize: number,
  ): AttackLogicInput {
    return {
      terrain: this.map.terrainType(tile),
      attackTroops,
      attacker: {
        type: this.hegemon.type(),
        // Decoupled from what it holds (H5), as when it defends.
        numTiles:
          this.mg.darkStar()?.domainTileCount ?? this.hegemon.numTilesOwned(),
      },
      defender: {
        type: this.target.type(),
        numTiles: this.target.numTilesOwned() - this.target.domainTilesHeld(),
        troops: this.target.troops(),
        isTraitor: this.target.isTraitor(),
        isDisconnectedTeammate: false,
      },
      defenderHasDefensePost: this.mg.hasUnitNearby(
        tile,
        this.mg.config().defensePostRange(),
        UnitType.DefensePost,
        this.target.id(),
      ),
      falloutRatio: this.mg.hasFallout(tile)
        ? this.mg.numTilesWithFallout() / this.mg.numLandTiles()
        : null,
      borderSize,
    };
  }

  owner(): Player {
    return this.hegemon;
  }

  isActive(): boolean {
    return this.active;
  }
}
