import { renderTroops } from "../../client/Utils";
import {
  Attack,
  Execution,
  Game,
  MessageType,
  OwnerComp,
  Player,
  Unit,
  UnitParams,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { BucketQueue } from "../pathfinding/algorithms/PriorityQueue";
import { PseudoRandom } from "../PseudoRandom";

// The most tiles a path search over the owner's nebula may settle: only a
// goal it cannot reach, or one behind a long detour, costs this much.
const MAX_PATH_SEARCH = 200_000;
// Ticks an army rests at a patrol stop before choosing the next.
const PATROL_REST_MIN = 20;
const PATROL_REST_MAX = 60;

// An army (Tom, 2026-10-23; ARMY_DEFAULTS in Config.ts): a defensive land unit
// supported by an industrial zone. It walks only on its owner's nebula,
// patrols around its patrol tile like a destroyer in deep space, and fires an
// ArmyShotExecution at the nearest front of an attack on its owner. It never
// attacks and has no health: it dies when the tile under it changes hands, or
// to a warhead.
export class ArmyExecution implements Execution {
  private army: Unit | null = null;
  private mg: Game;
  private random: PseudoRandom;
  private path: TileRef[] = [];
  private pathGoal: TileRef | null = null;
  private nextMoveTick = 0;
  private lastShotTick = -Infinity;
  private lastObservedPatrolTile: TileRef | undefined;

  // `payer` is who is charged: the Hegemon, for an army it donates (Tom,
  // 2026-10-25), at the flat first-army price.
  constructor(
    private input: UnitParams<UnitType.Army> & OwnerComp,
    private payer: Player = input.owner,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    const owner = this.input.owner;
    const spawn = owner.canBuild(
      UnitType.Army,
      this.input.patrolTile,
      null,
      this.payer,
    );
    if (spawn === false) {
      console.warn(
        `Failed to deploy army for ${owner.name()} at ${this.input.patrolTile}`,
      );
      return;
    }
    this.army = owner.buildUnit(
      UnitType.Army,
      spawn,
      { patrolTile: this.input.patrolTile },
      this.payer,
    );
    if (this.payer !== owner) {
      mg.displayMessage(
        "events_display.dark_star_gift_army",
        MessageType.DONATION_RECEIVED,
        owner.id(),
        undefined,
        undefined,
        this.army.id(),
      );
    }
    this.random = new PseudoRandom(ticks + this.army.id());
    this.lastObservedPatrolTile = this.input.patrolTile;
  }

  tick(ticks: number): void {
    const army = this.army;
    if (army === null) return;
    if (!army.isActive()) {
      this.army = null;
      return;
    }
    const owner = army.owner();
    // Like a structure's tile, but nobody captures an army: it is lost.
    if (this.mg.owner(army.tile()) !== owner) {
      army.delete();
      this.army = null;
      return;
    }
    this.maybeShoot(army, owner, ticks);
    this.patrol(army, owner, ticks);
  }

  private maybeShoot(army: Unit, owner: Player, ticks: number): void {
    const cfg = this.mg.config().armyConfig();
    if (ticks - this.lastShotTick < cfg.shotCooldownSeconds * 10) return;
    const rangeSq = cfg.shotRange * cfg.shotRange;
    let bestTile: TileRef | null = null;
    let bestAttack: Attack | null = null;
    let bestDist = Infinity;
    for (const attack of owner.incomingAttacks()) {
      if (!attack.isActive() || attack.retreating()) continue;
      const front: Iterable<TileRef> =
        attack.borderTiles().size > 0
          ? attack.borderTiles()
          : attack.clusteredPositions();
      for (const tile of front) {
        const d = this.mg.euclideanDistSquared(army.tile(), tile);
        if (
          d <= rangeSq &&
          (d < bestDist || (d === bestDist && tile < bestTile!))
        ) {
          bestDist = d;
          bestTile = tile;
          bestAttack = attack;
        }
      }
    }
    if (bestTile === null || bestAttack === null) return;
    this.lastShotTick = ticks;
    this.mg.addExecution(
      new ArmyShotExecution(
        owner,
        army.tile(),
        bestTile,
        bestAttack,
        army.id(),
      ),
    );
  }

  private patrol(army: Unit, owner: Player, ticks: number): void {
    const patrolTile = army.warshipState().patrolTile ?? army.tile();
    // A new order (MoveWarshipExecution) clears the target tile: head there.
    if (patrolTile !== this.lastObservedPatrolTile) {
      this.lastObservedPatrolTile = patrolTile;
      this.path = [];
      this.pathGoal = null;
      army.setTargetTile(undefined);
      // An order cuts any rest short: it sets out this tick.
      this.nextMoveTick = ticks;
    }
    if (ticks < this.nextMoveTick) return;
    const cfg = this.mg.config().armyConfig();

    if (army.targetTile() === undefined) {
      const goal = this.chooseGoal(army, owner, patrolTile, cfg.patrolRange);
      if (goal === null) {
        this.nextMoveTick = ticks + PATROL_REST_MAX;
        return;
      }
      army.setTargetTile(goal);
    }
    const goal = army.targetTile()!;
    if (this.pathGoal !== goal || this.path.length === 0) {
      this.path = this.findPath(army.tile(), goal, owner);
      this.pathGoal = goal;
      if (this.path.length === 0) {
        // Unreachable through our own nebula: choose again after a rest.
        army.setTargetTile(undefined);
        this.nextMoveTick = ticks + PATROL_REST_MAX;
        return;
      }
    }
    const next = this.path.shift()!;
    if (this.mg.owner(next) !== owner) {
      // The way was cut: plan again next step.
      this.path = [];
      this.nextMoveTick = ticks + cfg.moveTicksPerTile;
      return;
    }
    army.move(next);
    this.nextMoveTick = ticks + cfg.moveTicksPerTile;
    if (next === goal) {
      army.setTargetTile(undefined);
      this.path = [];
      this.nextMoveTick =
        ticks + this.random.nextInt(PATROL_REST_MIN, PATROL_REST_MAX + 1);
    }
  }

  // Far from its patrol tile it heads there; near it, it wanders to a random
  // tile of its owner's nebula within the patrol range.
  private chooseGoal(
    army: Unit,
    owner: Player,
    patrolTile: TileRef,
    range: number,
  ): TileRef | null {
    const mg = this.mg;
    if (mg.manhattanDist(army.tile(), patrolTile) > range) {
      return mg.owner(patrolTile) === owner && !mg.isInDarkStar(patrolTile)
        ? patrolTile
        : null;
    }
    const px = mg.x(patrolTile);
    const py = mg.y(patrolTile);
    for (let i = 0; i < 20; i++) {
      const x = px + this.random.nextInt(-range, range + 1);
      const y = py + this.random.nextInt(-range, range + 1);
      if (!mg.isValidCoord(x, y)) continue;
      const tile = mg.ref(x, y);
      if (
        tile !== army.tile() &&
        mg.isLand(tile) &&
        mg.owner(tile) === owner &&
        !mg.isInDarkStar(tile) &&
        mg.manhattanDist(tile, patrolTile) <= range
      ) {
        return tile;
      }
    }
    return null;
  }

  // A* over the owner's nebula (8-connected, a step costs 1, so the
  // Chebyshev distance is exact in the open), never into the Dark Star; the
  // path excludes the start and ends at the goal, or is empty. Heading for
  // the goal keeps a long order across a large realm cheap, where a flood
  // from the army gave up about a hundred tiles out (Tom, 2026-10-25).
  private findPath(from: TileRef, goal: TileRef, owner: Player): TileRef[] {
    const mg = this.mg;
    if (from === goal) return [];
    const gx = mg.x(goal);
    const gy = mg.y(goal);
    const h = (t: TileRef) =>
      Math.max(Math.abs(mg.x(t) - gx), Math.abs(mg.y(t) - gy));
    const queue = new BucketQueue(2 * (mg.width() + mg.height()));
    const g = new Map<TileRef, number>([[from, 0]]);
    const prev = new Map<TileRef, TileRef>();
    const closed = new Set<TileRef>();
    queue.push(from, h(from));
    while (!queue.isEmpty() && closed.size < MAX_PATH_SEARCH) {
      const tile = queue.pop();
      if (closed.has(tile)) continue;
      closed.add(tile);
      if (tile === goal) {
        const path: TileRef[] = [];
        for (let t = goal; t !== from; t = prev.get(t)!) path.push(t);
        return path.reverse();
      }
      const next = g.get(tile)! + 1;
      mg.forEachNeighborWithDiag(tile, (n) => {
        if (closed.has(n)) return;
        if (!mg.isLand(n) || mg.owner(n) !== owner || mg.isInDarkStar(n)) {
          return;
        }
        const known = g.get(n);
        if (known !== undefined && known <= next) return;
        g.set(n, next);
        prev.set(n, tile);
        queue.push(n, next + h(n));
      });
    }
    return [];
  }

  isActive(): boolean {
    return this.army !== null && this.army.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

// An army's shot: a shell that flies a straight line over the map to the
// front of an attack and, if the attack still stands when it lands, kills
// ARMY_DEFAULTS.casualtyPercent of its troops.
export class ArmyShotExecution implements Execution {
  private shell: Unit | null = null;
  private line: TileRef[] = [];
  private step = 0;
  private done = false;

  constructor(
    private owner: Player,
    private from: TileRef,
    private target: TileRef,
    private attack: Attack,
    private armyID: number,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
    this.line = straightLine(mg, this.from, this.target);
    this.shell = this.owner.buildUnit(UnitType.Shell, this.from, {});
  }

  private mg: Game;

  tick(_ticks: number): void {
    if (this.done || this.shell === null) return;
    // The shell can go before it lands (its owner eliminated, a warhead);
    // the shot goes with it.
    if (!this.shell.isActive()) {
      this.done = true;
      return;
    }
    const speed = this.mg.config().armyConfig().shotSpeed;
    this.step = Math.min(this.line.length - 1, this.step + speed);
    this.shell.move(this.line[this.step]);
    if (this.step < this.line.length - 1) return;
    this.done = true;
    this.shell.delete(false);
    const attack = this.attack;
    if (!attack.isActive() || attack.retreating()) return;
    const percent = this.mg.config().armyConfig().casualtyPercent;
    const deaths = Math.floor((attack.troops() * percent) / 100);
    if (deaths <= 0) return;
    attack.setTroops(attack.troops() - deaths);
    // The newsfeed: the army's owner hears what it killed, the attacker what
    // it lost.
    const troops = renderTroops(deaths);
    this.mg.displayMessage(
      "events_display.army_hit",
      MessageType.SAM_HIT,
      this.owner.id(),
      undefined,
      { troops, name: attack.attacker().displayName() },
      this.armyID,
    );
    this.mg.displayMessage(
      "events_display.army_hit_taken",
      MessageType.UNIT_DESTROYED,
      attack.attacker().id(),
      undefined,
      { troops, name: this.owner.displayName() },
    );
  }

  isActive(): boolean {
    return !this.done;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

// The 8-connected Bresenham line from a to b, both ends included.
function straightLine(mg: Game, a: TileRef, b: TileRef): TileRef[] {
  let x0 = mg.x(a);
  let y0 = mg.y(a);
  const x1 = mg.x(b);
  const y1 = mg.y(b);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const out: TileRef[] = [];
  for (;;) {
    out.push(mg.ref(x0, y0));
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return out;
}
