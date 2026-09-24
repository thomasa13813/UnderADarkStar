import { EventBus } from "../../core/EventBus";
import { Controller } from "../Controller";
import { PlaySoundEffectEvent } from "../sound/Sounds";
import { GoToPositionEvent } from "../TransformHandler";
import { GameView } from "../view/GameView";

// The camera and the cues for the opening (C3 in docs/DarkStar-Design.md,
// §6.12). GameView draws the flights; this controller pulls the camera out
// to the whole map when they launch, plays one launch cue, a landing cue
// for each wave of landings, and brings a challenger's camera back to its
// own territory when its flight has come down. The Hegemon, and a spectator,
// keep the wide view — the throne watches its subjects scatter.

const LANDING_CUE_INTERVAL_TICKS = 5;
const PULL_OUT_FIT = 0.9;
// The zoom ClientGameRunner would have gone to the player at after the
// spawn phase; the opening defers that move until the player has landed.
const HOME_ZOOM = 8;

interface Camera {
  fitAllScale(fit?: number): number;
}

export class OpeningController implements Controller {
  private started = false;
  private returned = false;
  private lastLandingCueTick = -Infinity;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private camera: Camera,
  ) {}

  tick(): void {
    const opening = this.game.opening();
    if (opening === null) return;

    if (!this.started && opening.startedThisTick()) {
      this.started = true;
      const g = this.game.darkStar();
      if (g !== null) {
        this.eventBus.emit(
          new GoToPositionEvent(
            g.cx,
            g.cy,
            this.camera.fitAllScale(PULL_OUT_FIT),
          ),
        );
      }
      this.eventBus.emit(new PlaySoundEffectEvent("atom-launch"));
    }
    if (!this.started) return;

    const landed = opening.landedThisTick();
    if (landed.length === 0) return;

    const tick = this.game.ticks();
    if (tick - this.lastLandingCueTick >= LANDING_CUE_INTERVAL_TICKS) {
      this.lastLandingCueTick = tick;
      this.eventBus.emit(new PlaySoundEffectEvent("atom-hit"));
    }

    const me = this.game.myPlayer();
    if (this.returned || me === null || me.isHegemon()) return;
    const mine = landed.find((l) => l.smallID === me.smallID());
    if (mine === undefined) return;
    this.returned = true;
    // By tile, not by name: a fresh spawn has no name placement yet.
    this.eventBus.emit(
      new GoToPositionEvent(
        this.game.x(mine.tile),
        this.game.y(mine.tile),
        HOME_ZOOM,
      ),
    );
  }
}
