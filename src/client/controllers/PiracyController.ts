import { EventBus, GameEvent } from "../../core/EventBus";
import { isInDarkStarOrMoat } from "../../core/game/DarkStar";
import { PlayerType, UnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { Controller } from "../Controller";
import { MouseUpEvent, TouchEvent } from "../InputHandler";
import { TransformHandler } from "../TransformHandler";
import {
  MoveWarshipIntentEvent,
  SendEmbracePiracyIntentEvent,
  SendPirateLandIntentEvent,
} from "../Transport";
import { showToast, translateText } from "../Utils";
import { GameView, PlayerView, UnitView } from "../view";

// The death screen's Embrace piracy button: from here on, the next click on
// deep space launches the corsair (docs/DarkStar-Piracy.md, PR1, PR3).
export class BeginPiracyEvent implements GameEvent {}

/**
 * Piracy (docs/DarkStar-Piracy.md, PR3, PR4, PR15): a pirate's whole input
 * is two clicks. With no corsair afloat, a click on deep space launches one
 * (the first after Embrace, the next after a sinking's wait). With a corsair
 * afloat, a click on deep space re-points its patrol, and a click on land
 * orders a landing on that coast; a click on deep space while a landing is
 * under way calls it off, no questions asked. The sim refuses what it must
 * as a silent no-op; this controller says why, in a toast, for every
 * refusal the view can see coming.
 *
 * While a pirate, the warship selection controller stands down (no
 * selection box on the corsair: Tom, 2026-10-15). The radial menu, the
 * build bar and the troop slider are already hidden for a player with no
 * tiles.
 */
export class PiracyController implements Controller {
  // Embrace was taken on the death screen and no corsair has launched yet;
  // the pirate flag is set only when one does. Cleared on return.
  private armed = false;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {}

  init() {
    this.eventBus.on(BeginPiracyEvent, () => this.onBegin());
    this.eventBus.on(MouseUpEvent, (e) => this.onClick(e.x, e.y));
    this.eventBus.on(TouchEvent, (e) => this.onClick(e.x, e.y));
  }

  tick() {
    const me = this.game.myPlayer();
    if (me === null) return;
    if (me.isAlive() || me.isPirate()) {
      // Launched, or back among the living: the choice is spent.
      this.armed = false;
    }
  }

  // Whether this client is a pirate's, or about to be: a dead challenger
  // who took Embrace, or one whose flag is set.
  isPirating(): boolean {
    const me = this.game.myPlayer();
    return me !== null && !me.isAlive() && (this.armed || me.isPirate());
  }

  private onBegin() {
    const me = this.game.myPlayer();
    if (me === null || me.isAlive() || !this.canEmbrace(me)) return;
    this.armed = true;
    showToast(translateText("piracy.pick_spawn"), "green", 4000);
  }

  // The gate EmbracePiracyExecution applies, as far as the view can see.
  private canEmbrace(me: PlayerView): boolean {
    return (
      this.game.config().piracyConfig().enabled &&
      me.type() === PlayerType.Human &&
      !me.isHegemon() &&
      me.hasSpawned() &&
      !this.game.inSpawnPhase() &&
      !this.game.inOpening()
    );
  }

  private corsairOf(me: PlayerView): UnitView | undefined {
    return this.game
      .units(UnitType.Warship)
      .find((u) => u.isActive() && u.owner() === me);
  }

  private onClick(x: number, y: number) {
    if (!this.isPirating()) return;
    const me = this.game.myPlayer()!;
    const cell = this.transformHandler.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(cell.x, cell.y)) return;
    const tile = this.game.ref(cell.x, cell.y);
    const corsair = this.corsairOf(me);

    if (corsair === undefined) {
      this.launch(me, tile);
      return;
    }
    if (this.game.isWater(tile)) {
      // A patrol order; a landing under way is called off by it (PR4).
      this.eventBus.emit(new MoveWarshipIntentEvent([corsair.id()], tile));
      return;
    }
    this.eventBus.emit(new SendPirateLandIntentEvent(tile));
  }

  // The spawn click (PR3, PR10): deep space outside the Dark Star and its
  // moat, after the wait. Each refusal the sim
  // would make silently gets its line here.
  private launch(me: PlayerView, tile: TileRef) {
    if (!this.game.isWater(tile)) {
      showToast(translateText("piracy.refused_land"), "red");
      return;
    }
    if (this.inDarkStarWater(tile)) {
      showToast(translateText("piracy.refused_dark_star"), "red");
      return;
    }
    if (this.game.ticks() < me.pirateRespawnAt()) {
      showToast(translateText("piracy.refused_wait"), "red");
      return;
    }
    this.eventBus.emit(new SendEmbracePiracyIntentEvent(tile));
  }

  // The disc and the moat (H6, H10): the sim's isInDarkStar / isInMoat.
  private inDarkStarWater(tile: TileRef): boolean {
    const g = this.game.darkStar();
    if (g === null) return false;
    return isInDarkStarOrMoat(g, this.game.x(tile), this.game.y(tile));
  }
}
