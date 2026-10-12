import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  homeHref,
  throneModifierLabel,
  translateText,
} from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { GameMapType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { PublicGames, TeamCountConfig } from "../../../core/Schemas";
import {
  THRONE_MAX_MODIFIERS,
  THRONE_MODIFIER_WHITELIST,
  ThroneModifier,
  throneModifiersConflict,
} from "../../../core/ThroneModifiers";
import { THRONE_TEAM_SPLITS } from "../../../core/ThroneTeams";
import { ClientEnv } from "../../ClientEnv";
import "../../components/map/MapPicker";
import { Controller } from "../../Controller";
import { PublicLobbySocket } from "../../LobbySocket";
import { PlaySoundEffectEvent } from "../../sound/Sounds";
import { findLobby, lineHead, placeLabel } from "../../ThroneLine";
import { currentThrone } from "../../ThroneState";
import {
  NewLobbyEvent,
  SendThronePickEvent,
  SendWinnerEvent,
} from "../../Transport";
import { GameView } from "../../view";

// Under a Dark Star: the winner's Next-round panel on the win screen
// (docs/DarkStar-Lobbies.md §4 step 4, §5.5). The master opened the throne's
// next lobby and reserved its seat for the winner until `until`; here they
// pick its map and keep the throne or step down, then jump to the lobby.
// Everyone else on a throne round gets the line panel (L27): stay with this
// throne, shown its place in line live, or join the head of the line, the
// next round of the same mode to launch. Doing nothing stays. A private
// lobby's successor is a plain Join button beside Exit and Spectate.
interface ThronePanel {
  gameID: string;
  openedAt: number;
  until: number;
}

@customElement("win-modal")
export class WinModal extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  private hasShownDeathModal = false;

  @state()
  isVisible = false;

  @state()
  private isWin = false;

  @state() private throne: ThronePanel | null = null;
  // The successor lobby announced to a non-winner (the host reused the
  // private lobby, or a throne opened its next round): a Join button here.
  @state() private nextLobbyID: string | null = null;
  // The map the winner picked; undefined is a random map.
  @state() private pickedMap: GameMapType | undefined = undefined;
  @state() private pickSent = false;
  // Special thrones: the modifiers chosen so far (§5.4); none keeps the
  // lobby's rolled set.
  @state() private pickedModifiers: ThroneModifier[] = [];
  // Team thrones: the split chosen (L30); undefined keeps the lobby's.
  @state() private pickedTeams: TeamCountConfig | undefined = undefined;
  // Repaints the window bar once a second while the panel is up.
  @state() private windowTick = 0;
  private windowTimer: number | null = null;
  // The line panel's live view of the public list (L27): the master stamps
  // each throne's place on it, and nothing else carries that. Opened while
  // the panel is up, closed with it.
  @state() private line: PublicGames["games"] | null = null;
  private lineSocket: PublicLobbySocket | null = null;
  // Our throne's next round was listed at least once: when it is gone after
  // that, the throne was retired under us (L20), and only the head remains.
  private lineSeenOwn = false;

  private _title: string;

  // Override to prevent shadow DOM creation
  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
  }

  render() {
    return html`
      <div
        class="${this.isVisible
          ? "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800/70 p-4 md:p-6 shrink-0 rounded-lg z-[10010] shadow-2xl backdrop-blur-xs text-white w-[min(90vw,700px)] max-w-[90%] max-h-[90dvh] overflow-hidden flex flex-col"
          : "hidden"}"
      >
        <h2 class="m-0 mb-4 text-[26px] text-center text-white shrink-0">
          ${this._title || ""}
        </h2>
        ${this.renderThronePanel()} ${this.renderLinePanel()}
        <div class="mt-4 flex justify-between gap-2.5 shrink-0">
          <o-button
            variant="primary"
            width="block"
            class="flex-1"
            translationKey="win_modal.exit"
            @click=${this._handleExit}
          ></o-button>
          <o-button
            variant="primary"
            width="block"
            class="flex-1"
            .title=${this.game?.myPlayer()?.isAlive()
              ? translateText("win_modal.keep")
              : translateText("win_modal.spectate")}
            @click=${this.hide}
          ></o-button>
          ${this.nextLobbyID !== null && !this.onThroneRound()
            ? html`<o-button
                variant="primary"
                width="block"
                class="flex-1"
                translationKey="win_modal.join_next"
                data-join-next
                @click=${() => this.joinNext()}
              ></o-button>`
            : nothing}
        </div>
      </div>
    `;
  }

  // A non-winner's successor on a public throne: the line panel, not a Join.
  private onThroneRound(): boolean {
    return (
      this.nextLobbyID !== null &&
      this.throne === null &&
      currentThrone() !== undefined
    );
  }

  async show() {
    this.isVisible = true;
    this.syncLineFeed();
    this.requestUpdate();
  }

  hide() {
    this.isVisible = false;
    if (this.windowTimer !== null) {
      window.clearInterval(this.windowTimer);
      this.windowTimer = null;
    }
    this.syncLineFeed();
    this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.isVisible = false;
    this.syncLineFeed();
  }

  // The public-list feed runs exactly while the line panel is on screen.
  private syncLineFeed() {
    const wanted = this.isVisible && this.onThroneRound();
    if (wanted && this.lineSocket === null) {
      this.lineSocket = new PublicLobbySocket((lobbies) => {
        this.line = lobbies.games ?? {};
        if (findLobby(this.line, this.nextLobbyID) !== undefined) {
          this.lineSeenOwn = true;
        }
      });
      void this.lineSocket.start();
    } else if (!wanted && this.lineSocket !== null) {
      this.lineSocket.stop();
      this.lineSocket = null;
    }
  }

  private _handleExit() {
    this.hide();
    window.location.href = homeHref();
  }

  init() {
    this.eventBus.on(NewLobbyEvent, (e) => this.onNewLobby(e));
  }

  // --- Under a Dark Star: the Next-round panel ---

  private onNewLobby(event: NewLobbyEvent) {
    if (event.reservationUntil === undefined || !this.wonRound) {
      // Not the winner's reserved seat. The host asked for this lobby, so
      // send them straight back to the host view (the ?host flag routes them
      // there instead of the join flow on reload); everyone else gets a Join
      // button on this screen, reopened if they had dismissed it to spectate.
      if (this.game?.myPlayer()?.isLobbyCreator()) {
        window.location.href = `${this.lobbyUrl(event.gameID)}?host`;
        return;
      }
      this.nextLobbyID = event.gameID;
      this.lineSeenOwn = false;
      this.show();
      return;
    }
    this.throne = {
      gameID: event.gameID,
      openedAt: Date.now(),
      until: event.reservationUntil,
    };
    this.pickedMap = undefined;
    this.pickedModifiers = [];
    this.pickedTeams = undefined;
    this.pickSent = false;
    this.windowTimer ??= window.setInterval(() => {
      this.windowTick++;
    }, 250);
    this.show();
  }

  private wonRound = false;

  private windowRemainingMs(): number {
    if (this.throne === null) return 0;
    return Math.max(0, this.throne.until - Date.now());
  }

  private lobbyUrl(id: string): string {
    return `${window.location.origin}${ClientEnv.gamePath(id)}`;
  }

  private answer(stay: boolean) {
    if (this.throne === null || this.pickSent) return;
    this.pickSent = true;
    const type = currentThrone()?.type;
    this.eventBus.emit(
      new SendThronePickEvent(
        this.pickedMap,
        stay,
        type === "special" && this.pickedModifiers.length > 0
          ? [...this.pickedModifiers]
          : undefined,
        type === "team" ? this.pickedTeams : undefined,
      ),
    );
    // Give the socket a moment to flush the pick before the page unloads.
    const id = this.throne.gameID;
    window.setTimeout(() => {
      window.location.href = this.lobbyUrl(id);
    }, 300);
  }

  private joinNext() {
    const id = this.throne?.gameID ?? this.nextLobbyID;
    if (id === null) return;
    window.location.href = this.lobbyUrl(id);
  }

  // The non-winner's line panel (L27). "Stay" is the successor lobby of the
  // throne this round ran on, with its place in line as the list reports it;
  // "Join the head" is the next throne of the same type to launch, when that
  // is another throne. A successor that vanished from the list after being
  // seen was retired (L20): only the head is offered.
  private renderLinePanel() {
    if (!this.onThroneRound()) return nothing;
    const throne = currentThrone()!;
    const own = findLobby(this.line, this.nextLobbyID);
    const retired = this.lineSeenOwn && own === undefined;
    const head = lineHead(this.line, throne.type);
    const headIsOwn = head !== undefined && head.gameID === this.nextLobbyID;
    const place = placeLabel(own?.throne?.place);
    return html`
      <div
        class="flex flex-col gap-3 rounded-lg border border-purple-400/40 bg-black/30 p-3"
        data-line-panel
      >
        <span class="font-bold tracking-wide text-purple-300">
          ${translateText("throne.line_title")}
        </span>
        <p class="text-xs text-white/60">
          ${retired
            ? translateText("throne.line_retired")
            : headIsOwn
              ? translateText("throne.line_is_head")
              : translateText("throne.line_hint")}
        </p>
        <div class="flex flex-col gap-2.5 sm:flex-row">
          ${retired
            ? nothing
            : html`<div class="flex flex-1 flex-col gap-1" data-line-stay>
                <o-button
                  variant="primary"
                  width="block"
                  .title=${translateText("throne.line_stay", {
                    name: throne.name,
                  })}
                  @click=${() => this.joinNext()}
                ></o-button>
                ${place !== undefined
                  ? html`<span
                      class="text-center text-xs tabular-nums text-white/70"
                      data-line-place
                      >${place}</span
                    >`
                  : nothing}
              </div>`}
          ${head !== undefined && !headIsOwn
            ? html`<div class="flex flex-1 flex-col gap-1" data-line-head>
                <o-button
                  variant=${retired ? "primary" : "ghost"}
                  width="block"
                  .title=${translateText("throne.line_head", {
                    name: head.throne?.name ?? "",
                  })}
                  @click=${() => {
                    window.location.href = this.lobbyUrl(head.gameID);
                  }}
                ></o-button>
                <span class="text-center text-xs tabular-nums text-white/70"
                  >${placeLabel(1)}</span
                >
              </div>`
            : nothing}
        </div>
      </div>
    `;
  }

  private toggleModifier(modifier: ThroneModifier) {
    if (this.pickedModifiers.includes(modifier)) {
      this.pickedModifiers = this.pickedModifiers.filter((m) => m !== modifier);
      return;
    }
    if (this.pickedModifiers.length >= THRONE_MAX_MODIFIERS) return;
    if (this.pickedModifiers.some((m) => throneModifiersConflict(m, modifier)))
      return;
    this.pickedModifiers = [...this.pickedModifiers, modifier];
  }

  // Team thrones only (L30): one chip per allowed split, one on at most;
  // clicking the chosen one again keeps the lobby's roll.
  private renderTeamChips() {
    if (currentThrone()?.type !== "team") return nothing;
    return html`
      <div class="flex flex-col gap-1.5" data-throne-teams>
        <span class="text-xs text-white/60"
          >${translateText("throne.pick_teams")}</span
        >
        <div class="flex flex-wrap gap-1.5">
          ${THRONE_TEAM_SPLITS.map((split) => {
            const on = this.pickedTeams === split;
            return html`<button
              type="button"
              class="rounded px-2 py-1 text-xs font-bold tracking-widest uppercase transition ${on
                ? "bg-malibu-blue text-white"
                : "bg-white/10 text-white/80 hover:bg-white/20"}"
              ?disabled=${this.pickSent}
              aria-pressed=${on ? "true" : "false"}
              data-team-split=${String(split)}
              @click=${() => {
                this.pickedTeams = on ? undefined : split;
              }}
            >
              ${typeof split === "number"
                ? translateText("public_lobby.teams", { num: split })
                : translateText(`host_modal.teams_${split}`)}
            </button>`;
          })}
        </div>
      </div>
    `;
  }

  // Special thrones only: one chip per whitelisted modifier, up to two on,
  // an exclusive counterpart greyed out while its pair is chosen.
  private renderModifierChips() {
    if (currentThrone()?.type !== "special") return nothing;
    const full = this.pickedModifiers.length >= THRONE_MAX_MODIFIERS;
    return html`
      <div class="flex flex-col gap-1.5" data-throne-modifiers>
        <span class="text-xs text-white/60"
          >${translateText("throne.pick_modifiers")}</span
        >
        <div class="flex flex-wrap gap-1.5">
          ${THRONE_MODIFIER_WHITELIST.map((modifier) => {
            const on = this.pickedModifiers.includes(modifier);
            const blocked =
              !on &&
              (full ||
                this.pickedModifiers.some((m) =>
                  throneModifiersConflict(m, modifier),
                ));
            return html`<button
              type="button"
              class="rounded px-2 py-1 text-xs font-bold tracking-widest uppercase transition ${on
                ? "bg-malibu-blue text-white"
                : blocked
                  ? "bg-white/5 text-white/30 cursor-not-allowed"
                  : "bg-white/10 text-white/80 hover:bg-white/20"}"
              ?disabled=${blocked || this.pickSent}
              aria-pressed=${on ? "true" : "false"}
              data-modifier=${modifier}
              @click=${() => this.toggleModifier(modifier)}
            >
              ${throneModifierLabel(modifier)}
            </button>`;
          })}
        </div>
      </div>
    `;
  }

  private renderThronePanel() {
    const panel = this.throne;
    if (panel === null) return nothing;
    void this.windowTick;
    const remaining = this.windowRemainingMs();
    const total = Math.max(1, panel.until - panel.openedAt);
    const expired = remaining === 0 && !this.pickSent;
    const name = currentThrone()?.name ?? "";
    return html`
      <div
        class="flex flex-col gap-3 min-h-0 rounded-lg border border-purple-400/40 bg-black/30 p-3"
        data-throne-panel
      >
        <div class="flex items-center justify-between gap-3">
          <span class="font-bold tracking-wide text-purple-300">
            ${translateText("throne.next_round", { name })}
          </span>
          ${expired
            ? nothing
            : html`<span class="text-sm tabular-nums text-white/80">
                ${translateText("throne.window_seconds", {
                  seconds: String(Math.ceil(remaining / 1000)),
                })}
              </span>`}
        </div>
        <div class="relative h-1.5 w-full overflow-hidden rounded bg-white/10">
          <div
            class="absolute inset-y-0 left-0 bg-purple-400 transition-[width] duration-200"
            style="width:${Math.min(100, (remaining / total) * 100)}%"
          ></div>
        </div>
        ${expired
          ? html`<p class="text-sm text-white/80">
                ${translateText("throne.window_passed")}
              </p>
              <o-button
                variant="primary"
                width="block"
                .title=${translateText("throne.join_next")}
                @click=${() => this.joinNext()}
              ></o-button>`
          : html`<p class="text-xs text-white/60">
                ${translateText("throne.pick_hint")}
              </p>
              ${this.renderModifierChips()} ${this.renderTeamChips()}
              <div class="max-h-[40vh] overflow-y-auto custom-scrollbar pr-1">
                <map-picker
                  .selectedMap=${this.pickedMap ?? GameMapType.EventHorizon}
                  .useRandomMap=${this.pickedMap === undefined}
                  .onSelectMap=${(map: GameMapType) => {
                    this.pickedMap = map;
                  }}
                  .onSelectRandom=${() => {
                    this.pickedMap = undefined;
                  }}
                ></map-picker>
              </div>
              <div class="flex gap-2.5">
                <o-button
                  variant="primary"
                  width="block"
                  class="flex-1"
                  .title=${translateText("throne.keep")}
                  .disable=${this.pickSent}
                  @click=${() => this.answer(true)}
                ></o-button>
                <o-button
                  variant="ghost"
                  width="block"
                  class="flex-1"
                  .title=${translateText("throne.step_down")}
                  .disable=${this.pickSent}
                  @click=${() => this.answer(false)}
                ></o-button>
              </div>`}
      </div>
    `;
  }

  tick() {
    const myPlayer = this.game.myPlayer();
    if (
      !this.hasShownDeathModal &&
      myPlayer &&
      !myPlayer.isAlive() &&
      !this.game.inSpawnPhase() &&
      myPlayer.hasSpawned()
    ) {
      this.hasShownDeathModal = true;
      this._title = translateText("win_modal.died");
      this.eventBus.emit(new PlaySoundEffectEvent("defeat"));
      this.show();
    }
    const updates = this.game.updatesSinceLastTick();
    const winUpdates = updates?.[GameUpdateType.Win] ?? [];
    winUpdates.forEach((wu) => {
      if (wu.winner === undefined) {
        // Match cancelled (e.g. a ranked 2v2 that didn't fill or fully
        // spawn): the game ends with no winner. Still vote the result to the
        // server so the record is archived winnerless (never ranked).
        this.eventBus.emit(new SendWinnerEvent(undefined, wu.allPlayersStats));
        this._title = translateText("win_modal.match_cancelled");
        this.isWin = false;
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      } else if (wu.winner[0] === "team") {
        this.eventBus.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        if (wu.winner[1] === this.game.myPlayer()?.team()) {
          this._title = translateText("win_modal.your_team");
          this.isWin = true;
        } else {
          this._title = translateText("win_modal.other_team", {
            team: wu.winner[1],
          });
          this.isWin = false;
        }
        this.playEndOfGameSound();
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      } else if (wu.winner[0] === "nation") {
        this.eventBus.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        // An AI Hegemon that outlasts the round wins as a "nation" (R4).
        const hegemonWon = this.game
          .playerViews()
          .some((p) => p.isHegemon() && p.name() === wu.winner![1]);
        this._title = hegemonWon
          ? translateText("win_modal.hegemon_reigns")
          : translateText("win_modal.nation_won", {
              nation: wu.winner[1],
            });
        this.isWin = false;
        this.playEndOfGameSound();
        this.show();
      } else {
        const winner = this.game.playerByClientID(wu.winner[1]);
        if (!winner?.isPlayer()) return;
        const winnerClient = winner.clientID();
        if (winnerClient !== null) {
          this.eventBus.emit(
            new SendWinnerEvent(["player", winnerClient], wu.allPlayersStats),
          );
        }
        const me = this.game.myPlayer();
        if (winnerClient !== null && winnerClient === me?.clientID()) {
          // Under a Dark Star: the throne's next round is mine to shape
          // (onNewLobby opens the Next-round panel instead of a Join button).
          this.wonRound = true;
          // From the throne, outlasting the round is the reign continuing (R4).
          this._title = winner.isHegemon()
            ? translateText("win_modal.hegemon_reigns")
            : translateText("win_modal.you_won");
          this.isWin = true;
        } else if (me?.isHegemon() && !me.isAlive()) {
          // The killing blow (R3), seen from the throne.
          this._title = translateText("win_modal.overthrown", {
            player: winner.displayName(),
          });
          this.isWin = false;
        } else if (
          !winner.isHegemon() &&
          me?.team() !== null &&
          me?.team() === winner.team()
        ) {
          // A team throne (L8): the slayer's teammates share the win screen,
          // not the seat.
          this._title = translateText("win_modal.your_team");
          this.isWin = true;
        } else {
          this._title = winner.isHegemon()
            ? translateText("win_modal.hegemon_reigns")
            : translateText("win_modal.other_won", {
                player: winner.displayName(),
              });
          this.isWin = false;
        }
        this.playEndOfGameSound();
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      }
    });
  }

  private playEndOfGameSound(): void {
    if (this.isWin) {
      this.eventBus.emit(new PlaySoundEffectEvent("victory"));
    } else if (!this.hasShownDeathModal && this.game.myPlayer()?.hasSpawned()) {
      // Spawned check: spectators and replay viewers shouldn't get a
      // personal defeat sting. The cue also already played if the player
      // died earlier (hasShownDeathModal).
      this.eventBus.emit(new PlaySoundEffectEvent("defeat"));
    }
  }
}
