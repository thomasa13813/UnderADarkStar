import { html, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  LEADERBOARD_SORTS,
  LeaderboardEntry,
  LeaderboardResponse,
  LeaderboardSort,
} from "../core/ApiSchemas";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { styledSelect } from "./components/ui/StyledSelect";
import { fetchLeaderboard } from "./LeaderboardApi";
import { translateText } from "./Utils";

// Under a Dark Star: the leaderboard page (docs/DarkStar-Accounts.md §6,
// accounts step B5, one list since 2026-10-17). An inline page beside Play:
// the top 100 under the chosen sort (Victories by default, Reigns or Longest
// reign), every row carrying all three numbers. A signed-in player's own
// row is highlighted in the list, or pinned under it when they are outside
// the top 100; a player with nothing recorded yet is told how to get on the
// list; a guest is told to sign in. The list is read on every open (the API
// holds it for a minute) and once per sort chosen after that.

type Loaded = LeaderboardResponse | null | undefined;

const SORT_LABELS: Record<LeaderboardSort, string> = {
  victories: "leaderboard.col_victories",
  reigns: "leaderboard.col_reigns",
  longest: "leaderboard.col_longest",
};

@customElement("leaderboard-modal")
export class LeaderboardModal extends BaseModal {
  protected routerName = "leaderboard";

  @state() private sort: LeaderboardSort = "victories";
  // Per sort: the answer, null when the API could not be reached, or
  // undefined while nothing has been asked for yet.
  @state() private lists: Partial<Record<LeaderboardSort, Loaded>> = {};
  @state() private loading: LeaderboardSort | null = null;
  // Answers to a request older than this are dropped (the page closed and
  // reopened while a load was in flight).
  private generation = 0;

  protected override onOpen(): void {
    // Fresh on every open: a round may have landed since last time, and the
    // own row changes with sign-in and sign-out.
    this.lists = {};
    this.generation++;
    void this.load(this.sort);
  }

  protected override onClose(): void {
    this.generation++;
    this.loading = null;
  }

  // The sort control's choice, kept while the page is open and across
  // openings in one session.
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

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("leaderboard.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody(): TemplateResult {
    const sort = this.sort;
    return html`
      <div class="flex flex-col gap-4 px-2 py-3 sm:px-4" data-sort=${sort}>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <p class="min-w-48 flex-1 text-xs text-white/50">
            ${translateText(`leaderboard.about_${sort}`)}
          </p>
          <label class="flex items-center gap-2 text-xs text-white/60">
            <span>${translateText("leaderboard.sort_by")}</span>
            ${styledSelect({
              options: LEADERBOARD_SORTS.map((key) => ({
                value: key,
                label: translateText(SORT_LABELS[key]),
              })),
              value: sort,
              onChange: (value) => this.setSort(value as LeaderboardSort),
              ariaLabel: translateText("leaderboard.sort_by"),
              className: "w-40",
            })}
          </label>
        </div>
        ${this.renderList(sort, this.lists[sort])}
      </div>
    `;
  }

  private renderList(sort: LeaderboardSort, data: Loaded): TemplateResult {
    if (data === undefined) {
      return this.renderLoadingSpinner();
    }
    if (data === null) {
      return html`
        <div
          class="flex flex-col items-center gap-4 py-12 text-center"
          data-list-error
        >
          <p class="text-sm text-white/60">
            ${translateText("leaderboard.unavailable")}
          </p>
          <o-button
            variant="secondary"
            size="sm"
            .title=${translateText("leaderboard.retry")}
            .disable=${this.loading === sort}
            @click=${() => void this.load(sort, true)}
          ></o-button>
        </div>
      `;
    }
    return html`
      ${data.entries.length === 0
        ? html`<p
            class="py-10 text-center text-sm text-white/50"
            data-list-empty
          >
            ${translateText("leaderboard.empty")}
          </p>`
        : this.renderTable(sort, data)}
      ${this.renderOwnStanding(data)}
    `;
  }

  private renderTable(
    sort: LeaderboardSort,
    data: LeaderboardResponse,
  ): TemplateResult {
    const me = data.me?.publicId ?? null;
    const listed = me !== null && data.entries.some((e) => e.publicId === me);
    const pinned =
      data.me !== null &&
      data.me !== undefined &&
      data.me.rank !== null &&
      !listed;
    const heading = (key: LeaderboardSort) =>
      key === sort ? "text-white/80" : "";
    return html`
      <table class="w-full border-collapse text-sm" data-list-table>
        <thead>
          <tr
            class="text-[11px] uppercase tracking-wider text-white/40 [&>th]:px-2 [&>th]:py-2 [&>th]:font-bold"
          >
            <th class="w-12 text-right">
              ${translateText("leaderboard.rank")}
            </th>
            <th class="text-left">${translateText("leaderboard.player")}</th>
            <th class="w-16 text-right ${heading("victories")}">
              ${translateText("leaderboard.col_victories")}
            </th>
            <th class="w-16 text-right ${heading("reigns")}">
              ${translateText("leaderboard.col_reigns")}
            </th>
            <th class="w-20 text-right ${heading("longest")}">
              ${translateText("leaderboard.col_longest")}
            </th>
          </tr>
        </thead>
        <tbody>
          ${data.entries.map((entry) =>
            this.renderRow(sort, entry, entry.publicId === me),
          )}
          ${pinned
            ? html`<tr aria-hidden="true">
                  <td colspan="5" class="py-1 text-center text-white/30">…</td>
                </tr>
                ${this.renderRow(sort, data.me as LeaderboardEntry, true, true)}`
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
    const figure = (key: LeaderboardSort) =>
      key === sort ? "font-semibold text-white" : "text-white/70";
    return html`
      <tr
        class="border-t border-white/5 [&>td]:px-2 [&>td]:py-2 ${mine
          ? "bg-malibu-blue/15"
          : "hover:bg-white/5"}"
        data-rank=${String(entry.rank)}
        ?data-mine=${mine}
        ?data-pinned=${pinned}
      >
        <td class="text-right tabular-nums text-white/60">${entry.rank}</td>
        <td class="max-w-0 truncate">
          <span class=${mine ? "text-white" : "text-white/90"}
            >${entry.username}</span
          >
          ${mine
            ? html`<span
                class="ml-2 rounded bg-malibu-blue/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                >${translateText("leaderboard.you")}</span
              >`
            : nothing}
        </td>
        <td class="text-right tabular-nums ${figure("victories")}">
          ${entry.victories}
        </td>
        <td class="text-right tabular-nums ${figure("reigns")}">
          ${entry.reigns}
        </td>
        <td class="text-right tabular-nums ${figure("longest")}">
          ${entry.longestReign}
        </td>
      </tr>
    `;
  }

  // Under the list: a guest is told to sign in; a signed-in player with
  // nothing recorded is told how to get on the list. A ranked player's
  // standing is in the table (highlighted or pinned).
  private renderOwnStanding(data: LeaderboardResponse): TemplateResult {
    const me = data.me ?? null;
    if (me === null) {
      return html`<p class="text-center text-xs text-white/50" data-list-guest>
        ${translateText("leaderboard.sign_in_hint")}
      </p>`;
    }
    if (me.rank === null) {
      return html`<p
        class="text-center text-xs text-white/50"
        data-list-unranked
      >
        ${translateText("leaderboard.unranked", { name: me.username })}
      </p>`;
    }
    return html``;
  }
}
