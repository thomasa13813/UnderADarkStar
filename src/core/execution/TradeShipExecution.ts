import { renderNumber } from "../../client/Utils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { findClosestBy } from "../Util";

// A freighter's voyage runs in three legs (S7, docs/DarkStar-Design.md
// §6.18): overland from its port to the port's harbour, across deep space
// from harbour to harbour, and overland into the destination port. Land is
// slow — one tile every `freighterLandTicksPerTile` ticks — deep space is a
// tile a tick. A coastal port's harbour is its adjacent water: its land legs
// are empty and the ship sails port tile to port tile exactly as it always
// did, the water pathfinder's shore coercion taking it on and off the land.
type Leg = "out" | "space" | "in";

// Where a voyage ends: the water tile the space leg sails to, and the land
// tiles from there into the port (empty when the water leg ends on the port
// tile itself, as for a coastal port).
interface Landing {
  readonly target: TileRef;
  readonly inland: readonly TileRef[];
}

export class TradeShipExecution implements Execution {
  private active = true;
  private mg: Game;
  private tradeShip: Unit | undefined;
  private wasCaptured = false;
  private pathFinder: WaterPathFinder;
  private tilesTraveled = 0;
  private motionPlanId = 0;
  private motionPlanDst: TileRef | null = null;

  private leg: Leg = "out";
  // The current land leg: its tiles and how far along it the ship is.
  private landPath: readonly TileRef[] = [];
  private landIndex = 0;
  private landWait = 0;
  private srcHarbour: TileRef | null = null;
  private landing: Landing | null = null;

  private static _staggerCounter = 0;

  constructor(
    private origOwner: Player,
    private srcPort: Unit,
    private _dstPort: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    const stagger =
      TradeShipExecution._staggerCounter++ % WaterPathFinder.STAGGER_SPREAD;
    this.pathFinder = new WaterPathFinder(mg, stagger, true); // memoized: harbour to harbour repeats
  }

  tick(ticks: number): void {
    if (this.pathFinder.rebuilt) {
      this.motionPlanDst = null; // Force motion plan re-recording
    }

    if (this.tradeShip === undefined) {
      const spawn = this.origOwner.canBuild(
        UnitType.TradeShip,
        this.srcPort.tile(),
      );
      if (spawn === false) {
        console.warn(`cannot build trade ship`);
        this.active = false;
        return;
      }
      this.tradeShip = this.origOwner.buildUnit(UnitType.TradeShip, spawn, {
        targetUnit: this._dstPort,
        lastSetSafeFromPirates: ticks,
      });
      this.mg.stats().boatSendTrade(this.origOwner, this._dstPort.owner());
    }

    if (!this.tradeShip.isActive()) {
      this.active = false;
      return;
    }

    if (this.landing === null) {
      this.planVoyage();
    }

    const tradeShipOwner = this.tradeShip.owner();
    const dstPortOwner = this._dstPort.owner();
    if (this.wasCaptured !== true && this.origOwner !== tradeShipOwner) {
      // Store as variable in case ship is recaptured by previous owner
      this.wasCaptured = true;
      this.mg.displayMessage(
        "events_display.trade_ship_captured",
        MessageType.UNIT_DESTROYED,
        this.origOwner.id(),
        undefined,
        { name: tradeShipOwner.displayName() },
        this.tradeShip.id(),
        tradeShipOwner.id(),
      );
    }

    // If a player captures another player's port while trading we should delete
    // the ship.
    if (dstPortOwner.id() === this.srcPort.owner().id()) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    if (
      !this.wasCaptured &&
      (!this._dstPort.isActive() || !tradeShipOwner.canTrade(dstPortOwner))
    ) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    const curTile = this.tradeShip.tile();

    if (
      this.wasCaptured &&
      (tradeShipOwner !== dstPortOwner || !this._dstPort.isActive())
    ) {
      if (!this.retargetToCaptorsPort(curTile)) {
        this.tradeShip.delete(false);
        this.active = false;
        return;
      }
    }

    if (curTile === this.dstPort()) {
      this.complete();
      return;
    }

    if (this.leg !== "space") {
      if (this.stepLand(ticks) || this.leg === "in") {
        return;
      }
      // Out of land: put to space.
      this.leg = "space";
      this.motionPlanDst = null;
    }

    const dst = this.landing!.target;
    const result = this.pathFinder.next(curTile, dst);

    switch (result.status) {
      case PathStatus.NEXT:
        if (dst !== this.motionPlanDst) {
          this.motionPlanId++;
          const from = result.node;
          const path = this.pathFinder.pathForTraversal(from, dst);

          this.mg.recordMotionPlan({
            kind: "grid",
            unitId: this.tradeShip.id(),
            planId: this.motionPlanId,
            startTick: ticks + 1,
            ticksPerStep: 1,
            path,
          });
          this.motionPlanDst = dst;
        }
        // Update safeFromPirates status
        if (this.mg.isWater(result.node) && this.mg.isShoreline(result.node)) {
          this.tradeShip.setSafeFromPirates();
        }
        this.tradeShip.move(result.node);
        this.tilesTraveled++;
        if (result.node === dst) {
          this.arriveInSpace();
        }
        break;
      case PathStatus.COMPLETE:
        this.arriveInSpace();
        return;
      case PathStatus.NOT_FOUND:
        console.warn("captured trade ship cannot find route");
        if (this.tradeShip.isActive()) {
          this.tradeShip.delete(false);
        }
        this.active = false;
        return;
    }
  }

