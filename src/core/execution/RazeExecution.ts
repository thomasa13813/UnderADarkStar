import { renderTroops } from "../../client/Utils";
import { AttackLogicInput } from "../configuration/Config";
import {
  Attack,
  Execution,
  Game,
  MessageType,
  Player,
  TerrainType,
  UnitType,
} from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { FlatBinaryHeap } from "./utils/FlatBinaryHeap";

const malusForRetreat = 25;

// A Hegemon strike (H8, docs/DarkStar-Design.md): land it takes is RAZED — it
// reverts to neutral, and whatever stood on it is destroyed (PlayerExecution
// deletes structures on unowned land).
//
// The Hegemon borders nobody (the moat), and razed tiles never become its own,
// so the engine's attack — which only advances over tiles next to the
// attacker's land — cannot do this. A strike falls directly on the tile it was
// aimed at after a flight time, and keeps its own frontier: it advances over
// the target's tiles next to tiles THIS strike has razed, whoever holds those
// now. Costs are the engine's normal attack costs, paid from the Hegemon's
// fixed pool (F6): every strike weakens the throne's defence.
//
// It ends when its troops are spent, the target has no land left within reach,
// or it is recalled; survivors return to the Hegemon.
export class RazeExecution implements Execution {
  private active = true;
  private mg: Game;
  private map: GameMap;
  private target: Player;
  private attack: Attack | null = null;
  private arrivalTick = 0;

  private razed = new Set<TileRef>();
  private toRaze = new FlatBinaryHeap();
  private random = new PseudoRandom(123);
  private targetSmallID: number;
  private nbuf: TileRef[] = [0, 0, 0, 0];
  private nbuf2: TileRef[] = [0, 0, 0, 0];

  constructor(
    private hegemon: Player,
    private ref: TileRef,
    private troops: number | null = null,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.map = mg.map();
    const geometry = mg.darkStar();
    if (
      geometry === null ||
      !this.hegemon.isHegemon() ||
      !mg.isValidRef(this.ref) ||
      // The Dark Star itself is defended by ordinary attacks on the invader.
      mg.isInDarkStar(this.ref)
    ) {
      this.active = false;
      return;
    }
    const owner = mg.owner(this.ref);
    if (
      !owner.isPlayer() ||
      owner === this.hegemon ||
      !this.hegemon.canAttackPlayer(owner)
    ) {
      this.active = false;
      return;
    }
    this.target = owner;
    this.targetSmallID = owner.smallID();

    this.troops ??= mg.config().attackAmount(this.hegemon, owner);
    this.troops = this.hegemon.removeTroops(
      Math.min(this.hegemon.troops(), this.troops),
    );
    if (this.troops < 1) {
      this.active = false;
      return;
    }

    const cfg = mg.config().hegemonConfig();
    const dx = mg.x(this.ref) - geometry.cx;
    const dy = mg.y(this.ref) - geometry.cy;
    const distance = Math.floor(Math.sqrt(dx * dx + dy * dy));
    this.arrivalTick =
      ticks +
      Math.max(
        cfg.razeTravelMinTicks,
        Math.floor((distance * cfg.razeTravelTicksPer100Tiles) / 100),
      );

    mg.displayMessage(
      "events_display.dark_star_strike_inbound",
      MessageType.NAVAL_INVASION_INBOUND,
      owner.id(),
      undefined,
      { troops: renderTroops(this.troops) },
    );
    mg.stats().attack(this.hegemon, owner, this.troops);
  }

  targetPlayer(): Player {
    return this.target;
  }

  // Bring the strike home now (the AI's recall; a human cancels the attack).
  recall(): void {
    if (!this.active) return;
    if (this.attack === null) {
      this.comeHome(this.troops ?? 0);
      return;
    }
    this.attack.orderRetreat();
    this.attack.executeRetreat();
  }

