import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UnitType } from "../../../core/game/Game";
import { Controller } from "../../Controller";
import {
  PiracyController,
  pirateReadyAt,
} from "../../controllers/PiracyController";
import { renderNumber, renderTroops, translateText } from "../../Utils";
import { GameView } from "../../view";

/**
 * Piracy (docs/DarkStar-Piracy.md, PR5, PR10, PR16): the pirate's own HUD,
 * the one panel they have while the rest is hidden. The hold against its
 * cap, the raid gold in the purse, and one line on what the next click
 * does: launch a corsair (after the sinking's wait, counted down), patrol
 * or land, or call a landing off.
 */
@customElement("pirate-hold-panel")
export class PirateHoldPanel extends LitElement implements Controller {
  public game: GameView;
  public piracy: PiracyController;

  @state() private visible = false;
  @state() private hold = 0;
  @state() private cap = 1;
  @state() private gold = 0n;
  @state() private status = "";
  @state() private afloat = false;

  createRenderRoot() {
    return this;
  }

  tick() {
    const me = this.game?.myPlayer();
    const visible =
      me !== null && me !== undefined && this.piracy?.isPirating() === true;
    if (!visible) {
      if (this.visible) this.visible = false;
      return;
    }
    const cfg = this.game.config().piracyConfig();
    const corsair = this.game
      .units(UnitType.Warship)
      .find((u) => u.isActive() && u.owner() === me);
    this.afloat = corsair !== undefined;
    this.hold = corsair?.troops() ?? 0;
    this.cap = cfg.holdCap;
    this.gold = me!.gold();
    this.status = this.statusLine(corsair !== undefined);
    this.visible = true;
  }

  private statusLine(afloat: boolean): string {
    const me = this.game.myPlayer()!;
    if (afloat) {
      return me.pirateLanding() !== null
        ? translateText("piracy.landing_under_way")
        : translateText("piracy.at_sea");
    }
    const wait =
      (pirateReadyAt(this.game, me) ?? this.game.ticks()) - this.game.ticks();
    if (wait > 0) {
      return translateText("piracy.next_corsair_in", {
        seconds: Math.ceil(wait / 10),
      });
    }
    return me.isPirate()
      ? translateText("piracy.launch_next")
      : translateText("piracy.pick_spawn");
  }

  render() {
    if (!this.visible) return nothing;
    const pct = Math.min(100, (this.hold / Math.max(1, this.cap)) * 100);
    return html`
      <div
        class="fixed top-24 left-1/2 -translate-x-1/2 z-[1000] w-[min(92vw,340px)] rounded-lg border border-white/15 bg-gray-900/80 p-3 text-white shadow-xl backdrop-blur-xs pointer-events-none"
        data-pirate-panel
        data-afloat=${this.afloat ? "1" : "0"}
      >
        <div class="flex items-center justify-between gap-3">
          <span
            class="text-xs font-bold tracking-widest uppercase text-white/70"
          >
            ${translateText("piracy.title")}
          </span>
          <span class="text-xs tabular-nums text-amber-300">
            ${translateText("piracy.raid_gold")}: ${renderNumber(this.gold)}
          </span>
        </div>
        <div class="mt-2 flex items-center justify-between text-sm">
          <span class="font-bold">${translateText("piracy.hold")}</span>
          <span class="tabular-nums" data-pirate-hold>
            ${renderTroops(this.hold)} / ${renderTroops(this.cap)}
          </span>
        </div>
        <div
          class="relative mt-1 h-1.5 w-full overflow-hidden rounded bg-white/10"
        >
          <div
            class="absolute inset-y-0 left-0 bg-red-400 transition-[width] duration-200"
            style="width:${pct}%"
          ></div>
        </div>
        <p class="mt-2 text-xs text-white/70" data-pirate-status>
          ${this.status}
        </p>
      </div>
    `;
  }
}