  // The space leg has reached its target: the port itself, or the harbour
  // from which the land leg in begins.
  private arriveInSpace(): void {
    const landing = this.landing!;
    if (landing.inland.length === 0) {
      this.complete();
      return;
    }
    this.leg = "in";
    this.landPath = landing.inland;
    this.landIndex = 0;
    this.landWait = this.landTicksPerTile() - 1;
  }

  // The harbours the voyage sails between: the first of the source port's
  // and the first landing of the destination's on the same body of space,
  // in harbour order, so every client picks the same. A port without a
  // harbour (or a pair without a shared body of space) sails port tile to
  // port tile as trade ships always did.
  private planVoyage(): void {
    const mg = this.mg;
    const srcHarbours = mg.harbours(this.srcPort.tile());
    for (const src of srcHarbours) {
      const component = mg.getWaterComponent(src.tile);
      if (component === null) continue;
      const landing = this.landingFor(this._dstPort, component);
      if (landing === undefined) continue;
      this.srcHarbour = src.tile;
      this.landing = landing;
      this.beginLegOut(src.path.slice(0, -1));
      return;
    }
    this.srcHarbour = this.srcPort.tile();
    this.landing = { target: this._dstPort.tile(), inland: [] };
    this.beginLegOut([]);
  }

  // How a voyage on `component` ends at `port`: on the port tile itself when
  // the port stands on that body of space (a coastal port, or one with no
  // harbour at all), else at its harbour there and overland from it — the
  // harbour path backwards, without the harbour, ending on the port tile.
  private landingFor(port: Unit, component: number): Landing | undefined {
    const mg = this.mg;
    const harbours = mg.harbours(port.tile());
    if (harbours.length === 0) {
      return mg.hasWaterComponent(port.tile(), component)
        ? { target: port.tile(), inland: [] }
        : undefined;
    }
    for (const h of harbours) {
      if (!mg.hasWaterComponent(h.tile, component)) continue;
      if (h.path.length <= 1) {
        return { target: port.tile(), inland: [] };
      }
      const inland = h.path.slice(0, -1).reverse();
      inland.push(port.tile());
      return { target: h.tile, inland };
    }
    return undefined;
  }

  private beginLegOut(landTiles: readonly TileRef[]): void {
    this.leg = "out";
    this.landPath = landTiles;
    this.landIndex = 0;
    this.landWait = this.landTicksPerTile() - 1;
  }

