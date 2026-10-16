import { renderTroops } from "../../client/Utils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Structures,
  TerraNullius,
  Unit,
  UnitType,
} from "../game/Game";
import { manhattanDistFN, TileRef } from "../game/GameMap";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { AttackExecution } from "./AttackExecution";
import { PlayerExecution } from "./PlayerExecution";

// How far from the clicked tile the landing shore may be, as for a fleet
// (SpatialQuery.closestReachableShore).
const SHORE_SEARCH_DIST = 50;

// Piracy (docs/DarkStar-Piracy.md, PR4, PR7–PR9, PR12): the pirate clicks
// land; the corsair sails to the nearest shore of that nebula it can reach
// and beaches. The ship is consumed, the player claims `landingTiles` land
// tiles nearest the shore for free (neutral or the coast owner's, never a
// structure's tile, never the Hegemon's, never impassable), the hold lands
// as an ordinary attack from the claim, and the player is a challenger
// again in their own name: the pirate state is cleared and their
// PlayerExecution is added back, as a spawn adds it.
//
// Refused with a heads-up line: the last minute of the round (PR12); a
// coast with no reachable shore; the Hegemon's coast, domain or bubble, a
// teammate's, or a coast under spawn immunity (PR9); a rock with fewer than
// `landingTiles` claimable tiles (PR8). Cancelled, and the corsair patrols
// instead: a move order while sailing (PR4), the ship sunk or scuttled, a
// later landing order, or a coast that closed while the ship was at sea.
//
// The fleet's own shore resolution (targetTransportTile) reaches shores
// from the attacker's coastline, which a pirate does not have; the same
// rule is applied here from the corsair's body of space.
export class PirateLandingExecution implements Execution {
  private mg: Game;
  private active = true;
  private pathfinder: WaterPathFinder;
  private ship: Unit;
  private shore: TileRef;
  private orderedPatrolTile: TileRef | undefined;

  constructor(
    private readonly player: Player,
    private readonly tile: TileRef,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
    const player = this.player;
    const corsair = player.units(UnitType.Warship).find((u) => u.isActive());
    if (
      !mg.config().piracyConfig().enabled ||
      !player.isPirate() ||
      corsair === undefined ||
      !mg.isValidRef(this.tile) ||
      !mg.isLand(this.tile)
    ) {
      this.active = false;
      return;
    }
    if (this.landingsClosed()) {
      this.refuse("events_display.pirate_landing_closed");
      return;
    }
    const shore = this.resolveShore(corsair);
    if (shore === null) {
      this.refuse("events_display.pirate_landing_no_shore");
      return;
    }
    if (!this.coastOpen(shore)) {
      this.refuse("events_display.pirate_landing_forbidden");
      return;
    }
    if (this.claim(shore).length < mg.config().piracyConfig().landingTiles) {
      this.refuse("events_display.pirate_landing_too_small");
      return;
    }
    // The same order twice: the voyage under way is the voyage (two
    // executions would sail the ship at double speed).
    if (player.pirateLanding() === shore) {
      this.active = false;
      return;
    }
    this.ship = corsair;
    this.shore = shore;
    this.orderedPatrolTile = corsair.warshipState().patrolTile;
    this.pathfinder = new WaterPathFinder(mg);
    // A later landing order supersedes an earlier one: the earlier
    // execution sees the shore change and ends.
    player.setPirateLanding(shore);
    corsair.setTargetTile(shore);
  }

  tick(_ticks: number): void {
    if (!this.active) return;
    const player = this.player;
    if (player.pirateLanding() !== this.shore) {
      // Superseded, or already beached / cancelled elsewhere.
      this.active = false;
      return;
    }
    if (!this.ship.isActive() || !player.isPirate()) {
      this.cancel();
      return;
    }
    // A click on deep space while sailing cancels the landing (PR4).
    if (this.ship.warshipState().patrolTile !== this.orderedPatrolTile) {
      this.cancel();
      return;
    }
    // The corsair's pace: two steps a tick, as on patrol and in a chase.
    for (let i = 0; i < 2; i++) {
      const result = this.pathfinder.next(this.ship.tile(), this.shore);
      switch (result.status) {
        case PathStatus.NEXT:
          this.ship.move(result.node);
          break;
        case PathStatus.COMPLETE:
          this.beach();
          return;
        case PathStatus.NOT_FOUND:
          console.warn(`PirateLandingExecution: no path to the shore`);
          this.cancel();
          return;
      }
    }
  }

  // The corsair patrols where it is instead.
  private cancel(): void {
    this.active = false;
    this.player.setPirateLanding(undefined);
    if (this.ship.isActive()) {
      this.ship.setTargetTile(undefined);
    }
  }

  private refuse(message: string): void {
    this.active = false;
    this.mg.displayMessage(
      message,
      MessageType.ATTACK_FAILED,
      this.player.id(),
    );
  }

