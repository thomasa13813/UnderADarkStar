import { renderNumber, renderTroops } from "../../client/Utils";
import {
  Game,
  Gold,
  MessageType,
  Player,
  TrajectoryTile,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { GameUpdateType } from "../game/GameUpdates";
import { UniversalPathFinding } from "../pathfinding/PathFinder";
import { ParabolaUniversalPathFinder } from "../pathfinding/PathFinder.Parabola";
import { PathStatus } from "../pathfinding/types";

// What a transfer brought on landing: what the recipient got (zero when it
// failed and everything went home).
export interface TransferLanding {
  troops: number;
  gold: Gold;
}

// A transfer of troops or gold through the gate network, in flight (GN2,
// revised 2026-10-28; docs/DarkStar-Rework.md §5). Under a Dark Star a
// transfer is no longer instant: it leaves the sender at launch as a
// Projectile on the strike's arc, from the sender's gate nearest the
// recipient (the throne's from the Dark Star's centre) to the recipient's
// tile nearest that gate, and lands only on impact. If the aimed tile changes
// hands at any point in the flight (even if the recipient takes it back), or
// the recipient is gone, the cargo goes home whole on impact. Troops beyond the recipient's room go home too. Nothing
// spends a gate's charge (GN2) and the donation cooldown starts at launch
// (GN6). If the sender dies in flight the cargo is lost with it.
export class TransferFlight {
  private shot: Unit | null;
  // The aimed tile has been someone else's at some tick of the flight.
  private changedHands = false;
  private readonly pathFinder: ParabolaUniversalPathFinder;

  private constructor(
    private readonly mg: Game,
    private readonly sender: Player,
    private readonly recipient: Player,
    private readonly from: TileRef,
    private readonly target: TileRef,
    troops: number,
    private readonly gold: Gold,
    ticks: number,
  ) {
    const speed = mg.config().hegemonConfig().strikeSpeed;
    this.pathFinder = UniversalPathFinding.Parabola(mg, { increment: speed });
    const replay = UniversalPathFinding.Parabola(mg, { increment: speed });
    const path: TileRef[] = [from];
    let result = replay.next(from, target, speed);
    while (result.status === PathStatus.NEXT) {
      path.push(result.node);
      result = replay.next(from, target, speed);
    }
    const trajectory: TrajectoryTile[] = (
      this.pathFinder.findPath(from, target) ?? []
    ).map((tile) => ({ tile, targetable: false }));
    // buildUnit takes the troops from the sender: they ride on the unit.
    this.shot = sender.buildUnit(UnitType.Projectile, from, {
      targetTile: target,
      trajectory,
      troops,
      transfer: true,
    });
    mg.recordMotionPlan({
      kind: "grid",
      unitId: this.shot.id(),
      planId: 1,
      startTick: ticks + 1,
      ticksPerStep: 1,
      path,
    });
  }

  // Launches the cargo, or returns null (nothing taken) when there is no
  // route or nothing to send. The caller has checked canDonate*.
  static launch(
    mg: Game,
    sender: Player,
    recipient: Player,
    troops: number,
    gold: Gold,
    ticks: number,
  ): TransferFlight | null {
    const route = TransferFlight.route(mg, sender, recipient);
    if (route === null) return null;
    troops = Math.min(Math.floor(troops), sender.troops());
    if (troops < 0) troops = 0;
    if (gold > sender.gold()) gold = sender.gold();
    if (gold < 0n) gold = 0n;
    if (troops < 1 && gold === 0n) return null;
    if (gold > 0n) sender.removeGold(gold);
    sender.recordDonation(recipient);
    return new TransferFlight(
      mg,
      sender,
      recipient,
      route.from,
      route.target,
      troops,
      gold,
      ticks,
    );
  }

  // Where it flies from and to. The throne fires from the Dark Star's
  // centre at the recipient's tile nearest it; anyone else from the gate,
  // and at the tile, of the nearest gate–tile pair (inGateReach has found
  // one within range). The nearest tile of a territory to a point outside
  // it lies on its border, so the border is enough. Reinforcements for the
  // throne land only on the Dark Star itself, never on an invasion pocket
  // the Hegemon holds outside the disc (2026-10-29).
  static route(
    mg: Game,
    sender: Player,
    recipient: Player,
  ): { from: TileRef; target: TileRef } | null {
    const origins: TileRef[] = [];
    if (sender.isHegemon()) {
      const g = mg.darkStar();
      if (g === null) return null;
      origins.push(mg.ref(g.cx, g.cy));
    } else {
      for (const gate of sender.units(UnitType.Stargate)) {
        if (!gate.isActive() || gate.isUnderConstruction()) continue;
        origins.push(gate.tile());
      }
    }
    const disc = recipient.isHegemon() ? mg.darkStar() : null;
    if (recipient.isHegemon() && disc === null) return null;
    let best: { from: TileRef; target: TileRef } | null = null;
    let bestDist = Infinity;
    for (const tile of recipient.borderTiles()) {
      if (disc !== null) {
        const dx = mg.x(tile) - disc.cx;
        const dy = mg.y(tile) - disc.cy;
        if (dx * dx + dy * dy > disc.rSq) continue;
      }
      for (const from of origins) {
        const dist = mg.euclideanDistSquared(from, tile);
        if (dist < bestDist) {
          bestDist = dist;
          best = { from, target: tile };
        }
      }
    }
    return best;
  }

  unitId(): number {
    return this.shot?.id() ?? -1;
  }

  targetTile(): TileRef {
    return this.target;
  }

  // One tick of flight: null while flying, what landed once it has.
  tick(): TransferLanding | null {
    const shot = this.shot;
    if (shot === null) return { troops: 0, gold: 0n };
    if (!this.sender.isAlive()) {
      // Lost with the sender.
      this.vanish();
      return { troops: 0, gold: 0n };
    }
    if (!shot.isActive()) {
      // Removed by something else: the cargo comes home.
      this.shot = null;
      this.returnHome(shot.troops());
      return { troops: 0, gold: 0n };
    }
    if (this.mg.owner(this.target) !== this.recipient) {
      this.changedHands = true;
    }
    const speed = this.mg.config().hegemonConfig().strikeSpeed;
    const result = this.pathFinder.next(this.from, this.target, speed);
    if (result.status === PathStatus.NEXT) {
      shot.move(result.node);
      shot.setTrajectoryIndex(this.pathFinder.currentIndex());
      return null;
    }
    return this.land(shot);
  }

  private land(shot: Unit): TransferLanding {
    const carried = shot.troops();
    shot.move(this.target);
    shot.setReachedTarget();
    shot.delete(false);
    this.shot = null;

    const recipient = this.recipient;
    if (
      this.changedHands ||
      !recipient.isAlive() ||
      this.mg.owner(this.target) !== recipient
    ) {
      this.returnHome(carried, true);
      return { troops: 0, gold: 0n };
    }
    // Troops only up to the recipient's room; the rest go home.
    const room = Math.max(
      0,
      Math.floor(this.mg.config().maxTroops(recipient) - recipient.troops()),
    );
    const troops = Math.min(carried, room);
    if (troops > 0) {
      recipient.addTroops(troops);
      this.announce("troops", BigInt(troops));
    }
    if (this.gold > 0n) {
      recipient.addGold(this.gold);
      this.announce("gold", this.gold);
    }
    if (carried > troops && this.sender.isAlive()) {
      this.sender.addTroops(carried - troops);
    }
    return { troops, gold: this.gold };
  }

  private announce(donationType: "troops" | "gold", amount: bigint): void {
    this.mg.addUpdate({
      type: GameUpdateType.DonateEvent,
      donationType,
      senderId: this.sender.id(),
      recipientId: this.recipient.id(),
      amount,
    });
  }

  // The whole cargo back to the sender, with word of why when it missed.
  private returnHome(troops: number, missed = false): void {
    if (!this.sender.isAlive()) return;
    if (troops > 0) this.sender.addTroops(troops);
    if (this.gold > 0n) this.sender.refundGold(this.gold);
    if (!missed) return;
    const name = this.recipient.displayName();
    if (troops > 0) {
      this.mg.displayMessage(
        "events_display.transfer_returned_troops",
        MessageType.DONATION_SENT,
        this.sender.id(),
        undefined,
        { name, troops: renderTroops(troops) },
      );
    }
    if (this.gold > 0n) {
      this.mg.displayMessage(
        "events_display.transfer_returned_gold",
        MessageType.DONATION_SENT,
        this.sender.id(),
        undefined,
        { name, gold: renderNumber(this.gold) },
      );
    }
  }

  private vanish(): void {
    if (this.shot !== null && this.shot.isActive()) this.shot.delete(false);
    this.shot = null;
  }
}
