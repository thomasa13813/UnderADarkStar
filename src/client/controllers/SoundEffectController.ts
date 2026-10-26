import { EventBus } from "../../core/EventBus";
import {
  MessageType,
  PIRATE_LANDED_MESSAGE,
  PIRATE_LANDING_MESSAGE,
  PlayerType,
  UnitType,
} from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import {
  DisplayMessageUpdate,
  GameUpdateType,
} from "../../core/game/GameUpdates";
import { Controller } from "../Controller";
import { PlaySoundEffectEvent, SoundEffect } from "../sound/Sounds";
import { SendSpawnIntentEvent } from "../Transport";
import { GameView, PlayerView, UnitView } from "../view";
import { BeginPiracyEvent } from "./PiracyController";

// A MIRV rains hundreds of warheads over a few seconds; playing a boom per
// warhead churns the audio pipeline. Play at most one warhead boom per interval.
const MIRV_HIT_SOUND_INTERVAL_TICKS = 5;

// Several nukes can be announced inbound on the same tick (multiple silos,
// multiple attackers); don't stack the alarm and evict other cues.
const NUKE_WARNING_SOUND_INTERVAL_TICKS = 10;

// A new factory stations every owned City/Port/Factory within range on the
// same tick (FactoryExecution.createStation); play the cue once, not N times.
const TRAIN_STATION_SOUND_INTERVAL_TICKS = 10;

// hadTrainStation is keyed by unit id and normally cleared when the unit goes
// inactive, but one that leaves view without ever delivering that update would
// sit there for the rest of the session. Sweep it occasionally instead. 100
// ticks is ten seconds or so: far more often than the leak could matter, and
// rare enough that the scan costs nothing.
const TRAIN_STATION_SWEEP_INTERVAL_TICKS = 100;

// Several stargate shots can come down on the same tick; one landing cue.
const LANDING_SOUND_INTERVAL_TICKS = 5;

// Structures a train station can be attached to (see TrainStationExecution).
const STATION_CAPABLE_TYPES = new Set<UnitType>([
  UnitType.City,
  UnitType.Factory,
  UnitType.Port,
]);

const NUKE_INBOUND_MESSAGES = new Set<MessageType>([
  MessageType.NUKE_INBOUND,
  MessageType.HYDROGEN_BOMB_INBOUND,
  MessageType.MIRV_INBOUND,
]);

