import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { renderTroops, translateText } from "../Utils";
import { GameView } from "../view";

/**
 * The Dark Star readout (hegemon mode): how strong the Hegemon is, how much of
 * its domain it still holds, who is invading, whether the invasion has stalled
 * (the Dark Star then strikes back with everything, H13), and how long the
 * viewer must wait before invading again (H12). Embedded by game-right-sidebar
 * under the game timer, like the overtime panel. Hidden when the mode is off
 * and after a winner.
 */
@customElement("dark-star-panel")
export class DarkStarPanel extends LitElement {
  @property({ attribute: false }) game!: GameView;
  @property({ attribute: false }) hasWinner = false;
  // Bumped by the parent each tick so the readout advances every second.
  @property({ attribute: false }) refreshKey = 0;

  // Light DOM so Tailwind classes apply and it stacks in the parent's flex.
  createRenderRoot() {
    return this;
  }

  private formatTime(ticks: number): string {
    const seconds = Math.ceil(ticks / 10);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  render() {
    const hegemon = this.game?.hegemon() ?? null;
    const darkStar = this.game?.darkStar() ?? null;
    const visible =
      hegemon !== null &&
      darkStar !== null &&
      hegemon.isAlive() &&
      !this.hasWinner &&
      !this.game.inSpawnPhase();
    this.style.display = visible ? "block" : "none";
    if (!visible || hegemon === null || darkStar === null) return html``;

    const maxTroops = this.game.config().maxTroops(hegemon);
    const troopPct =
      maxTroops > 0 ? Math.min(100, (hegemon.troops() / maxTroops) * 100) : 0;
    const domainPct = Math.min(
      100,
      Math.floor((hegemon.numTilesOwned() / darkStar.domainTileCount) * 100),
    );

    const me = this.game.myPlayer();
    const invader =
      this.game.playerViews().find((p) => p.domainTilesHeld() > 0) ?? null;
    const cooldown =
      me !== null ? me.invasionCooldownUntil() - this.game.ticks() : 0;

    let status: string;
    let statusClass = "text-gray-300";
    if (invader === null) {
      status = translateText("dark_star.unchallenged");
    } else if (invader.invasionStalled()) {
      status = translateText("dark_star.stalled");
      statusClass = "text-red-400 font-bold";
    } else if (me !== null && invader.id() === me.id()) {
      status = translateText("dark_star.you_invade");
      statusClass = "text-green-400 font-bold";
    } else {
      status = translateText("dark_star.invader", {
        name: invader.displayName(),
      });
      statusClass = "text-orange-300";
    }

    const panel =
      "w-fit flex flex-col gap-1.5 py-2 px-4 bg-gray-800/92 backdrop-blur-sm shadow-xs rounded-bl-lg text-white text-sm";

    return html`
      <div class="${panel}">
        <div class="flex items-center justify-between gap-3">
          <span class="font-bold tracking-wide text-purple-300">
            ${translateText("dark_star.title")}
          </span>
          <span class="text-xs text-gray-300">${hegemon.displayName()}</span>
        </div>
        <div class="relative h-2.5 w-52 overflow-hidden rounded bg-gray-600/60">
          <div
            class="absolute inset-y-0 left-0 bg-purple-400"
            style="width:${troopPct}%"
          ></div>
        </div>
        <div class="flex items-center justify-between gap-3 text-xs">
          <span>
            ${translateText("dark_star.troops", {
              troops: renderTroops(hegemon.troops()),
              max: renderTroops(maxTroops),
            })}
          </span>
          <span class="text-gray-300">
            ${translateText("dark_star.domain", { pct: domainPct })}
          </span>
        </div>
        <div class="text-xs ${statusClass}">${status}</div>
        ${cooldown > 0
          ? html`<div class="text-xs text-yellow-300">
              ${translateText("dark_star.cooldown", {
                time: this.formatTime(cooldown),
              })}
            </div>`
          : ""}
      </div>
    `;
  }
}
