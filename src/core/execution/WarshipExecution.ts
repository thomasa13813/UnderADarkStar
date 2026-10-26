import { renderNumber, renderTroops } from "../../client/Utils";
import {
  Execution,
  Game,
  isUnit,
  MessageType,
  OwnerComp,
  Unit,
  UnitParams,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { ShellExecution } from "./ShellExecution";

export class WarshipExecution implements Execution {
  private random: PseudoRandom;
  private warship: Unit;
  private mg: Game;
  private pathfinder: WaterPathFinder;
  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();
  private lastManualMoveTickRetreatDisabled = 0;
  private lastObservedPatrolTile: TileRef | undefined;
  private activeHealingRemainder = 0;
  private lastEmittedCombat = false;
  // A destroyer of the Dark Star (H10): portless, defensive, never a raider;
  // it goes wherever the throne sends it (revised 2026-10-25).
  private hegemon = false;
  // A pirate's corsair (docs/DarkStar-Piracy.md, PR2–PR6, PR11): portless,
  // never fires on fleets, scuttles the freighters it catches into a hold of
  // troops and a purse of raid gold, heals slowly anywhere, never retreats.
  private pirate = false;

  constructor(
    private input: (UnitParams<UnitType.Warship> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathfinder = new WaterPathFinder(mg);
    this.random = new PseudoRandom(mg.ticks());
    if (isUnit(this.input)) {
      this.warship = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        UnitType.Warship,
        this.input.patrolTile,
      );
      if (spawn === false) {
        console.warn(
          `Failed to spawn warship for ${this.input.owner.name()} at ${this.input.patrolTile}`,
        );
        return;
      }
      this.warship = this.input.owner.buildUnit(
        UnitType.Warship,
        spawn,
        this.input,
      );
    }
    this.hegemon = this.warship.owner().isHegemon();
    this.pirate = this.warship.owner().isPirate();
    this.lastObservedPatrolTile = this.warship.warshipState().patrolTile;
  }

  tick(ticks: number): void {
    if (this.warship.health() <= 0) {
      this.warship.delete();
      return;
    }
    const isInCombat = this.warship.warshipState().isInCombat ?? false;
    if (this.lastEmittedCombat && !isInCombat) {
      this.warship.touch();
    }
    this.lastEmittedCombat = isInCombat;
    const healthBeforeHealing = this.warship.health();

    this.healWarship();
    this.handleManualPatrolOverride();

    // A corsair (PR4–PR6): no port to retreat to and no fleets to shoot. It
    // returns fire on a warship in range, hunts freighters within its patrol
    // range, and otherwise patrols where the pirate pointed it.
    if (this.pirate) {
      // A landing under way (PR7): PirateLandingExecution sails the ship.
      if (this.warship.owner().pirateLanding() !== undefined) {
        return;
      }
      this.warship.setTargetUnit(this.findTargetUnit());
      if (this.warship.targetUnit()?.type() === UnitType.Warship) {
        this.shootTarget();
        this.patrol();
        return;
      }
      if (this.warship.targetUnit()?.type() === UnitType.TradeShip) {
        this.huntDownTradeShip();
        return;
      }
      this.patrol();
      return;
    }

    // A doomed side cannot repair its navy (see healWarship), so retreating to
    // a port only pulls a warship out of the fight to idle there forever. Undock
    // or abort any retreat and keep patrolling until the side recovers.
    if (
      this.warship.owner().inDoomsdayClock() &&
      this.warship.warshipState().state !== "patrolling"
    ) {
      this.cancelRepairRetreat();
    }

    if (this.warship.warshipState().state === "docked") {
      if (this.currentRetreatPort() === undefined) {
        this.cancelRepairRetreat();
      }
      if (this.isFullyHealed()) {
        this.cancelRepairRetreat();
      }
      if (this.warship.warshipState().state === "docked") {
        return;
      }
    }

    if (this.handleRepairRetreat()) {
      return;
    }

    // Priority 1: Check if need to heal before doing anything else
    if (this.shouldStartRepairRetreat(healthBeforeHealing)) {
      this.startRepairRetreat();
      if (this.handleRepairRetreat()) {
        return;
      }
    }

    this.warship.setTargetUnit(this.findTargetUnit());

    // Priority 1: Shoot transport ship if in range
    if (this.warship.targetUnit()?.type() === UnitType.TransportShip) {
      this.shootTarget();
      this.patrol();
      return;
    }

    // Priority 2: Fight enemy warship if in range
    if (this.warship.targetUnit()?.type() === UnitType.Warship) {
      this.shootTarget();
      this.patrol();
      return;
    }

    // Priority 3: Hunt trade ship only if not healing and no enemy warship
    if (this.warship.targetUnit()?.type() === UnitType.TradeShip) {
      this.huntDownTradeShip();
      return;
    }

    // Priority 4, the throne's destroyers (H10): with nothing in range, one
    // stationed in the moat goes and meets an invasion fleet still on its
    // way. One the throne sent elsewhere keeps to its post.
    if (this.hegemon && this.stationedInMoat() && this.intercept()) {
      return;
    }

    this.patrol();
  }

  private healWarship(): void {
    const owner = this.warship.owner();
    // A corsair heals slowly, anywhere (PR11): it has no port and never
    // docks, so a hurt one hides rather than lands.
    if (this.pirate) {
      const every = this.mg.config().piracyConfig().healEveryTicks;
      if (every > 0 && this.mg.ticks() % every === 0) {
        this.warship.modifyHealth(1);
      }
      return;
    }
    // A doomed side (below the Doomsday Clock bar) cannot repair its navy, so the
    // decay in DoomsdayClockExecution actually sinks warships instead of being
    // out-healed at a port. Inert when the mode is off: the mark is never set.
    if (owner.inDoomsdayClock()) return;
    const passiveHealing = this.mg.config().warshipPassiveHealing();
    const passiveHealingRange = this.mg.config().warshipPassiveHealingRange();
    const passiveHealingRangeSquared =
      passiveHealingRange * passiveHealingRange;
    const warshipTile = this.warship.tile();

    // Near a spaceport's harbour (§6.17): an inland port repairs at the
    // deep space its ships are launched from, not at the port itself.
    let isNearPort = false;
    for (const port of owner.units(UnitType.Port)) {
      for (const harbour of this.mg.harbours(port.tile())) {
        const distSquared = this.mg.euclideanDistSquared(
          warshipTile,
          harbour.tile,
        );
        if (distSquared <= passiveHealingRangeSquared) {
          isNearPort = true;
          break;
        }
      }
      if (isNearPort) break;
    }

    // The moat is the destroyers' harbour (H10): the throne has no port.
    if (isNearPort || (this.hegemon && this.mg.isInMoat(warshipTile))) {
      this.warship.modifyHealth(passiveHealing);
    }

    if (this.warship.warshipState().state === "docked") {
      this.applyActiveDockedHealing();
    }
  }

  private isFullyHealed(): boolean {
    if (!this.warship.hasHealth()) {
      return true;
    }
    return this.warship.health() >= this.warship.maxHealth();
  }

  private shouldStartRepairRetreat(
    healthBeforeHealing = this.warship.health(),
  ): boolean {
    if (this.warship.warshipState().state !== "patrolling") {
      return false;
    }
    // A doomed side cannot repair (see healWarship), so there is nothing to
    // retreat for; stay on patrol instead of idling at a port.
    if (this.warship.owner().inDoomsdayClock()) {
      return false;
    }
    const manualMoveRetreatDisabledDuration = 50;
    if (
      this.mg.ticks() - this.lastManualMoveTickRetreatDisabled <
      manualMoveRetreatDisabledDuration
    ) {
      return false;
    }
    // Percentage of (veterancy-adjusted) max health, so a tougher veteran ship
    // retreats at the same relative health as a fresh one. Integer math.
    const retreatThreshold = Math.floor(
      (this.warship.maxHealth() *
        this.mg.config().warshipRetreatHealthPercent()) /
        100,
    );
    if (healthBeforeHealing >= retreatThreshold) {
      return false;
    }
    const ports = this.warship.owner().units(UnitType.Port);
    return ports.length > 0;
  }

  private findNearestPort(): TileRef | undefined {
    return this.nearestHarbourTile()?.tile;
  }

  // The owner's spaceports and their harbours on this ship's body of space
  // (§6.17): where it is repaired. A coastal port's harbours are its
  // adjacent water, so the old "the port's tile" is one tile off at most.
  private *harbours(): Generator<{ port: Unit; tile: TileRef }> {
    const component = this.mg.getWaterComponent(this.warship.tile());
    if (component === null) return;
    for (const port of this.warship.owner().units(UnitType.Port)) {
      if (!port.isActive() || port.isUnderConstruction()) continue;
      for (const harbour of this.mg.harbours(port.tile())) {
        if (this.mg.hasWaterComponent(harbour.tile, component)) {
          yield { port, tile: harbour.tile };
        }
      }
    }
  }

  // The owner's spaceport whose harbour is `tile`, if any.
  private portAt(tile: TileRef | undefined): Unit | undefined {
    if (tile === undefined) return undefined;
    for (const h of this.harbours()) {
      if (h.tile === tile) return h.port;
    }
    return undefined;
  }

  private nearestHarbourTile(
    excludeShip?: Unit,
    availableOnly = false,
  ): { tile: TileRef; distSquared: number } | undefined {
    const warshipTile = this.warship.tile();
    let best: { tile: TileRef; distSquared: number } | undefined;
    for (const h of this.harbours()) {
      if (
        availableOnly &&
        this.isPortFullOfHealing(h.port, h.tile, excludeShip)
      ) {
        continue;
      }
      const distSquared = this.mg.euclideanDistSquared(warshipTile, h.tile);
      if (best === undefined || distSquared < best.distSquared) {
        best = { tile: h.tile, distSquared };
      }
    }
    return best;
  }

  private findRetreatAggroTarget(): Unit | undefined {
    return this.findBestTarget([UnitType.TransportShip, UnitType.Warship]);
  }

  private findTargetUnit(): Unit | undefined {
    // A corsair never fires on fleets (PR6): a dead player must not decide
    // who reaches the throne.
    if (this.pirate) {
      return this.findBestTarget([UnitType.Warship, UnitType.TradeShip], true);
    }
    // The throne's destroyers never raid commerce (H10, 2026-10-25).
    if (this.hegemon) {
      return this.findBestTarget([UnitType.TransportShip, UnitType.Warship]);
    }
    return this.findBestTarget(
      [UnitType.TransportShip, UnitType.Warship, UnitType.TradeShip],
      true,
    );
  }

  /**
   * Shared target selection: searches nearby units of given types,
   * filters common exclusions (self, friendly, docked, already-shelled),
   * picks best by type priority (lower index = higher priority) then distance.
   *
   * When `includeTradeShips` is true, applies trade-ship-specific filters
   * (safe from pirates, patrol range, water component, allied destination).
   */
  private findBestTarget(
    types: UnitType[],
    includeTradeShips = false,
  ): Unit | undefined {
    const mg = this.mg;
    const config = mg.config();
    const owner = this.warship.owner();

    const ships = mg.nearbyUnits(
      this.warship.tile(),
      config.warshipTargettingRange(),
      types,
    );

    // Trade-ship-specific state, lazily computed.
    let hasReachablePort: boolean | undefined;
    let patrolTile: number | undefined;
    let patrolRangeSquared: number | undefined;
    let warshipComponent: number | null | undefined = undefined;

    let bestUnit: Unit | undefined = undefined;
    let bestTypePriority = 0;
    let bestDistSquared = 0;

    for (const { unit, distSquared } of ships) {
      if (
        unit === this.warship ||
        unit.owner() === owner ||
        !owner.canAttackPlayer(unit.owner(), true) ||
        this.alreadySentShell.has(unit) ||
        (unit.type() === UnitType.Warship &&
          unit.warshipState().state === "docked")
      ) {
        continue;
      }

      const type = unit.type();

      // Purely defensive (H10): the throne's destroyers pick their fights.
      if (this.hegemon && !this.hegemonMayEngage(unit, type)) {
        continue;
      }

      if (includeTradeShips && type === UnitType.TradeShip) {
        if (warshipComponent === undefined) {
          warshipComponent = mg.getWaterComponent(this.warship.tile());
          hasReachablePort =
            warshipComponent !== null &&
            owner
              .units(UnitType.Port)
              .some(
                (port) =>
                  port.isActive() &&
                  !port.isMarkedForDeletion() &&
                  !port.isUnderConstruction() &&
                  mg
                    .harbours(port.tile())
                    .some((h) =>
                      mg.hasWaterComponent(h.tile, warshipComponent!),
                    ),
              );
          patrolTile = this.warship.warshipState().patrolTile;
          patrolRangeSquared = config.warshipPatrolRange() ** 2;
        }
        if (
          // A freighter on its land leg is beyond a deep-space ship's reach
          // (S7, §6.18): slow inland, but safe.
          mg.isLand(unit.tile()) ||
          // A corsair scuttles its prize where it stands (PR5), so it needs
          // no port.
          (!hasReachablePort && !this.pirate) ||
          // The Dark Star's water is not a corsair's hunting ground (PR5).
          (this.pirate && mg.isInMoat(unit.tile())) ||
          patrolTile === undefined ||
          unit.isSafeFromPirates() ||
          unit.targetUnit()?.owner() === owner ||
          unit.targetUnit()?.owner().isFriendly(owner)
        ) {
          continue;
        }
        if (
          mg.euclideanDistSquared(patrolTile, unit.tile()) > patrolRangeSquared!
        ) {
          continue;
        }
      }

      const typePriority =
        type === UnitType.TransportShip ? 0 : type === UnitType.Warship ? 1 : 2;

      if (
        bestUnit === undefined ||
        typePriority < bestTypePriority ||
        (typePriority === bestTypePriority && distSquared < bestDistSquared)
      ) {
        bestUnit = unit;
        bestTypePriority = typePriority;
        bestDistSquared = distSquared;
      }
    }

    return bestUnit;
  }

  private startRepairRetreat(): void {
    const portTile = this.findNearestPort();
    if (portTile === undefined) {
      return;
    }
    this.warship.updateWarshipState({
      retreatPort: portTile,
      state: "retreating",
    });
    this.activeHealingRemainder = 0;
    this.warship.setTargetUnit(undefined);
  }

  private cancelRepairRetreat(clearTargetTile = true): void {
    this.activeHealingRemainder = 0;
    this.warship.updateWarshipState({
      state: "patrolling",
      retreatPort: undefined,
    });
    if (clearTargetTile) {
      this.warship.setTargetTile(undefined);
    }
  }

  private handleManualPatrolOverride(): void {
    const patrolTile = this.warship.warshipState().patrolTile;
    if (
      this.lastObservedPatrolTile !== undefined &&
      patrolTile !== this.lastObservedPatrolTile
    ) {
      this.lastManualMoveTickRetreatDisabled = this.mg.ticks();
      if (this.warship.warshipState().state !== "patrolling") {
        this.cancelRepairRetreat(false);
      }
    }
    this.lastObservedPatrolTile = patrolTile;
  }

  private handleRepairRetreat(): boolean {
    if (this.warship.warshipState().state === "patrolling") {
      return false;
    }

    const retreatAggroTarget = this.findRetreatAggroTarget();
    if (retreatAggroTarget) {
      this.warship.setTargetUnit(retreatAggroTarget);
      this.shootTarget();
      // Fall through — continue retreating toward port even while firing back.
    }

    if (!this.refreshRetreatPortTile()) {
      this.cancelRepairRetreat();
      return false;
    }

    // Only clear the target when there's no active aggro target this tick.
    if (!retreatAggroTarget) {
      this.warship.setTargetUnit(undefined);
    }

    const retreatPortTile = this.warship.warshipState().retreatPort;
    if (retreatPortTile === undefined) {
      return false;
    }

    const dockingRadius = this.mg.config().warshipDockingRange();
    const dockingRadiusSq = dockingRadius * dockingRadius;
    const distToPort = this.mg.euclideanDistSquared(
      this.warship.tile(),
      retreatPortTile,
    );

    if (distToPort <= dockingRadiusSq) {
      // Check if the port has capacity available (excluding this warship from capacity check)
      const port = this.portAt(retreatPortTile);
      if (
        port &&
        !this.isPortFullOfHealing(port, retreatPortTile, this.warship)
      ) {
        // Port has capacity - dock here
        this.warship.setTargetTile(undefined);
        this.warship.updateWarshipState({
          state: "docked",
        });
        return true;
      } else {
        // Port is full - wait near port, but leave if already fully healed
        if (this.isFullyHealed()) {
          this.cancelRepairRetreat();
          return false;
        }
        return true;
      }
    }

    this.warship.setTargetTile(retreatPortTile);
    const result = this.pathfinder.next(this.warship.tile(), retreatPortTile);
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.warship.move(result.node);
        if (result.node === retreatPortTile) {
          this.warship.setTargetTile(undefined);
        }
        break;
      case PathStatus.NEXT:
        this.warship.move(result.node);
        break;
      case PathStatus.NOT_FOUND: {
        const newPort = this.findNearestAvailablePortTile();
        this.warship.updateWarshipState({
          retreatPort: newPort,
        });
        if (newPort === undefined) {
          this.cancelRepairRetreat();
        }
        break;
      }
    }

    return true;
  }

  private refreshRetreatPortTile(): boolean {
    const ports = this.warship.owner().units(UnitType.Port);
    if (ports.length === 0) {
      return false;
    }

    const currentRetreatPort = this.warship.warshipState().retreatPort;

    // Check if current retreat port still exists
    const currentPort = this.portAt(currentRetreatPort);

    if (currentPort === undefined) {
      const newPort = this.findNearestAvailablePortTile();
      this.warship.updateWarshipState({
        retreatPort: newPort,
      });
      return newPort !== undefined;
    }

    // Check if current port is now full of healing (not counting arrived warships)
    if (this.isPortFullOfHealing(currentPort, currentRetreatPort!)) {
      // Current port is at healing capacity, look for alternatives
      const alternativePort = this.findNearestAvailablePort();
      if (alternativePort) {
        this.warship.updateWarshipState({
          retreatPort: alternativePort,
        });
      }
      return this.warship.warshipState().retreatPort !== undefined;
    }

    // Check if a significantly closer port is available
    const closerPort = this.findBetterPortTile();
    if (closerPort && closerPort !== currentRetreatPort) {
      this.warship.updateWarshipState({
        retreatPort: closerPort,
      });
      return true;
    }

    return true;
  }

  private isPortFullOfHealing(
    port: Unit,
    harbourTile: TileRef,
    excludeShip?: Unit,
  ): boolean {
    const maxShipsHealing = port.level();
    return (
      this.dockedShipsAtPort(harbourTile, excludeShip).length >= maxShipsHealing
    );
  }

  private dockedShipsAtPort(harbourTile: TileRef, excludeShip?: Unit): Unit[] {
    const dockingRadius = this.mg.config().warshipDockingRange();
    const owner = this.warship.owner();

    return this.mg
      .nearbyUnits(harbourTile, dockingRadius, [UnitType.Warship])
      .filter(({ unit: ship }) => {
        if (excludeShip && ship === excludeShip) return false;
        if (ship.owner() !== owner) return false;
        if (ship.warshipState().state === "patrolling") return false;
        if (ship.targetTile() !== undefined) return false;
        return true;
      })
      .map(({ unit }) => unit);
  }

  private applyActiveDockedHealing(): void {
    const dockedPort = this.currentRetreatPort();
    const harbourTile = this.warship.warshipState().retreatPort;
    if (!dockedPort || harbourTile === undefined) {
      return;
    }

    const dockedShips = this.dockedShipsAtPort(harbourTile);
    if (!dockedShips.some((ship) => ship === this.warship)) {
      return;
    }

    const healingPool =
      dockedPort.level() * this.mg.config().warshipPortHealingBonusPerLevel();
    if (healingPool <= 0 || dockedShips.length === 0) {
      return;
    }

    // Preserve fractional split healing over time with a per-ship remainder.
    const activeHealing = healingPool / dockedShips.length;
    this.activeHealingRemainder += activeHealing;
    const integerHealing = Math.floor(this.activeHealingRemainder);
    if (integerHealing <= 0) {
      return;
    }

    this.activeHealingRemainder -= integerHealing;
    this.warship.modifyHealth(integerHealing);
  }

  private currentRetreatPort(): Unit | undefined {
    return this.portAt(this.warship.warshipState().retreatPort);
  }

  private nearestAvailablePortTile(
    excludeShip?: Unit,
  ): { tile: TileRef; distSquared: number } | undefined {
    return this.nearestHarbourTile(excludeShip, true);
  }

  private findNearestAvailablePort(): TileRef | undefined {
    return this.nearestAvailablePortTile()?.tile;
  }

  private findBetterPortTile(): TileRef | undefined {
    const result = this.nearestAvailablePortTile();
    if (!result) return undefined;

    let currentDistance = Infinity;
    const currentRetreatPort = this.warship.warshipState().retreatPort;
    if (currentRetreatPort !== undefined) {
      currentDistance = this.mg.euclideanDistSquared(
        this.warship.tile(),
        currentRetreatPort,
      );
    }

    if (
      result.distSquared <
      currentDistance * this.mg.config().warshipPortSwitchThreshold()
    ) {
      return result.tile;
    }
    return undefined;
  }

  private findNearestAvailablePortTile(): TileRef | undefined {
    return this.nearestAvailablePortTile(this.warship)?.tile;
  }

  private shootTarget() {
    this.warship.updateWarshipState({ isInCombat: true });
    const shellAttackRate = this.mg.config().warshipShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack > shellAttackRate) {
      if (this.warship.targetUnit()?.type() !== UnitType.TransportShip) {
        // Warships don't need to reload when attacking transport ships.
        this.lastShellAttack = this.mg.ticks();
      }
      this.mg.addExecution(
        new ShellExecution(
          this.warship.tile(),
          this.warship.owner(),
          this.warship,
          this.warship.targetUnit()!,
        ),
      );
      if (!this.warship.targetUnit()!.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(this.warship.targetUnit()!);
        this.warship.setTargetUnit(undefined);
        return;
      }
    }
  }

  private huntDownTradeShip() {
    this.warship.updateWarshipState({ isInCombat: true });
    for (let i = 0; i < 2; i++) {
      const target = this.warship.targetUnit()!;
      const targetTile = target.tile();
      const dist = this.mg.manhattanDist(this.warship.tile(), targetTile);

      if (dist <= 5) {
        this.takePrize(target);
        return;
      }

      // When close, the minimap (2x scale) produces diagonal upscaled paths that
      // make it hard to converge. Use direct greedy movement instead.
      if (dist <= 20) {
        const nextTile = this.bestNeighborToward(targetTile);
        if (nextTile !== undefined) {
          this.warship.move(nextTile);
          continue;
        }
      }

      const result = this.pathfinder.next(this.warship.tile(), targetTile, 5);
      switch (result.status) {
        case PathStatus.COMPLETE:
          this.takePrize(target);
          return;
        case PathStatus.NEXT:
          this.warship.move(result.node);
          break;
        case PathStatus.NOT_FOUND:
          console.log(`path not found to target`);
          break;
      }
    }
  }

  // The freighter is caught: a destroyer captures it and sails it to its
  // port; a corsair scuttles it (PR5).
  private takePrize(target: Unit): void {
    if (this.pirate) {
      this.scuttle(target);
    } else {
      this.warship.owner().captureUnit(target);
      this.warship.recordTradeCapture();
    }
    this.warship.setTargetUnit(undefined);
    this.warship.touch();
  }

  // A raid (PR5, PR15, PR16): the freighter is deleted where it stands and
  // the trading partners get nothing; the hold gains raidTroops up to the
  // cap and the pirate's purse a flat raidGold, counted as raid gold. The
  // victim's event names no one: pirates are anonymous at sea.
  private scuttle(target: Unit): void {
    const mg = this.mg;
    const cfg = mg.config().piracyConfig();
    const pirate = this.warship.owner();
    const victim = target.owner();
    const targetID = target.id();
    target.delete(false);

    const hold = Math.min(this.warship.troops() + cfg.raidTroops, cfg.holdCap);
    this.warship.setTroops(hold);
    const gold = BigInt(cfg.raidGold);
    pirate.addGold(gold);
    pirate.addPiracyGold(gold);
    pirate.recordPirateRaid();
    mg.stats().boatCapturedTrade(pirate, victim, gold);

    mg.displayMessage(
      "events_display.freighter_raided",
      MessageType.UNIT_DESTROYED,
      victim.id(),
      undefined,
      undefined,
      targetID,
    );
    mg.displayMessage(
      "events_display.pirate_raid",
      MessageType.CAPTURED_ENEMY_UNIT,
      pirate.id(),
      gold,
      {
        name: victim.displayName(),
        gold: renderNumber(gold),
        troops: renderTroops(hold),
      },
      this.warship.id(),
    );
  }

  // The throne's destroyers are purely defensive (H10): they engage fleets
  // bound for the Dark Star (whoever sent them), warships that have entered
  // the moat, and pirates' corsairs anywhere. They never raid commerce
  // (revised 2026-10-25). Nothing else, ever.
  private hegemonMayEngage(unit: Unit, type: UnitType): boolean {
    const mg = this.mg;
    switch (type) {
      case UnitType.TransportShip: {
        const dst = unit.targetTile();
        return dst !== undefined && mg.isInDarkStar(dst);
      }
      case UnitType.Warship:
        return unit.owner().isPirate() || mg.isInMoat(unit.tile());
      default:
        return false;
    }
  }

  // The throne's destroyer is posted in the moat, its home: it patrols
  // there and goes to meet invasions.
  private stationedInMoat(): boolean {
    const patrolTile = this.warship.warshipState().patrolTile;
    return patrolTile !== undefined && this.mg.isInMoat(patrolTile);
  }

  // With nothing in range, sail along the moat towards the landing point of
  // the nearest fleet bound for the Dark Star. False when there is none.
  private intercept(): boolean {
    const mg = this.mg;
    let best: Unit | null = null;
    let bestDist = Infinity;
    for (const fleet of mg.units(UnitType.TransportShip)) {
      const dst = fleet.targetTile();
      if (!fleet.isActive() || dst === undefined || !mg.isInDarkStar(dst)) {
        continue;
      }
      const d = mg.euclideanDistSquared(this.warship.tile(), fleet.tile());
      // Ties go to the lower id: iteration order must not decide it.
      if (d < bestDist || (d === bestDist && fleet.id() < best!.id())) {
        best = fleet;
        bestDist = d;
      }
    }
    if (best === null) return false;
    const station = this.moatTileToward(best.targetTile()!);
    if (station === undefined || station === this.warship.tile()) {
      return false;
    }
    this.warship.setTargetTile(station);
    this.patrol();
    return true;
  }

  // The moat tile on the ray from the Dark Star's centre through `tile`,
  // on the ring's midline; nudged outward to the nearest moat water when
  // the rounding lands on land. One exactly-rounded square root and
  // division, so every client agrees.
  private moatTileToward(tile: TileRef): TileRef | undefined {
    const mg = this.mg;
    const g = mg.darkStar();
    if (g === null) return undefined;
    const dx = mg.x(tile) - g.cx;
    const dy = mg.y(tile) - g.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return undefined;
    const r = g.radius + g.moatWidth / 2;
    const x = g.cx + Math.round((dx * r) / dist);
    const y = g.cy + Math.round((dy * r) / dist);
    for (let ring = 0; ring <= g.moatWidth; ring++) {
      for (let ox = -ring; ox <= ring; ox++) {
        for (let oy = -ring; oy <= ring; oy++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== ring) continue;
          if (!mg.isValidCoord(x + ox, y + oy)) continue;
          const t = mg.ref(x + ox, y + oy);
          if (mg.isInMoat(t)) return t;
        }
      }
    }
    return undefined;
  }

  private bestNeighborToward(targetTile: TileRef): TileRef | undefined {
    const warshipTile = this.warship.tile();
    let best: TileRef | undefined;
    let bestDist = this.mg.manhattanDist(warshipTile, targetTile);
    this.mg.forEachNeighbor(warshipTile, (neighbor) => {
      if (!this.mg.isWater(neighbor)) return;
      const d = this.mg.manhattanDist(neighbor, targetTile);
      if (d < bestDist) {
        bestDist = d;
        best = neighbor;
      }
    });
    return best;
  }

  private patrol() {
    // A corsair always sails at the chase's pace, two steps a tick (Tom,
    // 2026-10-15); a destroyer patrols at one.
    const steps = this.pirate ? 2 : 1;
    for (let i = 0; i < steps; i++) {
      if (!this.patrolStep()) return;
    }
  }

  // One step of the patrol; false when there is nothing more to do this tick.
  private patrolStep(): boolean {
    if (this.warship.targetTile() === undefined) {
      this.warship.setTargetTile(this.randomTile());
      if (this.warship.targetTile() === undefined) {
        return false;
      }
    }

    const result = this.pathfinder.next(
      this.warship.tile(),
      this.warship.targetTile()!,
    );
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.warship.setTargetTile(undefined);
        this.warship.move(result.node);
        return false;
      case PathStatus.NEXT:
        this.warship.move(result.node);
        return true;
      case PathStatus.NOT_FOUND: {
        console.log(`path not found to target`);
        this.warship.setTargetTile(undefined);
        return false;
      }
    }
  }

  isActive(): boolean {
    return this.warship?.isActive();
  }

  isDocked(): boolean {
    return (this.warship?.warshipState().state ?? "patrolling") === "docked";
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  randomTile(allowShoreline: boolean = false): TileRef | undefined {
    let warshipPatrolRange = this.mg.config().warshipPatrolRange();
    const maxAttemptBeforeExpand: number = 500;
    let attempts: number = 0;
    let expandCount: number = 0;

    // Get warship's water component for connectivity check
    const warshipComponent = this.mg.getWaterComponent(this.warship.tile());

    const patrolTile = this.warship.warshipState().patrolTile;
    // A non-integer or out-of-range patrolTile makes mg.x()/mg.y() return
    // undefined, so every candidate coordinate below is NaN, isValidCoord is
    // always false, and the loop's out-of-bounds `continue` (which does not
    // advance expandCount) spins forever, hanging the whole synchronous sim.
    // Bail out instead of trusting patrolTile is a valid tile.
    if (patrolTile === undefined || !this.mg.isValidRef(patrolTile)) {
      return undefined;
    }

    while (expandCount < 3) {
      const x =
        this.mg.x(patrolTile) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      const y =
        this.mg.y(patrolTile) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (
        !this.mg.isWater(tile) ||
        (!allowShoreline && this.mg.isShoreline(tile)) ||
        // A throne's destroyer posted in the moat patrols the moat (H10).
        (this.hegemon &&
          this.mg.isInMoat(patrolTile) &&
          !this.mg.isInMoat(tile))
      ) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          warshipPatrolRange =
            warshipPatrolRange + Math.floor(warshipPatrolRange / 2);
        }
        continue;
      }
      // Check water component connectivity
      if (
        warshipComponent !== null &&
        !this.mg.hasWaterComponent(tile, warshipComponent)
      ) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          warshipPatrolRange =
            warshipPatrolRange + Math.floor(warshipPatrolRange / 2);
        }
        continue;
      }
      return tile;
    }
    console.warn(
      `Failed to find random tile for warship for ${this.warship.owner().name()}`,
    );
    if (!allowShoreline) {
      // If we failed to find a tile on the ocean, try again but allow shoreline
      return this.randomTile(true);
    }
    return undefined;
  }
}
