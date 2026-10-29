import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { dropInCutoffTurn } from "../../../core/DropIn";
import { EventBus } from "../../../core/EventBus";
import { GameType } from "../../../core/game/Game";
import { Controller } from "../../Controller";
import { currentThrone, isHeldForNextRound } from "../../ThroneState";
import { SendSpectateEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

/**
 * Under a Dark Star (docs/DarkStar-Lobbies.md L43, L48): the strip a watcher
 * of a room's round sees. They may turn pirate on the drop-in's terms: the
 * server issues the join, and the arrival screen takes over once the player
 * exists. In the round's last 3 minutes nobody joins, and a watcher who
 * asked to play is told they will be placed in the room's next round.
 */
@customElement("room-watch-bar")
export class RoomWatchBar extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state() private visible = false;
  @state() private held = false;
  @state() private closed = false;
  @state() private asked = false;

  createRenderRoot() {
    return this;
  }

  tick() {
    const throne = currentThrone();
    const g = this.game;
    const watching =
      g !== undefined &&
      throne !== undefined &&
      g.config().gameConfig().gameType === GameType.Public &&
      g.myClientID() !== undefined &&
      g.myPlayer() === null &&
      !g.gameOver();
    if (!watching) {
      if (this.visible) this.visible = false;
      return;
    }
    this.visible = true;
    this.held = isHeldForNextRound();
    this.closed =
      g.ticks() >= dropInCutoffTurn(g.config().gameConfig()) ||
      g.config().piracyConfig().enabled !== true;
  }

  private join() {
    this.asked = true;
    this.eventBus.emit(new SendSpectateEvent(false));
  }

  render() {
    if (!this.visible) return nothing;
    const name = currentThrone()?.name ?? "";
    return html`
      <div
        class="fixed bottom-24 left-1/2 -translate-x-1/2 z-[1000] w-[min(92vw,420px)] rounded-lg border border-purple-400/40 bg-gray-900/85 p-3 text-white shadow-xl backdrop-blur-xs flex items-center justify-between gap-3"
        data-room-watch-bar
      >
        <span class="text-sm text-white/80">
          ${this.held
            ? translateText("rooms.held_hint")
            : this.closed
              ? translateText("rooms.watch_cutoff")
              : translateText("rooms.watching", { name })}
        </span>
        ${this.held || this.closed
          ? nothing
          : html`<button
              type="button"
              class="shrink-0 rounded-lg border border-red-400/50 bg-red-500/20 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-white hover:bg-red-500/35 disabled:opacity-50"
              ?disabled=${this.asked}
              data-watch-join
              @click=${() => this.join()}
            >
              ${this.asked
                ? translateText("rooms.watch_joining")
                : translateText("rooms.watch_join")}
            </button>`}
      </div>
    `;
  }
}
