import { renderTroops } from "../../client/Utils";
import { AttackLogicInput } from "../configuration/Config";
import {
  Attack,
  Execution,
  Game,
  MessageType,
  Player,
  StrikeInFlight,
  TerrainType,
  UnitType,
} from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { FlatBinaryHeap } from "./utils/FlatBinaryHeap";

const malusForRetreat = 25;

// A Hegemon strike (H8, H16, H17 in docs/DarkStar-Design.md).
//
// The Hegemon borders nobody (the moat), so a strike falls directly on the
// tile it was aimed at after a flight time. From there it is an ordinary
// conquest: the land it takes is the strike's BUBBLE, Hegemon-owned while the
// strike lasts, and the target fights it like any other invader — by taking
// the bubble back over land (AttackExecution; the bubble is defended by the
// strike's own troops, never by the Dark Star's). When the strike ends — its
// troops spent, the target beneath the tyranny floor, nothing left in reach,
// recalled, or the Hegemon fallen — the bubble POPS: every tile in it that is
// still the Hegemon's reverts to neutral, and the structures the bubble
// captured die with it (PlayerExecution deletes units on unowned land). The
// Hegemon never keeps land beyond the Dark Star.
//
// Costs are the engine's, scaled by razeAttackerLossPercent / razeSlowPercent
// and by tyranny: the smaller the target, the more each tile costs, without
// limit; at the floor a player cannot be struck at all, so a strike never
// eliminates anyone.
export class RazeExecution implements Execution, StrikeInFlight {
  private active = true;
  private mg: Game;
  private map: GameMap;
  private target: Player;
  private attack: Attack | null = null;
  private arrivalTick = 0;
  // Set at launch; the landed Attack keeps it, so the HUD sees one strike.
  private strikeID = "";
  private inFlight = false;

  private bubble = new Set<TileRef>();
  private toConquer = new FlatBinaryHeap();
  private random = new PseudoRandom(123);
  private targetSmallID: number;
  private hegemonSmallID: number;
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
    if (this.tyrannyPercent(owner) === null) {
      mg.displayMessage(
        "events_display.dark_star_strike_tyranny",
        MessageType.ATTACK_FAILED,
        this.hegemon.id(),
        undefined,
        { name: owner.displayName() },
      );
      this.active = false;
      return;
    }
    // One live strike per target: in flight or on the ground.
    if (mg.hegemonStrikeOn(owner)) {
      mg.displayMessage(
        "events_display.dark_star_strike_busy",
        MessageType.ATTACK_FAILED,
        this.hegemon.id(),
        undefined,
        { name: owner.displayName() },
      );
      this.active = false;
      return;
    }
    this.target = owner;
    this.targetSmallID = owner.smallID();
    this.hegemonSmallID = this.hegemon.smallID();

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