  // PR12: no landings in the round's final minute. Checked again at the
  // shore, so a voyage cannot carry a landing past the close.
  private landingsClosed(): boolean {
    const cfg = this.mg.config();
    const round = cfg.roundSeconds();
    if (round === null) return false;
    return (
      this.mg.elapsedGameSeconds() >=
      round - cfg.piracyConfig().landingClosesSeconds
    );
  }

  // The nearest shore of the clicked nebula (same owner as the click) on the
  // corsair's body of space, without a structure on it. Ties go to the lower
  // tile, so every client agrees.
  private resolveShore(corsair: Unit): TileRef | null {
    const mg = this.mg;
    const component = mg.getWaterComponent(corsair.tile());
    if (component === null) return null;
    const ownerID = mg.ownerID(this.tile);
    const structureTiles = this.structureTiles();
    let best: TileRef | null = null;
    let bestDist = Infinity;
    for (const t of mg.bfs(
      this.tile,
      manhattanDistFN(this.tile, SHORE_SEARCH_DIST),
    )) {
      if (!mg.isLand(t) || !mg.isShore(t) || mg.isImpassable(t)) continue;
      if (mg.ownerID(t) !== ownerID) continue;
      if (structureTiles.has(t)) continue;
      if (!mg.hasWaterComponent(t, component)) continue;
      const d = mg.manhattanDist(this.tile, t);
      if (d < bestDist || (d === bestDist && t < best!)) {
        best = t;
        bestDist = d;
      }
    }
    return best;
  }

  // PR9: any coast except the Hegemon's (domain or bubble), a teammate's,
  // or one under spawn immunity.
  private coastOpen(shore: TileRef): boolean {
    const mg = this.mg;
    if (mg.isInDarkStar(shore)) return false;
    const coast = mg.owner(shore);
    if (!coast.isPlayer()) return true;
    if (coast.isHegemon() || coast === this.player) return false;
    if (this.player.isFriendly(coast)) return false;
    return this.player.canAttackPlayer(coast);
  }

  private structureTiles(): Set<TileRef> {
    const tiles = new Set<TileRef>();
    for (const u of this.mg.units(Structures.types)) {
      if (u.isActive()) tiles.add(u.tile());
    }
    return tiles;
  }

  // PR8: the `landingTiles` land tiles nearest the shore by BFS, from neutral
  // nebula or the coast owner's tiles; never a structure's tile, never the
  // Hegemon's or the Dark Star's, never impassable. Fewer than that and the
  // landing is refused.
  private claim(shore: TileRef): TileRef[] {
    const mg = this.mg;
    const want = mg.config().piracyConfig().landingTiles;
    const coastID = mg.ownerID(shore);
    const neutralID = mg.terraNullius().smallID();
    const structureTiles = this.structureTiles();
    const claimable = (t: TileRef): boolean => {
      if (!mg.isLand(t) || mg.isImpassable(t) || mg.isInDarkStar(t)) {
        return false;
      }
      const id = mg.ownerID(t);
      if (id !== neutralID && id !== coastID) return false;
      if (structureTiles.has(t)) return false;
      return true;
    };
    const out: TileRef[] = [];
    if (!claimable(shore)) return out;
    const seen = new Set<TileRef>([shore]);
    const queue: TileRef[] = [shore];
    for (let i = 0; i < queue.length && out.length < want; i++) {
      const t = queue[i];
      out.push(t);
      mg.forEachNeighbor(t, (n) => {
        if (seen.has(n)) return;
        seen.add(n);
        if (claimable(n)) queue.push(n);
      });
    }
    return out;
  }

  // The landing (PR7): the claim, the hold's attack, the return.
  private beach(): void {
    const mg = this.mg;
    const player = this.player;
    const shore = this.shore;
    // The coast may have changed hands at sea: the rules are read again.
    if (this.landingsClosed() || !this.coastOpen(shore)) {
      this.cancel();
      return;
    }
    const claim = this.claim(shore);
    if (claim.length < mg.config().piracyConfig().landingTiles) {
      this.cancel();
      return;
    }
    const coast: Player | TerraNullius = mg.owner(shore);
    const hold = this.ship.troops();

    this.active = false;
    player.setPirateLanding(undefined);
    this.ship.delete(false);
    for (const t of claim) player.conquer(t);
    player.endPiracy();
    player.recordPirateLanding();
    // Back among the living: the spawn's own step.
    mg.addExecution(new PlayerExecution(player));
    if (hold > 0) {
      mg.addExecution(
        new AttackExecution(
          hold,
          player,
          coast.isPlayer() ? coast.id() : null,
          null,
          false,
        ),
      );
    }

    mg.displayMessage(
      "events_display.pirate_landed",
      MessageType.CONQUERED_PLAYER,
      player.id(),
      undefined,
      { tiles: claim.length, troops: renderTroops(hold) },
    );
    if (coast.isPlayer()) {
      mg.displayMessage(
        "events_display.pirate_landing",
        MessageType.NAVAL_INVASION_INBOUND,
        coast.id(),
        undefined,
        { name: player.displayName() },
        undefined,
        player.id(),
      );
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
