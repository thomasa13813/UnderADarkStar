import { html, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { UserMeResponse } from "../../core/ApiSchemas";
import { GameMapType } from "../../core/game/Game";
import { PublicGameInfo, PublicGames } from "../../core/Schemas";
import { JoinLobbyModal } from "../JoinLobbyModal";
import { PublicLobbySocket } from "../LobbySocket";
import { JoinLobbyEvent } from "../Main";
import { UsernameInput } from "../UsernameInput";
import {
  calculateServerTimeOffset,
  getGameModeLabel,
  getSecondsUntilServerTimestamp,
  renderDuration,
  translateText,
} from "../Utils";
import "./baseComponents/Button";
import { BaseModal } from "./BaseModal";
import {
  DEFAULT_FILTERS,
  deleteFilterProfile,
  filterAndSortLobbies,
  flattenLobbies,
  hasFilterProfile,
  loadFilterProfiles,
  LOBBY_MODES,
  LOBBY_SOURCES,
  LobbyFilters,
  LobbyModeFilter,
  lobbyPane,
  LobbySourceFilter,
  NAMED_TEAM_CONFIGS,
  NUMERIC_TEAM_CONFIGS,
  saveFilterProfile,
  SCHEDULED_PANES,
  ScheduledLobbyPane,
} from "./DetailedGameViewFilters";
import {
  canJoinTrustedLobby,
  lobbyCard,
  mapAspectRatios,
  throneCardSubtitle,
  trustRequiredDialog,
  viewerIsSignedIn,
  viewerIsTrusted,
} from "./LobbyCard";
import { modalHeader } from "./ui/ModalHeader";
import { styledSelect } from "./ui/StyledSelect";

/**
 * Slots a queue pane always renders, matching QUEUED_LOBBIES_PER_TYPE on the
 * master: the lobby counting down plus the queue behind it. Holding the slot
 * count fixed keeps the pane's height steady while a started lobby is
 * replaced.
 */
const PANE_SLOTS = 6;

/** Tab key for the overview: every pane at once, side by side. */
const ALL_TAB = "all";

/**
 * Overview columns by pane count. Tailwind only ships a class it can read in
 * the source, so the three widths are spelled out.
 */
const PANE_COLUMNS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
};

/**
 * One pane of the browser: a mode (SCHEDULED_PANES), the lobbies filed under
 * it after the filters, and the "spawning" placeholders it pads itself with.
 *
 * Under a Dark Star every public lobby is a throne filed by its type (L29);
 * with upstream's per-type queues on instead (PUBLIC_LOBBIES=queue), a pane
 * is that type's queue. A pane with nothing in it, filtered or not, is not
 * drawn and has no tab: an empty column reads as a fault, and the team line
 * waits for T5.
 */
interface PaneView {
  type: ScheduledLobbyPane;
  shown: PublicGameInfo[];
  /** Unfiltered count, so a filter hides cards rather than adding placeholders. */
  total: number;
  placeholders: number;
}

function paneViews(all: PublicGameInfo[], shown: PublicGameInfo[]): PaneView[] {
  // The queues refill to PANE_SLOTS, so a queued type pads itself while the
  // master creates the next lobby. Thrones are only ever created to restore a
  // line's floor (L16), so a throne pane shows exactly what exists.
  const queued = all.some(
    (lobby) =>
      lobby.publicGameType !== "throne" && lobby.publicGameType !== "hosted",
  );
  return SCHEDULED_PANES.map((type) => {
    const total = all.filter((lobby) => lobbyPane(lobby) === type).length;
    return {
      type,
      shown: shown.filter((lobby) => lobbyPane(lobby) === type),
      total,
      placeholders: queued ? Math.max(0, PANE_SLOTS - total) : 0,
    };
  }).filter((pane) => pane.total > 0 || pane.placeholders > 0);
}

/** Slot height; cards and the spawning placeholder both fill it exactly. */
const SLOT_CLASS = "h-40";