    this.strikeID = `strike-${ticks}-${this.ref}`;
    this.inFlight = true;
    mg.addStrikeInFlight(this);
  }

  // StrikeInFlight: what the HUD and a recall see between launch and landing.
  id(): string {
    return this.strikeID;
  }
  troopCount(): number {
    return this.troops ?? 0;
  }
  aimTile(): TileRef {
    return this.ref;
  }
  landsAtTick(): number {
    return this.arrivalTick;
  }

  targetPlayer(): Player {
    return this.target;
  }

  private landed(): void {
    if (!this.inFlight) return;
    this.inFlight = false;
    this.mg.removeStrikeInFlight(this);
  }

  // Tiles the bubble holds right now.
  bubbleSize(): number {
    return this.bubble.size;
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
    if (!this.hegemon.isAlive()) {
      // The throne fell (GameImpl pops the bubble): nothing to come home to.
      attack.delete();
      this.active = false;
      return;
    }
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
    if (!attack.isActive() || !this.target.isAlive()) {
      this.pop();
      this.active = false;
      return;
    }

    const cfg = this.mg.config().hegemonConfig();
    // The target's counter-attack spends these too (AttackExecution).
    let troopCount = attack.troops();
    const borderSize = attack.borderSize() + this.random.nextInt(0, 5);
    let tickBudget = 1;
    while (tickBudget > 0) {
      if (troopCount < 1) {
        this.pop();
        attack.delete();
        this.active = false;
        return;
      }
      const tyranny = this.tyrannyPercent(this.target);
      if (tyranny === null) {
        // Struck down to the floor: the target is beneath the throne's notice.
        this.comeHome(troopCount);
        return;
      }
      if (this.toConquer.size() === 0) {
        this.refreshFrontier();
        if (this.toConquer.size() === 0) {
          this.comeHome(troopCount);
          return;
        }
      }

      const tile = this.toConquer.dequeue();
      attack.removeBorderTile(tile);
      if (
        this.map.ownerID(tile) !== this.targetSmallID ||
        this.mg.isInDarkStar(tile) ||
        !this.bordersBubble(tile)
      ) {
        continue;
      }

      const { attackerTroopLoss, defenderTroopLoss, tickFraction } = this.mg
        .config()
        .attackLogic(this.attackLogicInput(troopCount, tile, borderSize));
      tickBudget -= (tickFraction * cfg.razeSlowPercent) / 100;
      troopCount -=
        (attackerTroopLoss * cfg.razeAttackerLossPercent * tyranny) / 10_000;
      attack.setTroops(troopCount);
      this.target.removeTroops(defenderTroopLoss);
      this.hegemon.conquer(tile);
      this.bubble.add(tile);
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
    this.landed();
    this.attack = this.hegemon.createAttack(
      this.target,
      troops,
      this.ref,
      new Set<TileRef>(),
      this.strikeID,
    );
    this.attack.markStrike();
    // The impact: the aimed tile is taken outright, and the bubble grows from it.
    this.hegemon.conquer(this.ref);
    this.bubble.add(this.ref);
    this.addNeighbors(this.ref);
    this.mg.stats().attackMaxIncoming(this.target, troops);
  }

  // The bubble pops: whatever it still holds reverts to neutral.
  private pop(): void {
    for (const tile of this.bubble) {
      if (
        this.map.ownerID(tile) === this.hegemonSmallID &&
        !this.mg.isInDarkStar(tile)
      ) {
        this.hegemon.relinquish(tile);
      }
    }
    this.bubble.clear();
  }

  private comeHome(troops: number): void {
    this.landed();
    this.pop();
    this.hegemon.addTroops(troops);
    this.attack?.delete();
    this.active = false;
  }

  private tyrannyPercent(target: Player): number | null {
    return this.mg
      .config()
      .hegemonTyrannyLossPercent(
        target.numTilesOwned() - target.domainTilesHeld(),
      );
  }

  // The domain borders nothing, so any Hegemon tile next to the target's land
  // is bubble.
  private bordersBubble(tile: TileRef): boolean {
    const n = this.map.neighbors4(tile, this.nbuf);
    for (let i = 0; i < n; i++) {
      if (this.map.ownerID(this.nbuf[i]) === this.hegemonSmallID) return true;
    }
    return false;
  }

  // The target may have taken bubble tiles back, or resettled around them:
  // pick the front up again from what the bubble still holds.
  private refreshFrontier(): void {
    this.attack!.clearBorder();
    for (const tile of this.bubble) {
      if (this.map.ownerID(tile) === this.hegemonSmallID) {
        this.addNeighbors(tile);
      } else {
        this.bubble.delete(tile);
      }
    }
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
      let numOwned = 0;
      const numInner = this.map.neighbors4(neighbor, this.nbuf2);
      for (let j = 0; j < numInner; j++) {
        if (this.map.ownerID(this.nbuf2[j]) === this.hegemonSmallID) numOwned++;
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
      // AttackExecution's priority.
      const priority =
        (this.random.nextInt(0, 7) + 10) * (1 - numOwned * 0.5 + mag / 2) +
        tickNow;
      this.toConquer.enqueue(neighbor, priority);
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
        // Decoupled from what it holds (H5), as when it defends.
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
