import { Game, Player, Unit, UnitType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { canBuildTransportShip } from "../../game/TransportShipUtils";
import { AttackExecution } from "../AttackExecution";
import { GateShotExecution } from "../GateShotExecution";
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
// The invasion goes by stargate when it can (C4, §6.8 stage 5): a ready gate
// whose range reaches the domain's rim fires the same share of the army the
// fleet would carry, skipping the moat; the fleet is the fallback. While it
// holds the slot the nation pushes by land only — it never stacks a second
// shot on its own foothold.
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

    if (!this.wantsThrone() || this.invasionUnderWay()) {
      return false;
    }
    const troops = Math.floor(
      (this.player.troops() * cfg.aiInvasionSendPercent) / 100,
    );
    if (troops < 1) return false;

    // Gate first: no moat to cross, no boat to sink.
    const aim = this.readyGateAimAtDomain();
    if (aim !== null) {
      this.game.addExecution(
        new GateShotExecution(this.player, aim.tile, troops),
      );
      return true;
    }

    if (
      this.game.config().isUnitDisabled(UnitType.TransportShip) ||
      this.player.unitCount(UnitType.TransportShip) >=
        this.game.config().boatMaxNumber()
    ) {
      return false;
    }
    const landing = this.landingTile(hegemon);
    if (landing === null) return false;
    this.game.addExecution(
      new TransportShipExecution(this.player, landing, troops),
    );
    return true;
  }

  // The nation would go for the throne now: the slot is free for it and its
  // troops reach the bar. Asked by the structure behaviour too, which builds
  // or upgrades a gate towards the moat while this holds.
  wantsThrone(): boolean {
    const hegemon = this.game.hegemon();
    if (hegemon === null || !hegemon.isAlive() || hegemon === this.player) {
      return false;
    }
    return (
      this.game.canInvadeDarkStar(this.player) &&
      this.player.troops() * 100 >= hegemon.troops() * this.requiredPercent()
    );
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

  // A fleet or a gate shot of ours already bound for the Dark Star.
  private invasionUnderWay(): boolean {
    const fleet = this.player.units(UnitType.TransportShip).some((boat) => {
      const target = boat.targetTile();
      return target !== undefined && this.game.isInDarkStar(target);
    });
    if (fleet) return true;
    return this.game
      .gateShotsInFlight()
      .some(
        (shot) =>
          shot.owner() === this.player &&
          this.game.isInDarkStar(shot.targetTile()),
      );
  }

  // The domain tile a gate would aim at: the rim where the line from the gate
  // to the Dark Star's centre enters the disc (the domain is solid, so it is
  // land). Null only if the gate sits at the centre.
  rimTileToward(from: TileRef): TileRef | null {
    const g = this.game.darkStar();
    if (g === null) return null;
    const dx = this.game.x(from) - g.cx;
    const dy = this.game.y(from) - g.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return null;
    for (let r = g.radius - 1; r >= 0; r--) {
      const x = g.cx + Math.round((dx * r) / dist);
      const y = g.cy + Math.round((dy * r) / dist);
      if (!this.game.isValidCoord(x, y)) continue;
      const tile = this.game.ref(x, y);
      if (this.game.isInDarkStar(tile) && this.game.isLand(tile)) return tile;
    }
    return null;
  }

  // Our built gates with the rim tile each would aim at and how far short of
  // it the gate's range falls (0 or less: in range).
  gateReaches(): { gate: Unit; tile: TileRef; shortfall: number }[] {
    const out: { gate: Unit; tile: TileRef; shortfall: number }[] = [];
    if (this.game.darkStar() === null) return out;
    for (const gate of this.player.units(UnitType.Stargate)) {
      if (!gate.isActive() || gate.isUnderConstruction()) continue;
      const tile = this.rimTileToward(gate.tile());
      if (tile === null) continue;
      const range = this.game.config().stargateRange(gate.level());
      const dist = Math.sqrt(this.game.euclideanDistSquared(gate.tile(), tile));
      out.push({ gate, tile, shortfall: dist - range });
    }
    return out;
  }

  // A rim tile that a READY gate of ours can reach right now.
  private readyGateAimAtDomain(): { gate: Unit; tile: TileRef } | null {
    for (const reach of this.gateReaches()) {
      if (reach.shortfall > 0) continue;
      const option = this.player.stargateFor(reach.tile);
      if (option !== null && option.readyInTicks === 0) {
        return { gate: reach.gate, tile: reach.tile };
      }
    }
    return null;
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
