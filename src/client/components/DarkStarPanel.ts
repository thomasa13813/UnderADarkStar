import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { PlayerType, UnitType } from "../../core/game/Game";
import { renderTroops, translateText } from "../Utils";
import { GameView, PlayerView } from "../view";

/**
 * The Dark Star readout (hegemon mode): how strong the Hegemon is, how much of
 * its domain it still holds, who is invading, whether the invasion has stalled
 * (the Dark Star then strikes back with everything, H13), and how long the
 * viewer must wait before invading again (H12). Embedded by game-right-sidebar
 * under the game timer, like the overtime panel. Hidden when the mode is off
 * and after a winner.
 *
 * From the throne it also reads the board (H15): what its strikes hold, and a
 * sortable table of the challengers — troops, capacity, cities, land share and
 * whether each can be struck (H16).
 */

type SortKey = "name" | "troops" | "capacity" | "cities" | "land";

interface ChallengerRow {
  player: PlayerView;
  troops: number;
  capacity: number;
  cities: number;
  land: number; // share of the map's land, in percent
  status: string;
  statusClass: string;
}

@customElement("dark-star-panel")
export class DarkStarPanel extends LitElement {
  @property({ attribute: false }) game!: GameView;
  @property({ attribute: false }) hasWinner = false;
  // Bumped by the parent each tick so the readout advances every second.
  @property({ attribute: false }) refreshKey = 0;

  @state() private showChallengers = true;
  @state() private sortKey: SortKey = "capacity";
  @state() private sortDescending = true;

  // Light DOM so Tailwind classes apply and it stacks in the parent's flex.
  createRenderRoot() {
    return this;
  }

