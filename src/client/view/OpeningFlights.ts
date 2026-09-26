import { GameMap, TileRef } from "../../core/game/GameMap";
import { flightPath } from "../../core/game/Opening";
import type { DeadUnitFx, UnitState } from "../render/types";
import { UT_PROJECTILE } from "../render/types";

// The opening (C3 in docs/DarkStar-Design.md, §6.12): when the spawn phase
// ends, every challenger launches from the Dark Star's centre to its spawn
// tile on the projectile's flight. The sim owns only the window (Opening.ts);
// the flights are drawn by the client alone, as PHANTOM units — UnitState
// entries with negative ids that never existed in the sim, placed on the same
// Parabola path the strike and a gate shot fly, and stepped here each tick.
// The renderer cannot tell them apart: the unit pass draws them in their
// owner's colours with the missile smoothing, the trail manager stamps their
// trails (no target tile, so no telegraph ring — Tom found them clutter), and their landing is
// reported as a dead unit that reached its target, so the impact flash plays.
// Until a flight lands its owner's fill and name are hidden (hiddenOwners).
//
// A flight that would outlast the window is played faster (the path is
// sampled over fewer ticks), so the last landing and the end of immunity
// coincide. Nothing here touches the sim, the wire or replays.

export interface OpeningLauncher {
  smallID: number;
  spawnTile: TileRef;
}

interface Flight {
  smallID: number;
  target: TileRef;
  path: TileRef[];
  startTick: number;
  ticks: number; // launch to landing, after compression
  landTick: number;
  unit: UnitState;
  landed: boolean;
}

export interface OpeningLanding {
  smallID: number;
  tile: TileRef;
}

export class OpeningFlights {
  private flights = new Map<number, Flight>(); // by smallID
  private nextUnitId = -1;
  private _startTick = 0;
  private _endTick = 0;
  private _active = false;
  private _hidden = new Set<number>();
  private _hiddenChanged = false;
  private _landedThisTick: OpeningLanding[] = [];
  private _startedThisTick = false;

  constructor(
    private readonly map: GameMap,
    private readonly centre: TileRef,
    private readonly speed: number,
  ) {}

  /**
   * Launch every flight at `startTick`; all of them land by
   * `startTick + windowTicks`.
   */
  start(
    startTick: number,
    launchers: readonly OpeningLauncher[],
    windowTicks: number,
  ): void {
    this.flights.clear();
    this._hidden.clear();
    this._startTick = startTick;
    this._endTick = startTick + Math.max(1, windowTicks);
    this._active = true;
    this._startedThisTick = true;
    this._hiddenChanged = true;
    for (const l of launchers) {
      this.launch(l.smallID, l.spawnTile, startTick);
    }
  }

  private launch(smallID: number, spawnTile: TileRef, tick: number): void {
    const path = flightPath(this.map, this.centre, spawnTile, this.speed);
    const ticks = Math.max(1, Math.min(path.length, this._endTick - tick));
    const flight: Flight = {
      smallID,
      target: spawnTile,
      path,
      startTick: tick,
      ticks,
      landTick: tick + ticks,
      unit: this.phantom(smallID, path[0]),
      landed: false,
    };
    this.flights.set(smallID, flight);
    this._hidden.add(smallID);
    this._hiddenChanged = true;
  }

  private phantom(ownerID: number, pos: TileRef): UnitState {
    return {
      id: this.nextUnitId--,
      unitType: UT_PROJECTILE,
      ownerID,
      lastOwnerID: null,
      pos,
      lastPos: pos,
      isActive: true,
      reachedTarget: false,
      retreating: false,
      targetable: false,
      waitTicks: 0,
      markedForDeletion: false,
      health: null,
      underConstruction: false,
      targetUnitId: null,
      targetTile: null,
      troops: 0,
      missileTimerQueue: [],
      level: 1,
      veterancy: 0,
      hasTrainStation: false,
      trainType: null,
      loaded: null,
      constructionStartTick: null,
      samUpgradeStartTick: null,
      samUpgradeStartRange: null,
      samUpgradeTargetLevel: null,
      samUpgradeDuration: null,
      punitiveWarhead: null,
      punitiveExpiresTick: null,
    };
  }

  /**
   * A player's spawn tile as the client now knows it. A nation can hop once
   * more after the phase ends, and a late human spawns into the window: a
   * flight in the air is re-aimed, a new player gets a flight that still
   * lands inside the window, and anyone after the window is simply shown.
   */
  spawnChanged(smallID: number, spawnTile: TileRef, tick: number): void {
    if (!this._active) return;
    const flight = this.flights.get(smallID);
    if (flight === undefined) {
      if (tick < this._endTick) this.launch(smallID, spawnTile, tick);
      return;
    }
    if (flight.landed || flight.target === spawnTile) return;
    flight.target = spawnTile;
    const path = flightPath(this.map, this.centre, spawnTile, this.speed);
    flight.path = path;
    flight.ticks = Math.max(
      1,
      Math.min(path.length, this._endTick - flight.startTick),
    );
    flight.landTick = flight.startTick + flight.ticks;
  }

  /** Step every flight to `tick`; landings are reported until the next call. */
  advance(tick: number): void {
    this._landedThisTick.length = 0;
    if (!this._active) return;
    if (tick > this._startTick) this._startedThisTick = false;
    let flying = 0;
    for (const f of this.flights.values()) {
      if (f.landed) continue;
      const u = f.unit;
      u.lastPos = u.pos;
      if (tick >= f.landTick) {
        // As the sim lands a projectile: on the aim tile itself, one tick
        // after the last path tile.
        u.pos = f.target;
        u.reachedTarget = true;
        u.isActive = false;
        f.landed = true;
        this._hidden.delete(f.smallID);
        this._hiddenChanged = true;
        this._landedThisTick.push({ smallID: f.smallID, tile: u.pos });
        continue;
      }
      const dt = Math.max(0, tick - f.startTick);
      const idx = Math.min(
        f.path.length - 1,
        Math.floor((dt * f.path.length) / f.ticks),
      );
      u.pos = f.path[idx];
      flying++;
    }
    if (flying === 0 && tick >= this._endTick) {
      this._active = false;
    }
  }

  /** Phantom units still in the air after the last advance(). */
  *unitsInFlight(): IterableIterator<UnitState> {
    for (const f of this.flights.values()) {
      if (!f.landed) yield f.unit;
    }
  }

  /** What the FX pass needs for each landing since the last advance(). */
  landingsAsDeadUnits(): DeadUnitFx[] {
    return this._landedThisTick.map((l) => ({
      unitType: UT_PROJECTILE,
      pos: l.tile,
      reachedTarget: true,
      ownerSmallID: l.smallID,
    }));
  }

  landedThisTick(): readonly OpeningLanding[] {
    return this._landedThisTick;
  }

  startedThisTick(): boolean {
    return this._startedThisTick;
  }

  /** Owners whose territory fill and name are still hidden. */
  hiddenOwners(): ReadonlySet<number> {
    return this._hidden;
  }

  /** True once since the hidden set last changed. */
  takeHiddenChanged(): boolean {
    const changed = this._hiddenChanged;
    this._hiddenChanged = false;
    return changed;
  }

  isHidden(smallID: number): boolean {
    return this._hidden.has(smallID);
  }

  landTickOf(smallID: number): number | undefined {
    return this.flights.get(smallID)?.landTick;
  }

  isActive(): boolean {
    return this._active;
  }

  startTick(): number {
    return this._startTick;
  }

  endTick(): number {
    return this._endTick;
  }
}