/** How long a card takes to slide into a freed slot. */
const SLIDE_MS = 220;

type BoundKey =
  | "minJoined"
  | "maxJoined"
  | "minCapacity"
  | "maxCapacity"
  | "minTeamSize"
  | "maxTeamSize";

const CHIP_BASE =
  "px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider " +
  "border transition-colors";
const CHIP_ON = "bg-malibu-blue text-white border-malibu-blue";
const CHIP_OFF =
  "bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white";
const PANE_HEADING =
  "block text-sm font-bold uppercase tracking-widest text-white";
const SECTION_LABEL =
  "block text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5";
const FIELD_CLASS =
  "px-2 py-1.5 rounded-lg bg-black/30 border border-white/10 text-white " +
  "text-xs focus:outline-none focus:border-malibu-blue";
const BUTTON_CLASS =
  "px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider " +
  "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 " +
  "hover:text-white transition-colors";

/**
 * The full lobby browser behind the homepage "More Games" button: every lobby
 * the server advertises (not just the one card per bucket the homepage shows),
 * rendered as the same map cards, with filtering, sorting and saved filter
 * profiles.
 */
@customElement("detailed-view-modal")
export class DetailedGameViewModal extends BaseModal {
  protected routerName = "detailed-view";

  @state() private lobbies: PublicGames | null = null;
  @state() private filters: LobbyFilters = { ...DEFAULT_FILTERS };
  @state() private showFilters = false;
  @state() private profiles: Record<string, LobbyFilters> = {};
  @state() private selectedProfile = "";
  @state() private profileName = "";
  @state() private viewerTrusted: boolean = false;
  @state() private viewerSignedIn: boolean = false;
  @state() private showTrustRequired: boolean = false;
  // No backend-reachability state, deliberately. Every lobby this browser
  // shows arrived over a live game-server socket, and by the reachability
  // rule (GameModeSelector, top of file) the server-list API's health may not
  // gate such a join -- so there is nothing here for the signal to decide.

  private serverTimeOffset = 0;
  private countdownTimer: number | null = null;

  private lobbySocket = new PublicLobbySocket((lobbies) => {
    this.lobbies = lobbies;
    this.serverTimeOffset = calculateServerTimeOffset(lobbies.serverTime);
    for (const lobby of flattenLobbies(lobbies.games)) {
      mapAspectRatios.ensure(lobby.gameConfig?.gameMap as GameMapType, () =>
        this.requestUpdate(),
      );
    }
  });

  constructor() {
    super();
    this.id = "page-detailed-view";
    // Open on the overview rather than the first tab in the strip.
    this.activeTab = ALL_TAB;
  }

  protected override modalConfig() {
    // One tab per pane that has something in it, so no tab opens on nothing.
    const all = flattenLobbies(this.lobbies?.games);
    return {
      tabs: [
        ...paneViews(all, all).map((pane) => ({
          key: pane.type,
          label: translateText(`detailed_view.pane_${pane.type}`),
        })),
        { key: ALL_TAB, label: translateText("detailed_view.tab_all") },
      ],
    };
  }

  protected override onOpen(): void {
    this.profiles = loadFilterProfiles();
    void this.lobbySocket.start();
    // Countdowns are derived from server timestamps, so a plain repaint keeps
    // them ticking between socket updates.
    this.countdownTimer ??= window.setInterval(
      () => this.requestUpdate(),
      1000,
    );
  }

  protected override onClose(): void {
    this.lobbySocket.stop();
    this.lobbies = null;
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("userMeResponse", this.onUserMe);
  }

  disconnectedCallback() {
    document.removeEventListener("userMeResponse", this.onUserMe);
    this.onClose();
    super.disconnectedCallback();
  }

  private onUserMe = (e: Event) => {
    const me = (e as CustomEvent<UserMeResponse | false>).detail;
    this.viewerSignedIn = viewerIsSignedIn(me);
    this.viewerTrusted = viewerIsTrusted(me);
  };