  private formatTime(ticks: number): string {
    const seconds = Math.ceil(ticks / 10);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  private sortBy(key: SortKey) {
    if (this.sortKey === key) {
      this.sortDescending = !this.sortDescending;
    } else {
      this.sortKey = key;
      this.sortDescending = key !== "name";
    }
  }

  private challengerRows(hegemon: PlayerView): ChallengerRow[] {
    const config = this.game.config();
    const mapLand = Math.max(1, this.game.numLandTiles());
    const striking = new Set(
      hegemon
        .outgoingAttacks()
        .filter((a) => a.isStrike)
        .map((a) => a.targetID),
    );
    const rows: ChallengerRow[] = [];
    for (const p of this.game.playerViews()) {
      // Tribes never invade and are beneath notice; the table is the powers.
      if (p.isHegemon() || !p.isAlive() || p.type() === PlayerType.Bot) {
        continue;
      }
      const landTiles = p.numTilesOwned() - p.domainTilesHeld();
      const tyranny = config.hegemonTyrannyLossPercent(landTiles);
      let status: string;
      let statusClass: string;
      if (p.domainTilesHeld() > 0) {
        status = translateText("dark_star.status_invading");
        statusClass = "text-red-400 font-bold";
      } else if (striking.has(p.smallID())) {
        status = translateText("dark_star.status_striking");
        statusClass = "text-purple-300 font-bold";
      } else if (tyranny === null) {
        status = translateText("dark_star.status_immune");
        statusClass = "text-gray-400";
      } else if (tyranny > 100) {
        // Unbounded near the floor (H16); past 99× the exact figure is noise.
        status = translateText("dark_star.status_cost", {
          mult: tyranny > 9900 ? "99+" : (tyranny / 100).toFixed(1),
        });
        statusClass = "text-orange-300";
      } else {
        status = translateText("dark_star.status_free");
        statusClass = "text-green-400";
      }
      rows.push({
        player: p,
        troops: p.troops(),
        capacity: config.maxTroops(p),
        cities: p.units(UnitType.City).length,
        land: (landTiles / mapLand) * 100,
        status,
        statusClass,
      });
    }
    const dir = this.sortDescending ? -1 : 1;
    rows.sort((a, b) => {
      if (this.sortKey === "name") {
        return (
          dir * a.player.displayName().localeCompare(b.player.displayName())
        );
      }
      return dir * (a[this.sortKey] - b[this.sortKey]);
    });
    return rows;
  }

  private renderHeader(key: SortKey, labelKey: string, align = "text-right") {
    const active = this.sortKey === key;
    return html`<th
      class="${align} px-1 py-0.5 cursor-pointer select-none whitespace-nowrap ${active
        ? "text-purple-200"
        : "text-gray-400 hover:text-gray-200"}"
      @click=${() => this.sortBy(key)}
    >
      ${translateText(labelKey)}${active
        ? this.sortDescending
          ? " ▾"
          : " ▴"
        : ""}
    </th>`;
  }

  private renderChallengers(hegemon: PlayerView) {
    if (!this.showChallengers) return nothing;
    const rows = this.challengerRows(hegemon);
    return html`
      <div class="max-h-64 overflow-y-auto -mx-2">
        <table class="text-xs w-full border-collapse">
          <thead class="sticky top-0 bg-gray-800/95">
            <tr>
              ${this.renderHeader("name", "dark_star.col_name", "text-left")}
              ${this.renderHeader("troops", "dark_star.col_troops")}
              ${this.renderHeader("capacity", "dark_star.col_capacity")}
              ${this.renderHeader("cities", "dark_star.col_cities")}
              ${this.renderHeader("land", "dark_star.col_land")}
              <th
                class="text-right px-1 py-0.5 text-gray-400 whitespace-nowrap"
              >
                ${translateText("dark_star.col_strike")}
              </th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (r) =>
                html`<tr class="odd:bg-gray-700/30">
                  <td class="text-left px-1 py-0.5 max-w-28 truncate">
                    ${r.player.displayName()}
                  </td>
                  <td class="text-right px-1 py-0.5 tabular-nums">
                    ${renderTroops(r.troops)}
                  </td>
                  <td class="text-right px-1 py-0.5 tabular-nums">
                    ${renderTroops(r.capacity)}
                  </td>
                  <td class="text-right px-1 py-0.5 tabular-nums">
                    ${r.cities}
                  </td>
                  <td class="text-right px-1 py-0.5 tabular-nums">
                    ${r.land.toFixed(1)}%
                  </td>
                  <td
                    class="text-right px-1 py-0.5 whitespace-nowrap ${r.statusClass}"
                  >
                    ${r.status}
                  </td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
    `;
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
    const domainHeld =
      darkStar.domainTileCount -
      this.game.players().reduce((held, p) => held + p.domainTilesHeld(), 0);
    const domainPct = Math.min(
      100,
      Math.floor((domainHeld / darkStar.domainTileCount) * 100),
    );
    // Its land beyond the moat is its strikes' bubbles (H17), not domain.
    const bubbleTiles = Math.max(0, hegemon.numTilesOwned() - domainHeld);

    const me = this.game.myPlayer();
    const onThrone = me !== null && me.isHegemon();
    const invader =
      this.game.playerViews().find((p) => p.domainTilesHeld() > 0) ?? null;
    const cooldown =
      me !== null ? me.invasionCooldownUntil() - this.game.ticks() : 0;

    let status: string;
    let statusClass = "text-gray-300";
    if (invader === null) {
      status = translateText("dark_star.unchallenged");
    } else if (invader.invasionStalled()) {
      // H13: from the throne, this is your income being spent for you.
      status = translateText(
        onThrone ? "dark_star.stalled_hegemon" : "dark_star.stalled",
      );
      statusClass = "text-red-400 font-bold";
    } else if (me !== null && invader.id() === me.id()) {
      status = translateText("dark_star.you_invade");
      statusClass = "text-green-400 font-bold";
    } else {
      status = translateText("dark_star.invader", {
        name: invader.displayName(),
      });
      statusClass = onThrone ? "text-red-300 font-bold" : "text-orange-300";
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
        ${onThrone && bubbleTiles > 0
          ? html`<div class="text-xs text-purple-300">
              ${translateText("dark_star.bubble", { tiles: bubbleTiles })}
            </div>`
          : ""}
        ${onThrone
          ? html`
              <button
                class="text-xs text-left text-gray-300 hover:text-white cursor-pointer"
                @click=${() => (this.showChallengers = !this.showChallengers)}
              >
                ${translateText(
                  this.showChallengers
                    ? "dark_star.hide_challengers"
                    : "dark_star.show_challengers",
                )}
              </button>
              ${this.renderChallengers(hegemon)}
            `
          : ""}
      </div>
    `;
  }
}
