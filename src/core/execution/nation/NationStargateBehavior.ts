import {
  Difficulty,
  Game,
  GameMode,
  Player,
  TerraNullius,
  Unit,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { assertNever, calculateBoundingBox } from "../../Util";
import { GateShotExecution } from "../GateShotExecution";
import { nearestTileDistCapped } from "../Util";
import { AiAttackBehavior } from "../utils/AiAttackBehavior";
import { randTerritoryTileArray } from "./NationUtils";

// Stargate shots at anything but the throne (C4, docs/DarkStar-Design.md
// §6.8 stage 5; the throne is NationHegemonBehavior's). A gate is the
// nation's port and its way past a front: with a ready gate it fires, in this
// order, at
//   1. an enemy it has no land border with (across water, or beyond someone
//      else) — the nearest of its tiles in range;
//   2. neutral land across water, when it has none to walk into;
//   3. a land neighbour's far side — a tile well away from our border, so the
//      beachhead opens a second front rather than reinforcing the first.
// Never at a friend or its own land (the execution refuses those too), never
// with a gate that is reloading, and never a second shot at a player whose
// land it is already fighting on from a landing. One shot a turn, sized like
// a boat landing under the difficulty's caps (AiAttackBehavior).
/** Tiles of a target sampled per candidate when looking for a landing. */
const TARGET_SAMPLES = 25;
/** A far-side landing keeps at least this many tiles from our own border. */
const FAR_SIDE_MIN_DIST = 30;
/** Neutral land nearer than this to our border is reached on foot, not by gate. */
const NEUTRAL_MIN_DIST = 10;
/** Random tiles tried around each ready gate for neutral land. */
const NEUTRAL_TRIES = 60;

export class NationStargateBehavior {
  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private attackBehavior: AiAttackBehavior,
  ) {}

  // True if a shot was fired this turn, in which case the nation leaves its
  // other wars alone (as a random boat does).
  maybeFire(): boolean {
    if (this.game.darkStar() === null) return false;
    if (!this.eager()) return false;
    const gates = this.readyGates();
    if (gates.length === 0) return false;

    const landNeighbours = this.landNeighbours();
    const pick =
      this.pickEnemyBeyondLand(gates, landNeighbours) ??
      this.pickNeutralAcrossWater(gates) ??
      this.pickFarSide(gates, landNeighbours);
    if (pick === null) return false;

    const troops = this.attackBehavior.gateShotTroops(pick.owner);
    if (troops === null) return false;
    this.game.addExecution(
      new GateShotExecution(this.player, pick.tile, Math.floor(troops)),
    );
    return true;
  }

  // How often a nation with a ready gate looks for a target.
  private eager(): boolean {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return this.random.chance(4);
      case Difficulty.Medium:
        return this.random.chance(2);
      case Difficulty.Hard:
      case Difficulty.Impossible:
        return true;
      default:
        assertNever(difficulty);
    }
  }

  private readyGates(): Unit[] {
    const cooldown = this.game.config().stargateCooldown();
    const now = this.game.ticks();
    return this.player.units(UnitType.Stargate).filter((gate) => {
      if (!gate.isActive() || gate.isUnderConstruction()) return false;
      const firedAt = gate.missileTimerQueue()[0];
      return firedAt === undefined || now - firedAt >= cooldown;
    });
  }

  // A ready gate of ours covers the tile.
  private inRange(tile: TileRef): boolean {
    const option = this.player.stargateFor(tile);
    return option !== null && option.readyInTicks === 0;
  }

  // Players whose land touches ours (one border scan, as maybeAttack's).
  private landNeighbours(): Set<Player> {
    const out = new Set<Player>();
    const game = this.game;
    const smallID = this.player.smallID();
    const visit = (t: TileRef) => {
      if (!game.isLand(t)) return;
      const id = game.ownerID(t);
      if (id === smallID || !game.hasOwner(t)) return;
      const owner = game.playerBySmallID(id);
      if (owner.isPlayer()) out.add(owner);
    };
    this.player.borderTiles().forEach((t) => game.forEachNeighbor(t, visit));
    return out;
  }

  // Someone we may shoot at: alive, hostile, not the throne, not stronger
  // than us in FFA (the boat rule), and not already fighting one of our
  // landings — a shot in flight or an attack seeded from a landed tile.
  private canTarget(other: Player): boolean {
    if (
      other === this.player ||
      !other.isAlive() ||
      other.isHegemon() ||
      other.numTilesOwned() === 0 ||
      this.player.isFriendly(other) ||
      !this.player.canAttackPlayer(other)
    ) {
      return false;
    }
    if (
      this.game.config().gameConfig().gameMode === GameMode.FFA &&
      other.troops() > this.player.troops()
    ) {
      return false;
    }
    return !this.engaged(other);
  }

  private engaged(other: Player): boolean {
    if (
      this.player
        .outgoingAttacks()
        .some((a) => a.target() === other && a.sourceTile() !== null)
    ) {
      return true;
    }
    return this.game
      .gateShotsInFlight()
      .some(
        (shot) =>
          shot.owner() === this.player &&
          this.game.owner(shot.targetTile()) === other,
      );
  }

  // Cheap first cut: the nearest point of the player's main bounding box lies
  // within some ready gate's range.
  private nearAGate(other: Player, gates: Unit[]): boolean {
    const box =
      other.largestClusterBoundingBox ??
      calculateBoundingBox(this.game, other.borderTiles());
    const config = this.game.config();
    for (const gate of gates) {
      const range = config.stargateRange(gate.level());
      const gx = this.game.x(gate.tile());
      const gy = this.game.y(gate.tile());
      const dx = gx - Math.min(Math.max(gx, box.min.x), box.max.x);
      const dy = gy - Math.min(Math.max(gy, box.min.y), box.max.y);
      if (dx * dx + dy * dy <= range * range) return true;
    }
    return false;
  }

  // A sampled tile of the player's that a ready gate covers and that passes
  // the filter; the one nearest to its gate (the short hop, as a boat lands
  // on the near shore) unless `deepest` asks for the one farthest from us.
  private sampleTarget(
    other: Player,
    accept: (tile: TileRef) => boolean,
    deepest: boolean,
  ): TileRef | null {
    let best: TileRef | null = null;
    let bestScore = -Infinity;
    for (const tile of randTerritoryTileArray(
      this.random,
      this.game,
      other,
      TARGET_SAMPLES,
    )) {
      if (!this.game.isLand(tile) || this.game.hasFallout(tile)) continue;
      const option = this.player.stargateFor(tile);
      if (option === null || option.readyInTicks > 0) continue;
      if (!accept(tile)) continue;
      const fromGate = this.game.euclideanDistSquared(option.gateTile, tile);
      const score = deepest ? fromGate : -fromGate;
      if (score > bestScore) {
        best = tile;
        bestScore = score;
      }
    }
    return best;
  }

  private pickEnemyBeyondLand(
    gates: Unit[],
    landNeighbours: Set<Player>,
  ): { owner: Player; tile: TileRef } | null {
    const candidates = this.game
      .players()
      .filter(
        (p) =>
          !landNeighbours.has(p) &&
          this.canTarget(p) &&
          this.nearAGate(p, gates),
      )
      // Weakest first, as the land attack orders its neighbours.
      .sort((a, b) => a.troops() - b.troops());
    for (const owner of candidates) {
      const tile = this.sampleTarget(owner, () => true, false);
      if (tile !== null) return { owner, tile };
    }
    return null;
  }

  // Unowned land a ready gate covers that we cannot simply walk into: none
  // touches our land, and the tile is well clear of our border.
  private pickNeutralAcrossWater(
    gates: Unit[],
  ): { owner: TerraNullius; tile: TileRef } | null {
    const game = this.game;
    if (this.player.nearby().some((n) => !n.isPlayer())) return null;
    const border = this.player.borderTiles();
    for (const gate of gates) {
      const range = game.config().stargateRange(gate.level());
      const gx = game.x(gate.tile());
      const gy = game.y(gate.tile());
      for (let i = 0; i < NEUTRAL_TRIES; i++) {
        const x = this.random.nextInt(gx - range, gx + range + 1);
        const y = this.random.nextInt(gy - range, gy + range + 1);
        if (!game.isValidCoord(x, y)) continue;
        const tile = game.ref(x, y);
        if (
          !game.isLand(tile) ||
          game.isImpassable(tile) ||
          game.hasOwner(tile) ||
          game.hasFallout(tile) ||
          game.isInDarkStar(tile) ||
          !this.inRange(tile)
        ) {
          continue;
        }
        const fromUs = nearestTileDistCapped(
          game,
          border,
          tile,
          NEUTRAL_MIN_DIST,
        );
        if (fromUs < NEUTRAL_MIN_DIST) continue;
        return { owner: game.terraNullius(), tile };
      }
    }
    return null;
  }

  // A land neighbour's far side: a tile of theirs at least FAR_SIDE_MIN_DIST
  // from our border, the farthest from the gate among the samples.
  private pickFarSide(
    gates: Unit[],
    landNeighbours: Set<Player>,
  ): { owner: Player; tile: TileRef } | null {
    const border = this.player.borderTiles();
    const candidates = [...landNeighbours]
      .filter((p) => this.canTarget(p) && this.nearAGate(p, gates))
      .sort((a, b) => a.troops() - b.troops());
    for (const owner of candidates) {
      const tile = this.sampleTarget(
        owner,
        (t) =>
          nearestTileDistCapped(this.game, border, t, FAR_SIDE_MIN_DIST) >=
          FAR_SIDE_MIN_DIST,
        true,
      );
      if (tile !== null) return { owner, tile };
    }
    return null;
  }
}