export class SoundEffectController implements Controller {
  private lastMirvHitSoundTick = -Infinity;
  private lastNukeWarningSoundTick = -Infinity;
  private lastTrainStationSoundTick = -Infinity;
  // A train station is a flag on an existing structure, not a unit — play the
  // build sound on the false→true edge only, so structures that already have
  // one when first seen (e.g. joining mid-game) stay silent.
  private hadTrainStation = new Map<number, boolean>();
  private lastTrainStationSweepTick = -Infinity;
  private lastLandingSoundTick = -Infinity;
  // Who a stargate shot is coming down on, by unit id: the aimed tile's owner
  // as of the previous update (null for unclaimed land). The sim conquers the
  // tile on the tick it lands, so by the time the landing update arrives the
  // tile already reads as the shooter's; the defender has to be remembered
  // from the flight. Entries go when the shot does.
  private shotDefender = new Map<number, number | null>();

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
  ) {}

  init(): void {
    // On the intent, not the sim confirmation: the cue answers the player's
    // click, and re-placing the spawn should sound every time.
    this.eventBus.on(SendSpawnIntentEvent, this.onSpawnIntent);
    // Likewise on the death screen's button, not on the corsair's spawn: the
    // cue marks the choice (docs/DarkStar-Piracy.md; Tom, 2026-10-17).
    this.eventBus.on(BeginPiracyEvent, this.onBeginPiracy);
  }

  private onSpawnIntent = (): void => {
    // Spectators can click unowned land too, but their intent is dropped
    // server-side — no false confirmation cue. The throne has no spawn to
    // place, so it never hears one either.
    const me = this.game.myPlayer();
    if (me === null || me.isHegemon()) return;
    this.emit("spawn");
  };

  // Heard by the pirate alone: the button is theirs, and at sea they fly no
  // name (PR15), so nobody else has anything to hear.
  private onBeginPiracy = (): void => {
    if (this.game.myPlayer() === null) return;
    this.emit("embrace");
  };

  tick(): void {
    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    this.pruneTrainStations();

    for (const u of updates[GameUpdateType.Unit] ?? []) {
      const unit = this.game.unit(u.id);
      if (unit === undefined) continue;
      this.handleUnit(unit);
    }

    if ((updates[GameUpdateType.SpawnPhaseEnd] ?? []).length > 0) {
      this.emit("game-start");
    }

    const myPlayer = this.game.myPlayer();
    if (myPlayer === null) return;
    this.handleBeachings(updates[GameUpdateType.DisplayEvent] ?? [], myPlayer);
    for (const c of updates[GameUpdateType.ConquestEvent] ?? []) {
      if (c.conquerorId === myPlayer.id()) {
        // Battle cue for conquering a real player; the ka-ching payout
        // stays for bots and nations.
        const conquered = this.game.player(c.conqueredId);
        this.emit(
          conquered.type() === PlayerType.Human ? "conquered" : "ka-ching",
        );
      }
    }

    for (const u of updates[GameUpdateType.UnitIncoming] ?? []) {
      if (u.playerID !== myPlayer.smallID()) continue;
      if (!NUKE_INBOUND_MESSAGES.has(u.messageType)) continue;
      const tick = this.game.ticks();
      if (
        tick - this.lastNukeWarningSoundTick <
        NUKE_WARNING_SOUND_INTERVAL_TICKS
      ) {
        continue;
      }
      this.lastNukeWarningSoundTick = tick;
      this.emit("nuke-warning");
    }
  }

  /**
   * A corsair beaching (PirateLandingExecution.beach): the claim is taken and
   * the hold goes ashore as an attack on the coast. The sim tells the pirate
   * and the coast's owner each with their own message; the cue follows those
   * two messages, so it reaches exactly the players involved and nobody
   * watching from across the map. No cue for a raid at sea: a busy corsair
   * would ring it all round long (Tom, 2026-10-17).
   */
  private handleBeachings(
    messages: readonly DisplayMessageUpdate[],
    me: PlayerView,
  ): void {
    for (const m of messages) {
      if (m.playerID !== me.smallID()) continue;
      if (
        m.message === PIRATE_LANDED_MESSAGE ||
        m.message === PIRATE_LANDING_MESSAGE
      ) {
        this.emit("beaching");
      }
    }
  }

  private handleUnit(unit: UnitView): void {
    if (unit.isActive() && unit.createdAt() === this.game.ticks()) {
      this.onCreated(unit);
    }
    if (STATION_CAPABLE_TYPES.has(unit.type())) {
      this.handleTrainStation(unit);
    }
    switch (unit.type()) {
      case UnitType.AtomBomb:
        this.onNukeDetonation(unit, "atom-hit");
        break;
      case UnitType.MIRVWarhead:
        this.onMirvWarheadDetonation(unit);
        break;
      case UnitType.HydrogenBomb:
        this.onNukeDetonation(unit, "hydrogen-hit");
        break;
      case UnitType.Projectile:
        this.handleProjectile(unit);
        break;
    }
  }

  /**
   * A Projectile is troops in flight: the throne's strike (RazeExecution)
   * or a challenger's stargate shot (GateShotExecution). Launch and landing
   * are heard by the shooter and by whoever owned the aimed tile — not by a
   * third player across the map (Tom, 2026-10-04).
   */
  private handleProjectile(unit: UnitView): void {
    // A tithe is heard at launch only (onTitheLaunch).
    if (unit.isTithe()) return;
    if (unit.isActive()) {
      this.shotDefender.set(unit.id(), this.ownerSmallID(unit.targetTile()));
      return;
    }
    const defender = this.shotDefender.get(unit.id()) ?? null;
    this.shotDefender.delete(unit.id());
    if (!unit.reachedTarget()) return; // recalled, or the owner died
    if (!this.involvesMe(unit, defender)) return;
    const tick = this.game.ticks();
    if (tick - this.lastLandingSoundTick < LANDING_SOUND_INTERVAL_TICKS) return;
    this.lastLandingSoundTick = tick;
    this.emit("landing");
  }

  private ownerSmallID(tile: TileRef | undefined): number | null {
    if (tile === undefined) return null;
    const owner = this.game.owner(tile);
    return owner.isPlayer() ? owner.smallID() : null;
  }

  private involvesMe(unit: UnitView, defender: number | null): boolean {
    const me = this.game.myPlayer();
    if (me === null) return false;
    return (
      unit.owner() === me || (defender !== null && defender === me.smallID())
    );
  }

  /**
   * A missile leaving a stargate. The launcher and the owner of the aimed
   * tile hear it; so does the Hegemon, whoever fired at whom — the throne
   * hears every missile in its galaxy (Tom, 2026-10-04). The detonation
   * (onNukeDetonation) stays audible to all.
   */
  private onMissileLaunch(unit: UnitView): void {
    const me = this.game.myPlayer();
    if (me === null) return;
    const target = this.ownerSmallID(unit.targetTile());
    if (me.isHegemon() || this.involvesMe(unit, target)) {
      this.emit("missile");
    }
  }

  /**
   * A tithe leaving the Dark Star (docs/DarkStar-Rework.md §2.2, S8): the
   * throne hears its own launch, and every player whose nebula the ring
   * touches hears the warning. Nobody else.
   */
  private onTitheLaunch(unit: UnitView): void {
    const me = this.game.myPlayer();
    const target = unit.targetTile();
    if (me === null || target === undefined) return;
    if (unit.owner() === me) {
      this.emit("tithe");
      return;
    }
    const mine = me.smallID();
    const touched = this.game.circleSearch(
      target,
      this.game.config().titheConfig().radius,
      (tile) => this.game.ownerID(tile) === mine,
    );
    if (touched.size > 0) this.emit("tithe");
  }

  private onProjectileLaunch(unit: UnitView): void {
    if (unit.isTithe()) {
      this.onTitheLaunch(unit);
      return;
    }
    const defender = this.ownerSmallID(unit.targetTile());
    this.shotDefender.set(unit.id(), defender);
    if (this.involvesMe(unit, defender)) this.emit("launch");
  }

  private onMirvWarheadDetonation(unit: UnitView): void {
    if (unit.isActive()) return;
    if (!unit.reachedTarget()) return;
    const tick = this.game.ticks();
    if (tick - this.lastMirvHitSoundTick < MIRV_HIT_SOUND_INTERVAL_TICKS) {
      return;
    }
    this.lastMirvHitSoundTick = tick;
    this.emit("atom-hit");
  }

  private onCreated(unit: UnitView): void {
    const myPlayer = this.game.myPlayer();
    switch (unit.type()) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
        this.onMissileLaunch(unit);
        break;
      case UnitType.Projectile:
        this.onProjectileLaunch(unit);
        break;
      case UnitType.Warship:
        if (unit.owner() === myPlayer) this.emit("build-warship");
        break;
      // A donated army is heard by the challenger it now belongs to.
      case UnitType.Army:
        if (unit.owner() === myPlayer) this.emit("army");
        break;
      case UnitType.City:
        if (unit.owner() === myPlayer) this.emit("build-city");
        break;
      case UnitType.Port:
        if (unit.owner() === myPlayer) this.emit("build-port");
        break;
      case UnitType.DefensePost:
        if (unit.owner() === myPlayer) this.emit("build-defense-post");
        break;
      case UnitType.SAMLauncher:
        if (unit.owner() === myPlayer) this.emit("sam-built");
        break;
      case UnitType.MissileSilo:
        if (unit.owner() === myPlayer) this.emit("silo-built");
        break;
      case UnitType.Stargate:
        if (unit.owner() === myPlayer) this.emit("silo-built");
        break;
      case UnitType.ShieldArray:
        if (unit.owner() === myPlayer) this.emit("build-defense-post");
        break;
      case UnitType.Factory:
        if (unit.owner() === myPlayer) this.emit("build-factory");
        break;
      case UnitType.TransportShip:
        if (unit.owner() === myPlayer) this.emit("transport-ship");
        break;
    }
  }

  /**
   * Drops entries for structures that are gone.
   *
   * No cue can be lost to this. GameView only removes a unit once it is
   * inactive (it queues the id on the tick isActive() goes false), so both
   * arms of the test below mean destroyed, and a destroyed structure never
   * comes back to gain a station. The sweep is the same condition
   * handleTrainStation already applies, catching the units whose final update
   * never reached it.
   *
   * Nor can one be replayed, which is what the `prev === false` check in
   * handleTrainStation is for rather than a plain falsy test: a structure
   * whose entry has gone reads as undefined, not false, so it is treated like
   * one first seen with a station already and stays silent.
   */
  private pruneTrainStations(): void {
    const tick = this.game.ticks();
    if (
      tick - this.lastTrainStationSweepTick <
      TRAIN_STATION_SWEEP_INTERVAL_TICKS
    ) {
      return;
    }
    this.lastTrainStationSweepTick = tick;
    for (const id of this.hadTrainStation.keys()) {
      const unit = this.game.unit(id);
      if (unit === undefined || !unit.isActive()) {
        this.hadTrainStation.delete(id);
      }
    }
  }

  private handleTrainStation(unit: UnitView): void {
    if (!unit.isActive()) {
      this.hadTrainStation.delete(unit.id());
      return;
    }
    const hasStation = unit.hasTrainStation();
    const prev = this.hadTrainStation.get(unit.id());
    if (prev === false && hasStation && unit.owner() === this.game.myPlayer()) {
      const tick = this.game.ticks();
      if (
        tick - this.lastTrainStationSoundTick >=
        TRAIN_STATION_SOUND_INTERVAL_TICKS
      ) {
        this.lastTrainStationSoundTick = tick;
        this.emit("build-train-station");
      }
    }
    this.hadTrainStation.set(unit.id(), hasStation);
  }

  private onNukeDetonation(unit: UnitView, sound: SoundEffect): void {
    if (unit.isActive()) return;
    if (!unit.reachedTarget()) return;
    this.emit(sound);
  }

  private emit(sound: SoundEffect): void {
    this.eventBus.emit(new PlaySoundEffectEvent(sound));
  }
}