  // ---- Slot animation ----
  //
  // When the lobby at the top of a pane starts, the one queued behind it takes
  // its slot. Lit reuses the keyed DOM node, so the move is instant; these two
  // hooks replay it as a slide (FLIP): record each slot's position before the
  // render, then animate from the old position to the new one after it.

  private slotTops = new Map<string, number>();

  private slotElements(): HTMLElement[] {
    return Array.from(this.querySelectorAll<HTMLElement>("[data-lobby-slot]"));
  }

  protected override willUpdate(): void {
    super.willUpdate();
    this.slotTops = new Map(
      this.slotElements().map((el) => [
        el.dataset.lobbySlot ?? "",
        el.getBoundingClientRect().top,
      ]),
    );
  }

  protected updated(): void {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    for (const el of this.slotElements()) {
      const previousTop = this.slotTops.get(el.dataset.lobbySlot ?? "");
      if (previousTop === undefined) continue;
      const delta = previousTop - el.getBoundingClientRect().top;
      // Sub-pixel shifts are layout noise, not a slot change.
      if (Math.abs(delta) < 1) continue;
      el.style.transition = "none";
      el.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        el.style.transition = `transform ${SLIDE_MS}ms ease-out`;
        el.style.transform = "";
      });
    }
  }

  createRenderRoot() {
    return this;
  }

  protected renderHeaderSlot() {
    const count = this.activeFilterCount();
    return modalHeader({
      title: translateText("detailed_view.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      rightContent: html`<o-button
        variant=${this.showFilters ? "primary" : "secondary"}
        size="sm"
        title=${count > 0
          ? translateText("detailed_view.filters_with_count", { count })
          : translateText("detailed_view.filters")}
        @click=${() => (this.showFilters = !this.showFilters)}
      ></o-button>`,
    });
  }

  protected renderBody(tab: string): TemplateResult {
    if (this.lobbies === null) {
      return this.renderLoadingSpinner();
    }

    const all = flattenLobbies(this.lobbies.games);
    const shown = filterAndSortLobbies(all, this.filters);
    const panes = paneViews(all, shown);
    const hosted = shown.filter((lobby) => lobbyPane(lobby) === "hosted");
    // The tab's pane may have emptied since it was chosen (its last throne
    // retired, L20); fall back to the overview rather than a blank page.
    const current = panes.find((pane) => pane.type === tab);

    let body: TemplateResult;
    if (all.length === 0) {
      // Nothing advertised at all: say so plainly, not "match your filters".
      body = html`<p class="py-12 text-center text-sm text-white/50">
        ${translateText("detailed_view.pane_empty")}
      </p>`;
    } else if (shown.length === 0) {
      body = html`<p class="py-12 text-center text-sm text-white/50">
        ${translateText("detailed_view.no_lobbies")}
      </p>`;
    } else if (current !== undefined) {
      body = this.renderTypeTab(current);
    } else {
      // One pane per mode with lobbies, cards stacked within it; hosted
      // lobbies alone (no thrones advertised) get just their own row.
      body = html`
        ${panes.length > 0
          ? html`<div
              class="grid grid-cols-1 ${PANE_COLUMNS[panes.length] ??
              ""} gap-4 items-start"
            >
              ${panes.map((pane) => this.renderPane(pane))}
            </div>`
          : nothing}
        ${this.renderHostedPane(hosted)}
      `;
    }

    return html`
      <div class="custom-scrollbar p-4 lg:p-6 flex flex-col gap-4">
        ${this.showTrustRequired
          ? trustRequiredDialog(
              this.viewerSignedIn,
              () => (this.showTrustRequired = false),
            )
          : nothing}
        ${this.showFilters ? this.renderFilterPanel() : nothing} ${body}
      </div>
    `;
  }

  /**
   * A single mode's tab: the same slots as its pane in the overview, two
   * across instead of the one narrow column it gets there.
   */
  private renderTypeTab(pane: PaneView) {
    if (pane.shown.length === 0 && pane.placeholders === 0) {
      return html`<p class="py-12 text-center text-sm text-white/50">
        ${translateText("detailed_view.pane_empty")}
      </p>`;
    }
    return html`
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        ${this.renderSlots(pane.shown, pane.placeholders)}
      </div>
    `;
  }

  // ---- Lobby panes ----

  /** Pane heading and its count as one message, so translators own the format. */
  private paneHeading(name: string, count: number): string {
    return translateText("detailed_view.pane_heading", { name, count });
  }

  /**
   * A queue pane always fills PANE_SLOTS, so its height never changes as
   * lobbies come and go: the queued lobby slides up into the started one's
   * slot and a "spawning" placeholder holds the slot until the master creates
   * its replacement. A throne pane has no placeholders and lists what exists.
   * The dashed box only appears when a filter hid every card: a pane with
   * nothing in it at all is not drawn (paneViews).
   */
  private renderPane(pane: PaneView) {
    const { shown, placeholders } = pane;
    return html`
      <section class="flex flex-col gap-2 min-w-0" data-pane=${pane.type}>
        <h3 class="${PANE_HEADING}">
          ${this.paneHeading(
            translateText(`detailed_view.pane_${pane.type}`),
            shown.length,
          )}
        </h3>
        <div class="flex flex-col gap-4">
          ${shown.length === 0 && placeholders === 0
            ? html`<p
                class="py-6 text-center text-xs text-white/30 rounded-xl border border-dashed border-white/10"
              >
                ${translateText("detailed_view.pane_empty")}
              </p>`
            : nothing}
          ${this.renderSlots(shown, placeholders)}
        </div>
      </section>
    `;
  }

  /** Keyed lobby slots, then placeholders for the lobbies still to come. */
  private renderSlots(lobbies: PublicGameInfo[], placeholders: number) {
    return html`
      ${repeat(
        lobbies,
        (lobby) => lobby.gameID,
        (lobby) =>
          html`<div class="${SLOT_CLASS}" data-lobby-slot=${lobby.gameID}>
            ${this.renderCard(lobby)}
          </div>`,
      )}
      ${Array.from({ length: placeholders }, () => this.renderSpawningSlot())}
    `;
  }

  /** Placeholder for a lobby the master hasn't created yet. */
  private renderSpawningSlot() {
    return html`
      <div
        class="${SLOT_CLASS} flex flex-col items-center justify-center gap-3 rounded-2xl bg-surface border border-white/10"
      >
        <span
          class="w-8 h-8 border-[3px] border-blue-500/30 border-t-blue-500 rounded-full animate-spin"
        ></span>
        <span class="text-xs uppercase tracking-widest text-white/50">
          ${translateText("detailed_view.spawning")}
        </span>
      </div>
    `;
  }

  /**
   * Subscriber-hosted lobbies don't belong to any mode's pane, so they get
   * their own row below the panes — and only when some exist.
   */
  private renderHostedPane(lobbies: PublicGameInfo[]) {
    if (lobbies.length === 0) return nothing;
    return html`
      <section class="flex flex-col gap-2">
        <h3 class="${PANE_HEADING}">
          ${this.paneHeading(
            translateText("detailed_view.pane_hosted"),
            lobbies.length,
          )}
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          ${this.renderSlots(lobbies, 0)}
        </div>
      </section>
    `;
  }

  // ---- Lobby cards ----

  private renderCard(lobby: PublicGameInfo) {
    const config = lobby.gameConfig;
    if (!config) return nothing;
    return lobbyCard({
      lobby,
      subtitle:
        lobby.throne !== undefined
          ? throneCardSubtitle(lobby.throne, getGameModeLabel(config))
          : getGameModeLabel(config),
      timeDisplay: this.timeDisplay(lobby),
      timeDisplayUppercase: lobby.startsAt === undefined,
      heightClass: "h-full",
      viewerTrusted: this.viewerTrusted,
      onClick: () => this.join(lobby),
    });
  }

  private timeDisplay(lobby: PublicGameInfo): string {
    // A throne's round in progress: the card is the Watch button (§4 step 5).
    if (lobby.throne?.running === true) {
      return translateText("throne.watch");
    }
    if (lobby.startsAt === undefined) {
      // A throne has no queue; it stands in its line (L16-L19): the head
      // waits for players, then counts down; the rest show how many thrones
      // are ahead; one whose winner is still choosing says so.
      if (lobby.throne !== undefined) {
        const until = lobby.throne.reservationUntil;
        if (
          until !== undefined &&
          getSecondsUntilServerTimestamp(until, this.serverTimeOffset) > 0
        ) {
          return translateText("throne.choosing");
        }
        const place = lobby.throne.place;
        if (place !== undefined && place > 1) {
          return translateText("throne.place_ahead", {
            count: String(place - 1),
          });
        }
        return translateText("public_lobby.waiting_for_players");
      }
      if (lobby.publicGameType === "hosted") {
        return translateText("public_lobby.waiting_for_players");
      }
      // Use the full server queue so filtering doesn't renumber waiting lobbies.
      const queue = this.lobbies?.games[lobby.publicGameType]?.filter(
        (candidate) => candidate.startsAt === undefined,
      );
      const position =
        (queue?.findIndex((candidate) => candidate.gameID === lobby.gameID) ??
          -1) + 1;
      return translateText("detailed_view.queue_position", { position });
    }
    const seconds = getSecondsUntilServerTimestamp(
      lobby.startsAt,
      this.serverTimeOffset,
    );
    return seconds > 0
      ? renderDuration(seconds)
      : translateText("public_lobby.starting_game");
  }

  // ---- Filter panel ----

  private renderFilterPanel() {
    return html`
      <div
        class="flex flex-col gap-4 p-4 rounded-2xl bg-black/20 border border-white/10"
      >
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          ${this.renderChipGroup(
            translateText("detailed_view.mode"),
            LOBBY_MODES.map((mode) => ({
              value: mode,
              label: translateText(`detailed_view.mode_${mode}`),
              active: this.filters.modes.includes(mode),
            })),
            (value) =>
              this.patchFilters({
                modes: toggle(this.filters.modes, value as LobbyModeFilter),
              }),
          )}
          ${this.renderChipGroup(
            translateText("detailed_view.source"),
            LOBBY_SOURCES.map((source) => ({
              value: source,
              label: translateText(`detailed_view.source_${source}`),
              active: this.filters.sources.includes(source),
            })),
            (value) =>
              this.patchFilters({
                sources: toggle(
                  this.filters.sources,
                  value as LobbySourceFilter,
                ),
              }),
          )}
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          ${this.renderChipGroup(
            translateText("detailed_view.per_team"),
            NAMED_TEAM_CONFIGS.map((name) => ({
              value: name as string,
              label: translateText(
                `detailed_view.layout_${name.toLowerCase()}`,
              ),
              active: this.filters.teamConfigs.includes(name),
            })),
            (value) => this.toggleTeamConfig(value),
          )}
          ${this.renderChipGroup(
            translateText("detailed_view.team_count"),
            NUMERIC_TEAM_CONFIGS.map((count) => ({
              value: count,
              label: count,
              active: this.filters.teamConfigs.includes(count),
            })),
            (value) => this.toggleTeamConfig(value),
          )}
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          ${this.renderRange(
            translateText("detailed_view.joined_players"),
            "minJoined",
            "maxJoined",
          )}
          ${this.renderRange(
            translateText("detailed_view.capacity"),
            "minCapacity",
            "maxCapacity",
          )}
          ${this.renderRange(
            translateText("detailed_view.team_size"),
            "minTeamSize",
            "maxTeamSize",
          )}
        </div>

        <div class="flex items-center justify-between gap-3 flex-wrap">
          <label
            class="flex items-center gap-2 text-xs text-white/70 cursor-pointer"
          >
            <input
              type="checkbox"
              class="w-4 h-4 accent-malibu-blue"
              .checked=${this.filters.hideEmpty}
              @change=${(e: Event) =>
                this.patchFilters({
                  hideEmpty: (e.target as HTMLInputElement).checked,
                })}
            />
            ${translateText("detailed_view.hide_empty")}
          </label>
          <button @click=${() => this.resetFilters()} class="${BUTTON_CLASS}">
            ${translateText("detailed_view.reset")}
          </button>
        </div>

        ${this.renderProfiles()}
      </div>
    `;
  }

  private renderChipGroup(
    label: string,
    options: { value: string; label: string; active: boolean }[],
    onToggle: (value: string) => void,
  ) {
    return html`
      <div>
        <span class="${SECTION_LABEL}">${label}</span>
        <div class="flex flex-wrap gap-1.5">
          ${options.map(
            (option) =>
              html`<button
                @click=${() => onToggle(option.value)}
                aria-pressed=${option.active ? "true" : "false"}
                class="${CHIP_BASE} ${option.active ? CHIP_ON : CHIP_OFF}"
              >
                ${option.label}
              </button>`,
          )}
        </div>
      </div>
    `;
  }

  private renderRange(label: string, minKey: BoundKey, maxKey: BoundKey) {
    return html`
      <div>
        <span class="${SECTION_LABEL}">${label}</span>
        <div class="flex items-center gap-2">
          <input
            type="number"
            min="0"
            class="${FIELD_CLASS} w-full min-w-0 text-center"
            aria-label="${label} ${translateText("detailed_view.min")}"
            placeholder=${translateText("detailed_view.min")}
            .value=${boundValue(this.filters[minKey])}
            @change=${(e: Event) => this.setBound(minKey, e)}
          />
          <span class="text-xs text-white/30">–</span>
          <input
            type="number"
            min="0"
            class="${FIELD_CLASS} w-full min-w-0 text-center"
            aria-label="${label} ${translateText("detailed_view.max")}"
            placeholder=${translateText("detailed_view.max")}
            .value=${boundValue(this.filters[maxKey])}
            @change=${(e: Event) => this.setBound(maxKey, e)}
          />
        </div>
      </div>
    `;
  }

  private renderProfiles() {
    const names = Object.keys(this.profiles).sort((a, b) => a.localeCompare(b));
    return html`
      <div class="pt-3 border-t border-white/10">
        <span class="${SECTION_LABEL}"
          >${translateText("detailed_view.profiles")}</span
        >
        <div class="flex flex-wrap items-center gap-2">
          ${styledSelect({
            options: [
              {
                value: "",
                label: translateText("detailed_view.no_profile"),
              },
              ...names.map((name) => ({ value: name, label: name })),
            ],
            value: this.selectedProfile,
            onChange: (value) => this.applyProfile(value),
            ariaLabel: translateText("detailed_view.profiles"),
            className: "flex-1 min-w-[8rem]",
          })}
          <input
            type="text"
            maxlength="32"
            class="${FIELD_CLASS} flex-1 min-w-[8rem]"
            placeholder=${translateText("detailed_view.profile_name")}
            aria-label=${translateText("detailed_view.profile_name")}
            .value=${this.profileName}
            @input=${(e: Event) =>
              (this.profileName = (e.target as HTMLInputElement).value)}
          />
          <button @click=${() => this.saveProfile()} class="${BUTTON_CLASS}">
            ${translateText("detailed_view.save_profile")}
          </button>
          <button
            @click=${() => this.deleteProfile()}
            ?disabled=${this.selectedProfile === ""}
            class="${BUTTON_CLASS} ${this.selectedProfile === ""
              ? "opacity-40 cursor-not-allowed"
              : ""}"
          >
            ${translateText("detailed_view.delete_profile")}
          </button>
        </div>
      </div>
    `;
  }

  // ---- Actions ----

  /** How many filters are narrowing the list, for the Filters button badge. */
  private activeFilterCount(): number {
    const f = this.filters;
    const bounds: (number | null)[] = [
      f.minJoined,
      f.maxJoined,
      f.minCapacity,
      f.maxCapacity,
      f.minTeamSize,
      f.maxTeamSize,
    ];
    return (
      (f.modes.length > 0 ? 1 : 0) +
      (f.sources.length > 0 ? 1 : 0) +
      (f.teamConfigs.length > 0 ? 1 : 0) +
      (f.hideEmpty ? 1 : 0) +
      bounds.filter((b) => b !== null).length
    );
  }

  private toggleTeamConfig(value: string) {
    this.patchFilters({ teamConfigs: toggle(this.filters.teamConfigs, value) });
  }

  private patchFilters(patch: Partial<LobbyFilters>) {
    this.filters = { ...this.filters, ...patch };
  }

  private setBound(key: BoundKey, event: Event) {
    const raw = (event.target as HTMLInputElement).value.trim();
    if (raw === "") {
      this.patchFilters({ [key]: null } as Partial<LobbyFilters>);
      return;
    }
    // Number() (not parseInt) so "12abc" is rejected outright rather than
    // silently read as 12; fractions floor, matching normalizeFilters.
    const parsed = Number(raw);
    this.patchFilters({
      [key]: Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null,
    } as Partial<LobbyFilters>);
  }

  private resetFilters() {
    this.filters = { ...DEFAULT_FILTERS };
    this.selectedProfile = "";
  }

  private applyProfile(name: string) {
    this.selectedProfile = name;
    if (name === "") return;
    const profile = hasFilterProfile(this.profiles, name)
      ? this.profiles[name]
      : undefined;
    if (profile) {
      this.filters = { ...profile };
      this.profileName = name;
    }
  }

  private saveProfile() {
    const name = this.profileName.trim();
    if (name === "") return;
    this.profiles = saveFilterProfile(name, this.filters);
    this.selectedProfile = hasFilterProfile(this.profiles, name)
      ? name
      : this.selectedProfile;
  }

  private deleteProfile() {
    if (this.selectedProfile === "") return;
    this.profiles = deleteFilterProfile(this.selectedProfile);
    this.selectedProfile = "";
  }

  // Silent backstop, mirroring the homepage buttons: an invalid username can't
  // start a game, and the input itself surfaces the reason.
  private canPlay(): boolean {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    return usernameInput ? usernameInput.canPlay() : true;
  }

  private join(lobby: PublicGameInfo) {
    if (!this.canPlay()) return;
    // Before close(): the popup explains how to become trusted, so it must
    // stay on screen with the browser rather than vanish with it.
    if (!canJoinTrustedLobby(lobby, this.viewerTrusted)) {
      this.showTrustRequired = true;
      return;
    }
    this.close();

    // Hosted lobbies are private games a subscriber listed publicly: joining
    // one goes through the join modal's tracking flow, not the public path.
    if (lobby.publicGameType === "hosted") {
      (
        document.querySelector("join-lobby-modal") as JoinLobbyModal | null
      )?.open({ lobbyId: lobby.gameID });
      return;
    }

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: lobby.gameID,
          source: "public",
          publicLobbyInfo: lobby,
          // Watching a throne's round in progress: the server seats a late
          // joiner as a spectator anyway; asking up front skips the attempt.
          spectator: lobby.throne?.running === true ? true : undefined,
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

function toggle<T extends string>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}

function boundValue(value: number | null): string {
  return value === null ? "" : String(value);
}
