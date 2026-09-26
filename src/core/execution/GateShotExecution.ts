import { renderTroops } from "../../client/Utils";
import {
  Execution,
  Game,
  GateShotInFlight,
  MessageType,
  Player,
  TrajectoryTile,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { UniversalPathFinding } from "../pathfinding/PathFinder";
import { ParabolaUniversalPathFinder } from "../pathfinding/PathFinder.Parabola";
import { PathStatus } from "../pathfinding/types";
import { AttackExecution } from "./AttackExecution";

// A stargate shot (C4 in docs/DarkStar-Design.md): troops fired from the
// nearest ready gate in range at any tile that is not the shooter's own, as a
// Projectile on the nuke's arc (the throne's strike is the model, see
// RazeExecution.launch). It lands as a transport does without the boat
// (TransportShipExecution's arrival): the tile is conquered and an attack
// fights outward from it, so the land is kept — a beachhead behind any
// coastline, or an invasion of the Dark Star that skips the moat, subject to
// the single-invader rule (H6, H12). Troops leave at launch
// and ride on the unit, so the HUD shows them like a fleet's. A recall, or the
// slot being claimed by someone else in flight, brings them home at once.
export class GateShotExecution implements Execution, GateShotInFlight {
  private active = true;
  private mg: Game;
  private shot: Unit | null = null;
  private launchTile: TileRef = 0;
  private pathFinder: ParabolaUniversalPathFinder | null = null;

  constructor(
    private player: Player,
    private ref: TileRef,
    private troops: number | null = null,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    const player = this.player;
    if (
      !mg.isValidRef(this.ref) ||
      !player.isAlive() ||
      player.isHegemon() ||
      mg.isSpawnImmunityActive() ||
      !mg.isLand(this.ref)
    ) {
      this.active = false;
      return;
    }
    const owner = mg.owner(this.ref);
    if (
      owner === player ||
      (owner.isPlayer() &&
        (player.isFriendly(owner) || !player.canAttackPlayer(owner)))
    ) {
      this.active = false;
      return;
    }
    // The Hegemon's land beyond the moat is a strike's bubble: only the
    // struck player may land on it (H17).
    if (
      owner.isPlayer() &&
      owner.isHegemon() &&
      !mg.isInDarkStar(this.ref) &&
      !mg.hegemonStrikeOn(player)
    ) {
      this.active = false;
      return;
    }
    if (mg.isInDarkStar(this.ref) && !mg.canInvadeDarkStar(player)) {
      this.refuseDarkStar();
      return;
    }
    const option = player.stargateFor(this.ref);
    if (option === null || option.readyInTicks > 0) {
      mg.displayMessage(
        "events_display.gate_shot_no_gate",
        MessageType.ATTACK_FAILED,
        player.id(),
      );
      this.active = false;
      return;
    }
    const gate = player
      .units(UnitType.Stargate)
      .find((u) => u.id() === option.gateId);
    if (gate === undefined) {
      this.active = false;
      return;
    }

    this.troops ??= mg.config().boatAttackAmount(player, owner);
    this.troops = Math.min(Math.floor(this.troops), player.troops());
    if (this.troops < 1) {
      this.active = false;
      return;
    }

    this.launch(ticks, gate);
    gate.launch();
    mg.addGateShotInFlight(this);
    if (owner.isPlayer()) {
      mg.displayIncomingUnit(
        this.shot!.id(),
        `${player.displayName()} - gate shot inbound (${renderTroops(this.troops)} troops)`,
        MessageType.NAVAL_INVASION_INBOUND,
        owner.id(),
      );
    }
    mg.stats().boatSendTroops(player, owner, this.troops);
  }

  private refuseDarkStar(): void {
    this.mg.displayMessage(
      "events_display.dark_star_occupied",
      MessageType.ATTACK_FAILED,
      this.player.id(),
    );
    this.active = false;
  }

  // The same flight as the throne's strike: a Projectile with a motion plan
  // the client derives its position from, stepped by tick() on the same arc.
  private launch(ticks: number, gate: Unit): void {
    const from = gate.tile();
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
    const trajectory: TrajectoryTile[] = (
      this.pathFinder.findPath(from, this.ref) ?? []
    ).map((tile) => ({ tile, targetable: false }));
    // buildUnit takes the troops from the player: they leave at launch.
    this.shot = this.player.buildUnit(UnitType.Projectile, from, {
      targetTile: this.ref,
      trajectory,
      troops: this.troops ?? 0,
    });
    this.mg.recordMotionPlan({
      kind: "grid",
      unitId: this.shot.id(),
      planId: 1,
      startTick: ticks + 1,
      ticksPerStep: 1,
      path,
    });
  }

  // GateShotInFlight
  unitId(): number {
    return this.shot?.id() ?? -1;
  }

  owner(): Player {
    return this.player;
  }

  targetTile(): TileRef {
    return this.ref;
  }

  // Troops home whole, the unit gone without an impact.
  recall(): void {
    if (!this.active || this.shot === null) return;
    this.player.addTroops(this.shot.troops());
    this.vanish();
  }

  private vanish(): void {
    if (this.shot !== null && this.shot.isActive()) {
      this.shot.delete(false);
    }
    this.shot = null;
    this.mg.removeGateShotInFlight(this);
    this.active = false;
  }

  tick(ticks: number): void {
    if (this.shot === null || this.pathFinder === null) {
      this.active = false;
      return;
    }
    if (!this.shot.isActive()) {
      // Something else removed it (the owner's death sweep).
      this.vanish();
      return;
    }
    if (!this.player.isAlive()) {
      this.vanish();
      return;
    }
    // Bound for the Dark Star when someone else claimed the slot: no longer
    // a valid attack, so the troops come home at once (H12), as a fleet's do.
    if (
      this.mg.isInDarkStar(this.ref) &&
      !this.mg.canInvadeDarkStar(this.player)
    ) {
      this.mg.displayMessage(
        "events_display.dark_star_turned_back",
        MessageType.ATTACK_CANCELLED,
        this.player.id(),
      );
      this.recall();
      return;
    }
    const speed = this.mg.config().hegemonConfig().strikeSpeed;
    const result = this.pathFinder.next(this.launchTile, this.ref, speed);
    if (result.status === PathStatus.NEXT) {
      this.shot.move(result.node);
      this.shot.setTrajectoryIndex(this.pathFinder.currentIndex());
      return;
    }
    this.land();
  }

  private land(): void {
    const shot = this.shot!;
    const troops = shot.troops();
    const owner = this.mg.owner(this.ref);
    shot.move(this.ref);
    if (
      owner === this.player ||
      (owner.isPlayer() && this.player.isFriendly(owner))
    ) {
      // Ours, or a friend's, by the time it arrives: the troops just join.
      this.player.addTroops(troops);
    } else {
      // The beachhead: the aimed tile is taken outright and the attack fights
      // outward from it. On the Dark Star this claims the invasion slot. The
      // tile is tagged so the pocket it founds is never absorbed as an enclave
      // while the tile is held (PlayerExecution).
      this.player.conquer(this.ref);
      this.player.markBeachhead(this.ref);
      this.mg.addExecution(
        new AttackExecution(troops, this.player, owner.id(), this.ref, false),
      );
    }
    this.mg.stats().boatArriveTroops(this.player, owner, troops);
    shot.setReachedTarget();
    shot.delete(false);
    this.shot = null;
    this.mg.removeGateShotInFlight(this);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}
