import { Game, Player, UnitType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { canBuildTransportShip } from "../../game/TransportShipUtils";
import { AttackExecution } from "../AttackExecution";
import { TransportShipExecution } from "../TransportShipExecution";
import { closestTwoTiles } from "../Util";

// Hegemon mode (docs/DarkStar-Design.md): the throne is the objective. Left to
// the ordinary attack behaviour a nation only ever lands on the Dark Star by
// accident (a random boat, or retaliation for a strike), with a fifth of its
// army. This makes the invasion a decision: when the nation is strong enough
// against the Hegemon's troops as they stand — a bar that falls as the round
// runs out — and the slot is free (H6, H12), it sends most of its army, and
// while it holds the slot it keeps pushing.
//
// Nations stay self-interested: nothing here helps another invader.
export class NationHegemonBehavior {
  constructor(
    private game: Game,
    private player: Player,
  ) {}

  // True if the nation acted against the Hegemon this turn, in which case it
  // leaves its other wars alone.
  considerInvasion(): boolean {
    const hegemon = this.game.hegemon();
    if (hegemon === null || !hegemon.isAlive() || hegemon === this.player) {
      return false;
    }
    const cfg = this.game.config().hegemonConfig();

    if (this.game.darkStarInvader() === this.player) {
      const reserve =
        (this.game.config().maxTroops(this.player) *
          cfg.aiInvasionReservePercent) /
        100;
      const troops = Math.floor(this.player.troops() - reserve);
      if (troops < 1) return false;
      this.game.addExecution(
        new AttackExecution(troops, this.player, hegemon.id()),
      );
      return true;
    }

    if (
      !this.game.canInvadeDarkStar(this.player) ||
      this.player.troops() * 100 < hegemon.troops() * this.requiredPercent() ||
      this.game.config().isUnitDisabled(UnitType.TransportShip) ||
      this.player.unitCount(UnitType.TransportShip) >=
        this.game.config().boatMaxNumber() ||
      this.fleetUnderWay()
    ) {
      return false;
    }

    const landing = this.landingTile(hegemon);
    if (landing === null) return false;
    const troops = Math.floor(
      (this.player.troops() * cfg.aiInvasionSendPercent) / 100,
    );
    if (troops < 1) return false;
    this.game.addExecution(
      new TransportShipExecution(this.player, landing, troops),
    );
    return true;
  }

  // The share of the Hegemon's troops a nation wants before it goes.
  private requiredPercent(): number {
    const cfg = this.game.config().hegemonConfig();
    const roundSeconds =
      (this.game.config().gameConfig().maxTimerValue ??
        cfg.defaultRoundMinutes) * 60;
    const elapsed = Math.min(this.game.elapsedGameSeconds(), roundSeconds);
    return (
      cfg.aiInvadeTroopPercentAtStart -
      ((cfg.aiInvadeTroopPercentAtStart - cfg.aiInvadeTroopPercentAtEnd) *
        elapsed) /
        roundSeconds
    );
  }

  private fleetUnderWay(): boolean {
    return this.player.units(UnitType.TransportShip).some((boat) => {
      const target = boat.targetTile();
      return target !== undefined && this.game.isInDarkStar(target);
    });
  }

  private landingTile(hegemon: Player): TileRef | null {
    const closest = closestTwoTiles(
      this.game,
      this.shoreTiles(this.player),
      // Its whole rim: the moat surrounds it.
      this.shoreTiles(hegemon),
    );
    if (
      closest === null ||
      canBuildTransportShip(this.game, this.player, closest.y) === false
    ) {
      return null;
    }
    return closest.y;
  }

  private shoreTiles(player: Player): TileRef[] {
    const shore: TileRef[] = [];
    player.borderTiles().forEach((t) => {
      if (this.game.isShore(t)) shore.push(t);
    });
    return shore;
  }
}
