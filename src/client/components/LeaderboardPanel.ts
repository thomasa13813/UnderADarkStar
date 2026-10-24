import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  LEADERBOARD_SORTS,
  LeaderboardEntry,
  LeaderboardResponse,
  LeaderboardSort,
} from "../../core/ApiSchemas";
import { fetchLeaderboard } from "../LeaderboardApi";
import { translateText } from "../Utils";
import { styledSelect } from "./ui/StyledSelect";

// Under a Dark Star: the leaderboard on the home page (docs/DarkStar-Accounts.md
// §6, moved out of the nav bar 2026-10-20 to draw players into the rankings).
// A compact card beside the menu on wide screens and under it on narrow ones:
// the top ten under the chosen sort, every row with all three numbers as on
// the full page (the sorting one emphasised), the signed-in player's own row
// highlighted or pinned under them, the guest and unranked hints, and a link
// to the full page (<leaderboard-modal>, the top 100). Read on load, again on
// a return home once the API's minute of caching has passed, and whenever the
// account changes.
//
// Every word is set in DarkStar Pixel (Tom, 2026-10-24), the title in the
// pixel-art buttons' purple ring. The face has no bold, so emphasis is by
// colour alone, and sizes stay at 12px or 24px, where its pixels land on
// the screen's.

export const PANEL_ROWS = 10;
export const PANEL_REFRESH_MS = 60_000;

type Loaded = LeaderboardResponse | null | undefined;

const SORT_LABELS: Record<LeaderboardSort, string> = {
  victories: "leaderboard.col_victories",
  reigns: "leaderboard.col_reigns",
  longest: "leaderboard.col_longest",
};

