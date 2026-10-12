import { html, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  LEADERBOARD_BOARDS,
  LeaderboardBoard,
  LeaderboardEntry,
  LeaderboardResponse,
} from "../core/ApiSchemas";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { fetchLeaderboard } from "./LeaderboardApi";
import { translateText } from "./Utils";

// Under a Dark Star: the leaderboard page (docs/DarkStar-Accounts.md §6,
// accounts step B5). An inline page beside Play with two tabs, Reigns and
// Longest reign, each the top 100 of its board. A signed-in player's own
// row is highlighted in the list, or pinned under it when they are outside
// the top 100; a player with no reign yet is told how to get one; a guest is
// told to sign in. The board is read on every open (the API holds it for a
// minute) and once per tab visit after that.

type Loaded = LeaderboardResponse | null | undefined;

@customElement("leaderboard-modal")
export class LeaderboardModal extends BaseModal {
  protected routerName = "leaderboard";

  // Per board: the answer, null when the API could not be reached, or
  // undefined while nothing has been asked for yet.
  @state() private boards: Partial<Record<LeaderboardBoard, Loaded>> = {};
  @state() private loading: LeaderboardBoard | null = null;
  // Answers to a request older than this are dropped (a tab switched while
  // a load was in flight, the page closed and reopened).
  private generation = 0;

  protected override modalConfig() {
    return {
      tabs: LEADERBOARD_BOARDS.map((board) => ({
        key: board,
        label: translateText(`leaderboard.tab_${board}`),
      })),
    };
  }

  protected override onOpen(): void {
    // Fresh on every open: a reign may have landed since last time, and the
    // own row changes with sign-in and sign-out.
    this.boards = {};
    this.generation++;
  }

  protected override onTabEnter(key: string): void {
    void this.load(key as LeaderboardBoard);
  }

  protected override onClose(): void {
    this.generation++;
    this.loading = null;
  }

  private async load(board: LeaderboardBoard, force = false): Promise<void> {
    if (!force && this.boards[board] !== undefined) return;
    const generation = this.generation;
    this.loading = board;
    const answer = await fetchLeaderboard(board);
    if (generation !== this.generation) return;
    this.boards = { ...this.boards, [board]: answer };
    if (this.loading === board) this.loading = null;
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("leaderboard.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody(tab: string): TemplateResult {
    const board = tab as LeaderboardBoard;
    const data = this.boards[board];
    if (data === undefined) {
      return this.renderLoadingSpinner();
    }
    if (data === null) {
      return html`
        <div
          class="flex flex-col items-center gap-4 py-12 text-center"
          data-board-error
        >
          <p class="text-sm text-white/60">
            ${translateText("leaderboard.unavailable")}
          </p>
          <o-button
            variant="secondary"
            size="sm"
            .title=${translateText("leaderboard.retry")}
            .disable=${this.loading === board}
            @click=${() => void this.load(board, true)}
          ></o-button>
        </div>
      `;
    }
    return html`
      <div class="flex flex-col gap-4 px-2 py-3 sm:px-4" data-board=${board}>
        <p class="text-xs text-white/50">
          ${translateText(`leaderboard.about_${board}`)}
        </p>
        ${data.entries.length === 0
          ? html`<p
              class="py-10 text-center text-sm text-white/50"
              data-board-empty
            >
              ${translateText("leaderboard.empty")}
            </p>`
          : this.renderTable(board, data)}
        ${this.renderOwnStanding(board, data)}
      </div>
    `;
  }

  private renderTable(
    board: LeaderboardBoard,
    data: LeaderboardResponse,
  ): TemplateResult {
    const me = data.me?.publicId ?? null;
    const listed = me !== null && data.entries.some((e) => e.publicId === me);
    const pinned =
      data.me !== null &&
      data.me !== undefined &&
      data.me.rank !== null &&
      !listed;
    return html`
      <table class="w-full border-collapse text-sm" data-board-table>
        <thead>
          <tr
            class="text-[11px] uppercase tracking-wider text-white/40 [&>th]:px-2 [&>th]:py-2 [&>th]:font-bold"
          >
            <th class="w-12 text-right">
              ${translateText("leaderboard.rank")}
            </th>
            <th class="text-left">${translateText("leaderboard.player")}</th>
            <th class="w-20 text-right">
              ${translateText("leaderboard.col_reigns")}
            </th>
            <th class="w-24 text-right">
              ${translateText("leaderboard.col_longest")}
            </th>
            <th class="hidden w-40 text-right sm:table-cell">
              ${translateText("leaderboard.col_split")}
            </th>
          </tr>
        </thead>
        <tbody>
          ${data.entries.map((entry) =>
            this.renderRow(board, entry, entry.publicId === me),
          )}
          ${pinned
            ? html`<tr aria-hidden="true">
                  <td colspan="5" class="py-1 text-center text-white/30">…</td>
                </tr>
                ${this.renderRow(
                  board,
                  data.me as LeaderboardEntry,
                  true,
                  true,
                )}`
            : nothing}
        </tbody>
      </table>
    `;
  }

  private renderRow(
    board: LeaderboardBoard,
    entry: LeaderboardEntry,
    mine: boolean,
    pinned = false,
  ): TemplateResult {
    const lead = (which: LeaderboardBoard) =>
      which === board ? "font-semibold text-white" : "text-white/70";
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
        <td class="text-right tabular-nums ${lead("reigns")}">
          ${entry.reigns}
        </td>
        <td class="text-right tabular-nums ${lead("longest")}">
          ${entry.longestReign}
        </td>
        <td class="hidden text-right text-xs text-white/50 sm:table-cell">
          ${translateText("leaderboard.split", {
            taken: entry.thronesTaken,
            held: entry.roundsHeld,
          })}
        </td>
      </tr>
    `;
  }

  // Under the list: a guest is told to sign in; a signed-in player with no
  // reign is told how to get one. A ranked player's standing is in the
  // table (highlighted or pinned).
  private renderOwnStanding(
    board: LeaderboardBoard,
    data: LeaderboardResponse,
  ): TemplateResult {
    void board;
    const me = data.me ?? null;
    if (me === null) {
      return html`<p class="text-center text-xs text-white/50" data-board-guest>
        ${translateText("leaderboard.sign_in_hint")}
      </p>`;
    }
    if (me.rank === null) {
      return html`<p
        class="text-center text-xs text-white/50"
        data-board-unranked
      >
        ${translateText("leaderboard.unranked", { name: me.username })}
      </p>`;
    }
    return html``;
  }
}