  tick(ticks: number): void {
    if (this.attack === null) {
      if (ticks < this.arrivalTick) return;
      this.land();
      return;
    }
    const attack = this.attack;
    if (attack.retreated()) {
      const deaths = attack.troops() * (malusForRetreat / 100);
      this.mg.displayMessage(
        "events_display.attack_cancelled_retreat",
        MessageType.ATTACK_CANCELLED,
        this.hegemon.id(),
        undefined,
        { troops: renderTroops(deaths) },
      );
      this.mg
        .stats()
        .attackCancel(this.hegemon, this.target, attack.troops() - deaths);
      this.comeHome(attack.troops() - deaths);
      return;
    }
    if (attack.retreating()) return;
    if (!attack.isActive()) {
      // Cancelled out by the target's own attack on the Hegemon.
      this.active = false;
      return;
    }

    let troopCount = attack.troops();
    const borderSize = attack.borderSize() + this.random.nextInt(0, 5);
    let tickBudget = 1;
    while (tickBudget > 0) {
      if (troopCount < 1) {
        attack.delete();
        this.active = false;
        return;
      }
      if (this.toRaze.size() === 0) {
        this.refreshFrontier();
        if (this.toRaze.size() === 0) {
          this.comeHome(troopCount);
          return;
        }
      }

      const tile = this.toRaze.dequeue();
      attack.removeBorderTile(tile);
      if (
        this.map.ownerID(tile) !== this.targetSmallID ||
        this.mg.isInDarkStar(tile) ||
        !(tile === this.ref || this.bordersRazed(tile))
      ) {
        continue;
      }

      const { attackerTroopLoss, defenderTroopLoss, tickFraction } = this.mg
        .config()
        .attackLogic(this.attackLogicInput(troopCount, tile, borderSize));
      tickBudget -= tickFraction;
      troopCount -= attackerTroopLoss;
      attack.setTroops(troopCount);
      this.target.removeTroops(defenderTroopLoss);
      this.target.relinquish(tile);
      this.razed.add(tile);
      this.addNeighbors(tile);
    }
  }

  private land(): void {
    const troops = this.troops ?? 0;
    if (
      this.mg.owner(this.ref) !== this.target ||
      !this.hegemon.canAttackPlayer(this.target)
    ) {
      // The tile changed hands in flight: nothing to strike.
      this.comeHome(troops);
      return;
    }
    this.attack = this.hegemon.createAttack(
      this.target,
      troops,
      this.ref,
      new Set<TileRef>(),
    );
    this.attack.addBorderTile(this.ref);
    this.toRaze.enqueue(this.ref, 0);
    this.mg.stats().attackMaxIncoming(this.target, troops);
  }

  private comeHome(troops: number): void {
    this.hegemon.addTroops(troops);
    this.attack?.delete();
    this.active = false;
  }

  private bordersRazed(tile: TileRef): boolean {
    const n = this.map.neighbors4(tile, this.nbuf);
    for (let i = 0; i < n; i++) {
      if (this.razed.has(this.nbuf[i])) return true;
    }
    return false;
  }

  // The target may have resettled land this strike razed; pick the front up
  // again from everything razed so far.
  private refreshFrontier(): void {
    this.attack!.clearBorder();
    for (const tile of this.razed) this.addNeighbors(tile);
  }

  private addNeighbors(tile: TileRef): void {
    const tickNow = this.mg.ticks();
    const n = this.map.neighbors4(tile, this.nbuf);
    for (let i = 0; i < n; i++) {
      const neighbor = this.nbuf[i];
      if (
        this.map.ownerID(neighbor) !== this.targetSmallID ||
        this.mg.isInDarkStar(neighbor)
      ) {
        continue;
      }
      this.attack!.addBorderTile(neighbor);
      let numRazed = 0;
      const numInner = this.map.neighbors4(neighbor, this.nbuf2);
      for (let j = 0; j < numInner; j++) {
        if (this.razed.has(this.nbuf2[j])) numRazed++;
      }

      let mag: number;
      switch (this.map.terrainType(neighbor)) {
        case TerrainType.Plains:
          mag = 1;
          break;
        case TerrainType.Highland:
          mag = 1.5;
          break;
        case TerrainType.Mountain:
          mag = 2;
          break;
        default:
          mag = 0;
          break;
      }
      // AttackExecution's priority, with razed tiles standing in for owned ones.
      const priority =
        (this.random.nextInt(0, 7) + 10) * (1 - numRazed * 0.5 + mag / 2) +
        tickNow;
      this.toRaze.enqueue(neighbor, priority);
    }
  }

  private attackLogicInput(
    attackTroops: number,
    tile: TileRef,
    borderSize: number,
  ): AttackLogicInput {
    return {
      terrain: this.map.terrainType(tile),
      attackTroops,
      attacker: {
        type: this.hegemon.type(),
        // Decoupled from what it still holds (H5), as when it defends.
        numTiles:
          this.mg.darkStar()?.domainTileCount ?? this.hegemon.numTilesOwned(),
      },
      defender: {
        type: this.target.type(),
        numTiles: this.target.numTilesOwned() - this.target.domainTilesHeld(),
        troops: this.target.troops(),
        isTraitor: this.target.isTraitor(),
        isDisconnectedTeammate: false,
      },
      defenderHasDefensePost: this.mg.hasUnitNearby(
        tile,
        this.mg.config().defensePostRange(),
        UnitType.DefensePost,
        this.target.id(),
      ),
      falloutRatio: this.mg.hasFallout(tile)
        ? this.mg.numTilesWithFallout() / this.mg.numLandTiles()
        : null,
      borderSize,
    };
  }

  owner(): Player {
    return this.hegemon;
  }

  isActive(): boolean {
    return this.active;
  }
}