@customElement("leaderboard-panel")
export class LeaderboardPanel extends LitElement {
  @state() private sort: LeaderboardSort = "victories";
  @state() private lists: Partial<Record<LeaderboardSort, Loaded>> = {};
  @state() private loading: LeaderboardSort | null = null;
  // When the lists were last cleared; answers to an older request are dropped.
  private loadedAt = 0;
  private generation = 0;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this.onShowPage);
    document.addEventListener("userMeResponse", this.onAccountChange);
    document.addEventListener("session-cleared", this.onAccountChange);
    this.refresh();
  }

  disconnectedCallback() {
    window.removeEventListener("showPage", this.onShowPage);
    document.removeEventListener("userMeResponse", this.onAccountChange);
    document.removeEventListener("session-cleared", this.onAccountChange);
    this.generation++;
    super.disconnectedCallback();
  }

  private onShowPage = (event: Event) => {
    if ((event as CustomEvent).detail !== "page-play") return;
    if (Date.now() - this.loadedAt >= PANEL_REFRESH_MS) this.refresh();
  };

  // The own row and the hints follow sign-in and sign-out.
  private onAccountChange = () => this.refresh();

  private refresh(): void {
    this.lists = {};
    this.loadedAt = Date.now();
    this.generation++;
    void this.load(this.sort);
  }

  public setSort(sort: LeaderboardSort): void {
    if (!LEADERBOARD_SORTS.includes(sort)) return;
    this.sort = sort;
    void this.load(sort);
  }

  private async load(sort: LeaderboardSort, force = false): Promise<void> {
    if (!force && this.lists[sort] !== undefined) return;
    const generation = this.generation;
    this.loading = sort;
    const answer = await fetchLeaderboard(sort);
    if (generation !== this.generation) return;
    this.lists = { ...this.lists, [sort]: answer };
    if (this.loading === sort) this.loading = null;
  }

  private openFullPage(): void {
    window.showPage?.("page-leaderboard");
  }

  render() {
    const sort = this.sort;
    return html`
      <section
        class="flex flex-col gap-3 h-full font-pixel text-[12px] bg-surface/80 border-y border-white/10 px-3 py-3 sm:rounded-xl sm:border"
        aria-labelledby="leaderboard-panel-title"
        data-sort=${sort}
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="leaderboard-panel-title"
            class="pixel-hegemon text-[24px] leading-none uppercase"
          >
            ${translateText("leaderboard.title")}
          </h2>
          ${styledSelect({
            options: LEADERBOARD_SORTS.map((key) => ({
              value: key,
              label: translateText(SORT_LABELS[key]),
            })),
            value: sort,
            onChange: (value) => this.setSort(value as LeaderboardSort),
            ariaLabel: translateText("leaderboard.sort_by"),
            className: "w-36",
          })}
        </div>
        ${this.renderList(sort, this.lists[sort])}
        <button
          type="button"
          class="mt-auto w-full rounded-lg border border-white/10 bg-white/[0.04] py-2 uppercase text-white/70 transition-colors hover:border-purple-500/50 hover:bg-purple-500/15 hover:text-white"
          data-panel-full
          @click=${() => this.openFullPage()}
        >
          ${translateText("leaderboard.see_full")}
        </button>
      </section>
    `;
  }

  private renderList(sort: LeaderboardSort, data: Loaded): TemplateResult {
    if (data === undefined) {
      return html`<div class="flex justify-center py-8" data-panel-loading>
        <div
          class="size-8 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin"
        ></div>
      </div>`;
    }
    if (data === null) {
      return html`<div
        class="flex flex-col items-center gap-3 py-6 text-center"
        data-panel-error
      >
        <p class="text-white/60">${translateText("leaderboard.unavailable")}</p>
        <o-button
          variant="secondary"
          size="sm"
          .title=${translateText("leaderboard.retry")}
          .disable=${this.loading === sort}
          @click=${() => void this.load(sort, true)}
        ></o-button>
      </div>`;
    }
    const me = data.me ?? null;
    const top = data.entries.slice(0, PANEL_ROWS);
    const listed = me !== null && top.some((e) => e.publicId === me.publicId);
    const pinned = me !== null && me.rank !== null && !listed;
    return html`
      ${top.length === 0
        ? html`<p class="py-6 text-center text-white/50" data-panel-empty>
            ${translateText("leaderboard.empty")}
          </p>`
        : this.renderTable(sort, top, me?.publicId ?? null, pinned ? me : null)}
      ${me === null
        ? html`<p class="text-center text-white/50" data-panel-guest>
            ${translateText("leaderboard.sign_in_hint")}
          </p>`
        : me.rank === null
          ? html`<p class="text-center text-white/50" data-panel-unranked>
              ${translateText("leaderboard.unranked", { name: me.username })}
            </p>`
          : nothing}
    `;
  }

  // The full page's table, narrowed: the same five columns, the sorting
  // column's heading and figures emphasised.
  private renderTable(
    sort: LeaderboardSort,
    top: LeaderboardEntry[],
    me: string | null,
    pinned: NonNullable<LeaderboardResponse["me"]> | null,
  ): TemplateResult {
    const heading = (key: LeaderboardSort) =>
      key === sort ? "text-white/80" : "";
    return html`
      <table class="w-full table-fixed border-collapse" data-panel-list>
        <thead>
          <tr
            class="align-bottom uppercase leading-tight text-white/40 [&>th]:px-1 [&>th]:py-1 [&>th]:font-normal"
          >
            <th class="w-8 text-right">#</th>
            <th class="text-left">${translateText("leaderboard.player")}</th>
            <th class="w-[84px] text-right ${heading("victories")}">
              ${translateText("leaderboard.col_victories")}
            </th>
            <th class="w-[60px] text-right ${heading("reigns")}">
              ${translateText("leaderboard.col_reigns")}
            </th>
            <th class="w-[72px] text-right ${heading("longest")}">
              ${translateText("leaderboard.col_longest")}
            </th>
          </tr>
        </thead>
        <tbody>
          ${top.map((entry) =>
            this.renderRow(sort, entry, entry.publicId === me),
          )}
          ${pinned !== null
            ? html`<tr aria-hidden="true">
                  <td colspan="5" class="py-0.5 text-center text-white/30">
                    …
                  </td>
                </tr>
                ${this.renderRow(sort, pinned as LeaderboardEntry, true, true)}`
            : nothing}
        </tbody>
      </table>
    `;
  }

  private renderRow(
    sort: LeaderboardSort,
    entry: LeaderboardEntry,
    mine: boolean,
    pinned = false,
  ): TemplateResult {
    const medal =
      entry.rank === 1
        ? "text-yellow-300"
        : entry.rank === 2
          ? "text-slate-300"
          : entry.rank === 3
            ? "text-amber-600"
            : "text-white/50";
    const figure = (key: LeaderboardSort) =>
      key === sort ? "text-white" : "text-white/70";
    return html`
      <tr
        class="border-t border-white/5 [&>td]:px-1 [&>td]:py-1.5 ${mine
          ? "bg-malibu-blue/15"
          : "hover:bg-white/5"}"
        data-rank=${String(entry.rank)}
        ?data-mine=${mine}
        ?data-pinned=${pinned}
      >
        <td class="text-right tabular-nums ${medal}">${entry.rank}</td>
        <td>
          <!-- A long name gives way, the "you" tag never does. -->
          <div class="flex min-w-0 items-center">
            <span class="truncate ${mine ? "text-white" : "text-white/90"}"
              >${entry.username}</span
            >
            ${mine
              ? html`<span
                  class="ml-1 shrink-0 rounded bg-malibu-blue/30 px-1 py-0.5 uppercase text-white"
                  >${translateText("leaderboard.you")}</span
                >`
              : nothing}
          </div>
        </td>
        <td
          class="text-right tabular-nums ${figure("victories")}"
          ?data-sorted=${sort === "victories"}
        >
          ${entry.victories}
        </td>
        <td
          class="text-right tabular-nums ${figure("reigns")}"
          ?data-sorted=${sort === "reigns"}
        >
          ${entry.reigns}
        </td>
        <td
          class="text-right tabular-nums ${figure("longest")}"
          ?data-sorted=${sort === "longest"}
        >
          ${entry.longestReign}
        </td>
      </tr>
    `;
  }
}
