import { renderNumber } from "../../client/Utils";
import {
  Execution,
  Game,
  Gold,
  MessageType,
  Player,
  TitheInFlight,
  TitheOption,
  TrajectoryTile,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { UniversalPathFinding } from "../pathfinding/PathFinder";
import { ParabolaUniversalPathFinder } from "../pathfinding/PathFinder.Parabola";
import { PathStatus } from "../pathfinding/types";

// The throne's tithe (docs/DarkStar-Rework.md TI1-TI11). The Hegemon aims it
// at any tile outside its domain; it flies from the Dark Star's centre on the
// strike's arc and at the strike's speed, the ring drawn on the aim tile all
// the way. When it lands, every challenger owning a tile within the radius
// pays the throne all its gold above the reserve, reckoned at landing, so a
// player who spends (or gives away) its gold under the ring pays nothing.
// Shields do not stop it. One in flight at a time; the next may be launched
// the cooldown after the last lands.
export class TitheExecution implements Execution, TitheInFlight {
  private active = true;
  private mg: Game;
  private projectile: Unit | null = null;
  private pathFinder: ParabolaUniversalPathFinder | null = null;
  private launchTile: TileRef = 0;
  private arrivalTick = 0;
  // The owners under the ring, recomputed at most once a tick (touches()).
  private ownersTick = -1;
  private owners = new Set<number>();

  constructor(
    private hegemon: Player,
    private ref: TileRef,
  ) {}

  // Ticks until the throne may launch another tithe: 0 = now, null while
  // one is in flight.
  static readyInTicks(mg: Game): number | null {
    if (mg.titheInFlight() !== null) return null;
    const landed = mg.lastTitheLandedTick();
    if (landed === null) return 0;
    const cooldown = mg.config().titheConfig().cooldownSeconds * 10;
    return Math.max(0, landed + cooldown - mg.ticks());
  }

  // Whether the throne may aim a tithe at this tile now.
  static canTithe(mg: Game, hegemon: Player, tile: TileRef): boolean {
    return (
      mg.darkStar() !== null &&
      hegemon.isHegemon() &&
      hegemon.isAlive() &&
      !mg.inSpawnPhase() &&
      mg.isValidRef(tile) &&
      !mg.isInDarkStar(tile) &&
      TitheExecution.readyInTicks(mg) === 0
    );
  }

  // The challengers owning a tile within the radius of the tile (TI2):
  // Lords and Barons included, the throne never. Integer squared distance.
  static ownersUnder(mg: Game, tile: TileRef): Set<number> {
    const radius = mg.config().titheConfig().radius;
    const owners = new Set<number>();
    const hegemon = mg.hegemon();
    const hegemonID = hegemon === null ? -1 : hegemon.smallID();
    mg.circleSearch(tile, radius, (t: TileRef) => {
      const id = mg.ownerID(t);
      if (id > 0 && id !== hegemonID) owners.add(id);
      return false;
    });
    return owners;
  }

  // What each owner under the ring would pay now: all its gold above the
  // reserve. Players at or below the reserve are left out.
  static dues(mg: Game, tile: TileRef): { payer: Player; gold: Gold }[] {
    const reserve = mg.config().titheConfig().reserve;
    const dues: { payer: Player; gold: Gold }[] = [];
    for (const id of TitheExecution.ownersUnder(mg, tile)) {
      const payer = mg.playerBySmallID(id);
      if (!payer.isPlayer() || !payer.isAlive()) continue;
      const gold = payer.gold() - reserve;
      if (gold > 0n) dues.push({ payer, gold });
    }
    return dues;
  }

  // The radial menu's view of a tithe on this tile (TI7).
  static option(mg: Game, tile: TileRef): TitheOption {
    return {
      readyInTicks: TitheExecution.readyInTicks(mg),
      payers: mg.isValidRef(tile)
        ? TitheExecution.dues(mg, tile).map(({ payer, gold }) => ({
            name: payer.displayName(),
            gold,
          }))
        : [],
    };
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!TitheExecution.canTithe(mg, this.hegemon, this.ref)) {
      this.active = false;
      return;
    }
    const geometry = mg.darkStar()!;
    this.launch(ticks, mg.ref(geometry.cx, geometry.cy));
    mg.setTitheInFlight(this);
  }

  // Build the projectile at the Dark Star's centre on the strike's arc, as
  // RazeExecution does, and record the flight so the client can draw it.
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
    this.arrivalTick = ticks + path.length;
    const trajectory: TrajectoryTile[] = (
      this.pathFinder.findPath(from, this.ref) ?? []
    ).map((tile) => ({ tile, targetable: false }));
    this.projectile = this.hegemon.buildUnit(UnitType.Projectile, from, {
      targetTile: this.ref,
      trajectory,
      tithe: true,
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

  tick(ticks: number): void {
    if (this.projectile === null || this.pathFinder === null) {
      this.end(0n);
      return;
    }
    const speed = this.mg.config().hegemonConfig().strikeSpeed;
    const result = this.pathFinder.next(this.launchTile, this.ref, speed);
    if (result.status === PathStatus.NEXT) {
      this.projectile.move(result.node);
      this.projectile.setTrajectoryIndex(this.pathFinder.currentIndex());
      return;
    }
    this.projectile.move(this.ref);
    this.projectile.setReachedTarget();
    this.projectile.delete(false);
    this.projectile = null;
    this.end(this.collect());
  }

  // The landing (TI2): reckoned now, from the gold each owner holds now.
  private collect(): Gold {
    let total = 0n;
    let payers = 0;
    // The throne may have fallen in flight: nobody to pay.
    if (!this.hegemon.isAlive() || !this.hegemon.isHegemon()) return 0n;
    for (const { payer, gold } of TitheExecution.dues(this.mg, this.ref)) {
      const taken = payer.removeGold(gold);
      if (taken <= 0n) continue;
      total += taken;
      payers++;
      this.mg.displayMessage(
        "events_display.dark_star_tithe_paid",
        MessageType.DONATION_SENT,
        payer.id(),
        undefined,
        { gold: renderNumber(Number(taken)) },
      );
    }
    this.hegemon.addGold(total);
    this.mg.displayMessage(
      payers === 0
        ? "events_display.dark_star_tithe_none"
        : payers === 1
          ? "events_display.dark_star_tithe_collected_one"
          : "events_display.dark_star_tithe_collected",
      MessageType.DONATION_RECEIVED,
      this.hegemon.id(),
      undefined,
      { gold: renderNumber(Number(total)), count: payers },
    );
    return total;
  }

  private end(gold: Gold): void {
    if (this.projectile !== null && this.projectile.isActive()) {
      this.projectile.delete(false);
    }
    this.projectile = null;
    this.mg.recordTitheLanded(gold);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  // TitheInFlight.
  aimTile(): TileRef {
    return this.ref;
  }
  landsAtTick(): number {
    return this.arrivalTick;
  }
  touches(player: Player): boolean {
    if (this.ownersTick !== this.mg.ticks()) {
      this.owners = TitheExecution.ownersUnder(this.mg, this.ref);
      this.ownersTick = this.mg.ticks();
    }
    return this.owners.has(player.smallID());
  }
}