  private landTicksPerTile(): number {
    return Math.max(1, this.mg.config().freighterLandTicksPerTile());
  }

  // One tick of a land leg. True while the leg still has tiles (whether the
  // ship stepped or waited), false once it has none left.
  private stepLand(ticks: number): boolean {
    if (this.landIndex >= this.landPath.length) {
      return false;
    }
    if (this.landWait > 0) {
      this.landWait--;
      return true;
    }
    if (this.landIndex === 0) {
      this.motionPlanId++;
      this.mg.recordMotionPlan({
        kind: "grid",
        unitId: this.tradeShip!.id(),
        planId: this.motionPlanId,
        startTick: ticks + 1,
        ticksPerStep: this.landTicksPerTile(),
        path: this.landPath,
      });
    }
    this.tradeShip!.move(this.landPath[this.landIndex++]);
    this.tilesTraveled++;
    this.landWait = this.landTicksPerTile() - 1;
    // Leg in ends on the port tile: the arrival is booked next tick.
    return true;
  }

  // A captured ship sails for its captor's nearest port reachable on the
  // body of space it is on (or is bound for, on a land leg), then in.
  private retargetToCaptorsPort(curTile: TileRef): boolean {
    const mg = this.mg;
    const captor = this.tradeShip!.owner();
    const anchor = mg.isWater(curTile)
      ? curTile
      : this.leg === "out"
        ? this.srcHarbour!
        : this.landing!.target;
    const component = mg.getWaterComponent(anchor);
    if (component === null) return false;
    const nearestPort = findClosestBy(
      captor.units(UnitType.Port),
      (port) => mg.manhattanDist(port.tile(), curTile),
      (port) =>
        port.isActive() &&
        !port.isMarkedForDeletion() &&
        !port.isUnderConstruction() &&
        this.landingFor(port, component) !== undefined,
    );
    if (nearestPort === null) {
      return false;
    }
    this._dstPort = nearestPort;
    this.landing = this.landingFor(nearestPort, component)!;
    if (this.leg === "in") {
      // Taken while inland of the old port: back out to space first.
      this.leg = "space";
    }
    this.motionPlanDst = null;
    this.tradeShip!.setTargetUnit(this._dstPort);
    // Plan-driven units don't emit per-tick unit updates, so force a sync for the new target.
    this.tradeShip!.touch();
    return true;
  }

  private complete() {
    this.active = false;
    this.tradeShip!.delete(false);
    const gold = this.mg
      .config()
      .tradeShipGold(this.tilesTraveled, this.tradeShip!.owner());

    if (this.wasCaptured && this.tradeShip!.owner() === this.origOwner) {
      // Retaken by its original owner: the payout stands, but nobody pirated it.
      this.origOwner.addGold(gold, this._dstPort.tile());
    } else if (this.wasCaptured) {
      this.tradeShip!.owner().addGold(gold, this._dstPort.tile());
      this.tradeShip!.owner().addPiracyGold(gold);
      this.mg.displayMessage(
        "events_display.received_gold_from_captured_ship",
        MessageType.CAPTURED_ENEMY_UNIT,
        this.tradeShip!.owner().id(),
        gold,
        {
          gold: renderNumber(gold),
          name: this.origOwner.displayName(),
        },
        undefined,
        this.origOwner.id(),
      );
      // Record stats
      this.mg
        .stats()
        .boatCapturedTrade(this.tradeShip!.owner(), this.origOwner, gold);
    } else {
      this.srcPort.owner().addGold(gold, this.srcPort.tile());
      this._dstPort.owner().addGold(gold, this._dstPort.tile());
      this.srcPort.owner().addTradeGold(gold);
      this._dstPort.owner().addTradeGold(gold);
      // Record stats
      this.mg
        .stats()
        .boatArriveTrade(this.srcPort.owner(), this._dstPort.owner(), gold);
    }
    return;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  dstPort(): TileRef {
    return this._dstPort.tile();
  }
}
