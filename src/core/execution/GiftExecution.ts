import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  Structures,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { ConstructionExecution } from "./ConstructionExecution";
import { UpgradeStructureExecution } from "./UpgradeStructureExecution";

// A gift (H18, docs/DarkStar-Design.md): the Hegemon places any structure a
// challenger could build on that challenger's tile, or upgrades the one that
// is already there, paying from its own gold. The structure is the host's
// from the start, exactly as if they had built it — the placement goes
// through the host's own rules (`canBuild` / `canUpgradeUnit`) with the
// Hegemon as payer, so nothing can be gifted that the host could not build
// (never on the Dark Star, H2). The host cannot refuse.
export class GiftExecution implements Execution {
  private active = true;
  private mg: Game;
  private host: Player | null = null;

  constructor(
    private hegemon: Player,
    private hostID: PlayerID,
    private unitType: UnitType,
    private tile: TileRef,
    private amount?: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!this.hegemon.isHegemon()) {
      console.warn(`${this.hegemon.name()} is not the Hegemon: no gifts`);
      this.active = false;
      return;
    }
    if (!Structures.has(this.unitType)) {
      console.warn(`cannot gift ${this.unitType}: not a structure`);
      this.active = false;
      return;
    }
    if (!mg.isValidRef(this.tile)) {
      console.warn(`cannot gift on invalid tile ${this.tile}`);
      this.active = false;
      return;
    }
    if (!mg.hasPlayer(this.hostID)) {
      console.warn(`cannot gift: no host ${this.hostID}`);
      this.active = false;
      return;
    }
    this.host = mg.player(this.hostID);
  }

  // The work happens on the first tick: executions added from init() are
  // dropped by the runner.
  tick(ticks: number): void {
    this.active = false;
    const mg = this.mg;
    const host = this.host;
    if (host === null) return;
    if (host.isHegemon() || !host.isAlive()) {
      console.warn(`cannot gift to ${host.name()}`);
      return;
    }
    if (mg.owner(this.tile) !== host) {
      // The tile changed hands in flight (or was never the host's): the
      // Hegemon aimed at this host, so nobody else gets the gift.
      mg.displayMessage(
        "events_display.dark_star_gift_refused",
        MessageType.ATTACK_FAILED,
        this.hegemon.id(),
      );
      return;
    }

    const existing = host.findUnitToUpgrade(
      this.unitType,
      this.tile,
      this.hegemon,
    );
    if (existing !== false) {
      if (!host.canUpgradeUnit(existing, this.hegemon)) {
        console.warn(`cannot gift an upgrade of ${this.unitType}`);
        return;
      }
      mg.addExecution(
        new UpgradeStructureExecution(
          host,
          existing.id(),
          this.amount ?? 1,
          this.hegemon,
        ),
      );
      return;
    }

    if (host.canBuild(this.unitType, this.tile, null, this.hegemon) === false) {
      console.warn(`cannot gift ${this.unitType} to ${host.name()}`);
      return;
    }
    mg.addExecution(
      new ConstructionExecution(
        host,
        this.unitType,
        this.tile,
        undefined,
        undefined,
        this.hegemon,
      ),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
