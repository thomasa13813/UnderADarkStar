import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  homeHref,
  throneModifierLabel,
  translateText,
} from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { GameMapType, PlayerType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { TeamCountConfig } from "../../../core/Schemas";
import {
  THRONE_MAX_MODIFIERS,
  THRONE_MODIFIER_WHITELIST,
  ThroneModifier,
  throneModifiersConflict,
} from "../../../core/ThroneModifiers";
import { THRONE_TEAM_SPLITS } from "../../../core/ThroneTeams";
import { ClientEnv } from "../../ClientEnv";
import "../../components/map/MapPicker";
import { requestRoundTransition } from "../../components/RoundTransition";
import { Controller } from "../../Controller";
import {
  BeginPiracyEvent,
  pirateReadyAt,
} from "../../controllers/PiracyController";
import { PublicLobbySocket } from "../../LobbySocket";
import { Games, otherRooms, roomState } from "../../Rooms";
import { PlaySoundEffectEvent } from "../../sound/Sounds";
import { currentThrone, isHeldForNextRound } from "../../ThroneState";
import {
  NewLobbyEvent,
  SendThronePickEvent,
  SendWinnerEvent,
} from "../../Transport";
import { GameView } from "../../view";
import "./ReignPrompt";

// Under a Dark Star: the winner's Next-round panel on the win screen
// (docs/DarkStar-Lobbies.md §4 step 4, §5.5). The master opened the room's
// next lobby and reserved its seat for the winner until `until`; here they
// pick its map and keep the throne or step down, then jump to the lobby. A
// winner who lets the window run out is sent home (L47).
//
// Everyone else on a room's round gets the rooms panel. At the round's end
// (L47): stay for the room's next round, go to another room, or leave, before
// the winner's window closes; no answer sends the player home, and a watcher
// held for the next round (L48) is placed in it at once. Eliminated while the
// round goes on (L46), or arrived after the spawn phase (L36), the same panel
// offers the other rooms beside Embrace piracy, Spectate and Exit. A drop-in
// who lands the killing blow ends a void round (L44): the title says so and
// there is no winner's panel. A private lobby's successor is a plain Join
// button beside Exit and Spectate. The winner of a public throne round also
// gets the reign prompt (ReignPrompt.ts, Accounts §6) above the panels.
// A room round's end when no winner's window was announced (an AI or void
// round): as long as a winner would have had (L4, L47).
const ROUND_END_ANSWER_MS = 30_000;

interface ThronePanel {
  gameID: string;
  openedAt: number;
  until: number;
}

@customElement("win-modal")
export class WinModal extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  // Set once the death screen (or the drop-in's arrival screen) has opened
  // for us mid-round; it also shows the rooms panel's mid-round form. Cleared
  // when a pirate lands and is alive again, so a second death opens it again
  // (docs/DarkStar-Piracy.md, section 8).
  private hasShownDeathModal = false;
  // The screen opened because we arrived after the spawn phase, not because
  // we died (L36): no defeat sound, the arrival's hint.
  @state() private arrived = false;
  // The round has a result (or none): no more piracy from here.
  private roundOver = false;

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
  // Repaints the window bar and checks the deadlines while a window runs.
  @state() private windowTick = 0;
  private windowTimer: number | null = null;
  // A non-winner's answer is due by then, at a room round's end (L47).
  @state() private endDeadline: number | null = null;
  // The rooms panel's live view of the public list, opened while the panel
  // is on screen and closed with it.
  @state() private roomList: Games = null;
  private roomSocket: PublicLobbySocket | null = null;

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
        <reign-prompt
          .active=${this.wonRound && currentThrone() !== undefined}
        ></reign-prompt>
        ${this.renderThronePanel()} ${this.renderRoomsPanel()}
        ${this.renderPiracyPanel()}
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
          ${this.nextLobbyID !== null && currentThrone() === undefined
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

  // Piracy (docs/DarkStar-Piracy.md, PR1): a challenger eliminated while the
  // round goes on may embrace it, any number of times, and so may a player
  // who never spawned, a drop-in among them (Lobbies L36); the Hegemon never
  // (its fall ends the round), and nobody once the round has a result.
  private canEmbrace(): boolean {
    const me = this.game?.myPlayer();
    return (
      this.hasShownDeathModal &&
      !this.roundOver &&
      this.game.config().piracyConfig().enabled &&
      me !== null &&
      me !== undefined &&
      !me.isAlive() &&
      !me.isPirate() &&
      me.type() === PlayerType.Human &&
      !me.isHegemon()
    );
  }

  private embracePiracy() {
    this.hide();
    this.eventBus.emit(new BeginPiracyEvent());
  }

  private renderPiracyPanel() {
    if (!this.canEmbrace()) return nothing;
    const me = this.game.myPlayer()!;
    const readyAt = pirateReadyAt(this.game, me);
    const wait =
      readyAt === null ? 0 : Math.ceil((readyAt - this.game.ticks()) / 10);
    return html`
      <div
        class="mt-3 flex flex-col gap-2 rounded-lg border border-red-400/40 bg-black/30 p-3"
        data-piracy-panel
      >
        <p class="text-xs text-white/60">
          ${this.arrived
            ? translateText("rooms.arrived_hint")
            : translateText("win_modal.embrace_piracy_hint")}
        </p>
        ${this.arrived && wait > 0
          ? html`<p class="text-xs tabular-nums text-white/80" data-pirate-wait>
              ${translateText("piracy.next_corsair_in", { seconds: wait })}
            </p>`
          : nothing}
        <o-button
          variant="primary"
          width="block"
          translationKey="win_modal.embrace_piracy"
          data-embrace-piracy
          @click=${() => this.embracePiracy()}
        ></o-button>
      </div>
    `;
  }

  // Why the rooms panel is on screen (§14): "round_end" once a room's round
  // is over and its next lobby is open, stay, another room or leave (L47);
  // "fallen" while it still runs and we are out of it, dead or arrived as a
  // pirate (L46, L36): another room. Nothing for the winner (their own
  // panel), a private lobby, or a game that runs for no room.
  private roomsPanelMode(): "round_end" | "fallen" | null {
    if (currentThrone() === undefined || this.throne !== null) return null;
    if (this.nextLobbyID !== null) return "round_end";
    if (this.hasShownDeathModal && !this.roundOver) return "fallen";
    return null;
  }

  async show() {
    this.isVisible = true;
    this.syncRoomFeed();
    this.requestUpdate();
  }

  hide() {
    this.isVisible = false;
    this.syncRoomFeed();
    this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.isVisible = false;
    this.stopWindowTimer();
    this.syncRoomFeed();
  }

  // The public-list feed runs exactly while the rooms panel is on screen.
  private syncRoomFeed() {
    const wanted = this.isVisible && this.roomsPanelMode() !== null;
    if (wanted && this.roomSocket === null) {
      this.roomSocket = new PublicLobbySocket((lobbies) => {
        this.roomList = lobbies.games ?? {};
      });
      void this.roomSocket.start();
    } else if (!wanted && this.roomSocket !== null) {
      this.roomSocket.stop();
      this.roomSocket = null;
    }
  }

  private _handleExit() {
    this.hide();
    this.goHome();
  }

  private goHome() {
    this.stopWindowTimer();
    window.location.href = homeHref();
  }

  init() {
    this.eventBus.on(NewLobbyEvent, (e) => this.onNewLobby(e));
  }

  // --- Under a Dark Star: the next round ---

  private onNewLobby(event: NewLobbyEvent) {
    if (event.reservationUntil === undefined || !this.wonRound) {
      // Not the winner's reserved seat. The host asked for this lobby, so
      // send them straight back to the host view (the ?host flag routes them
      // there instead of the join flow on reload).
      if (this.game?.myPlayer()?.isLobbyCreator()) {
        window.location.href = `${this.lobbyUrl(event.gameID)}?host`;
        return;
      }
      // A watcher held for the next round asked to play (L48): placed in its
      // lobby, no question asked.
      if (currentThrone() !== undefined && isHeldForNextRound()) {
        this.goTo(event.gameID);
        return;
      }
      // Everyone else gets the choice on this screen, reopened if they had
      // dismissed it to spectate. On a room it must be made within the
      // winner's window, or they are sent home (L47).
      this.nextLobbyID = event.gameID;
      if (currentThrone() !== undefined) {
        this.endDeadline =
          event.reservationUntil ?? Date.now() + ROUND_END_ANSWER_MS;
        this.startWindowTimer();
      }
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
    this.startWindowTimer();
    this.show();
  }

  private wonRound = false;

  private startWindowTimer() {
    this.windowTimer ??= window.setInterval(() => this.onWindowTick(), 250);
  }

  private stopWindowTimer() {
    if (this.windowTimer !== null) {
      window.clearInterval(this.windowTimer);
      this.windowTimer = null;
    }
  }

  // Repaint the bars; a window that ran out unanswered sends the player
  // home (L47), the winner included.
  private onWindowTick() {
    this.windowTick++;
    const now = Date.now();
    if (this.throne !== null && !this.pickSent && now > this.throne.until) {
      this.goHome();
    } else if (this.endDeadline !== null && now > this.endDeadline) {
      this.goHome();
    }
  }

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
    window.setTimeout(() => this.goTo(id), 300);
  }

  private joinNext() {
    const id = this.throne?.gameID ?? this.nextLobbyID;
    if (id === null) return;
    this.goTo(id);
  }

  // To a room's lobby or round. From a room's round the lobby opens behind
  // the transition between rounds (L41).
  private goTo(gameID: string) {
    this.stopWindowTimer();
    if (currentThrone() !== undefined) requestRoundTransition();
    window.location.href = this.lobbyUrl(gameID);
  }

  // The rooms panel (L46, L47). At the round's end: Stay is the room's next
  // lobby, the server announced; the other rooms follow in the steering
  // order, each joining its lobby or dropping into its round; the bar counts
  // down the time left to choose. Mid-round: the other rooms alone, beside
  // Embrace piracy, Spectate and Exit.
  private renderRoomsPanel() {
    const mode = this.roomsPanelMode();
    if (mode === null) return nothing;
    void this.windowTick;
    const throne = currentThrone()!;
    const others = otherRooms(this.roomList, throne.throneID);
    const remaining =
      this.endDeadline === null
        ? null
        : Math.max(0, Math.ceil((this.endDeadline - Date.now()) / 1000));
    return html`
      <div
        class="flex flex-col gap-3 rounded-lg border border-purple-400/40 bg-black/30 p-3"
        data-rooms-panel
        data-rooms-mode=${mode}
      >
        <div class="flex items-center justify-between gap-3">
          <span class="font-bold tracking-wide text-purple-300">
            ${mode === "round_end"
              ? translateText("rooms.next_title")
              : translateText("rooms.other_title")}
          </span>
          ${remaining !== null
            ? html`<span
                class="text-sm tabular-nums text-white/80"
                data-rooms-deadline
                >${translateText("throne.window_seconds", {
                  seconds: String(remaining),
                })}</span
              >`
            : nothing}
        </div>
        <p class="text-xs text-white/60">
          ${mode === "round_end"
            ? translateText("rooms.end_hint")
            : others.length === 0
              ? translateText("rooms.fallen_hint_alone")
              : translateText("rooms.fallen_hint")}
        </p>
        ${mode === "round_end"
          ? html`<o-button
              variant="primary"
              width="block"
              data-rooms-stay
              .title=${translateText("rooms.stay", { name: throne.name })}
              @click=${() => this.joinNext()}
            ></o-button>`
          : nothing}
        ${others.length > 0
          ? html`<div class="flex flex-col gap-1.5" data-rooms-others>
              ${others.map(
                (lobby) =>
                  html`<button
                    type="button"
                    class="flex items-center justify-between gap-3 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-left text-sm text-white hover:bg-white/15"
                    data-room=${lobby.gameID}
                    @click=${() => this.goTo(lobby.gameID)}
                  >
                    <span class="font-bold"
                      >${translateText("rooms.go_to", {
                        name: lobby.throne?.name ?? "",
                      })}</span
                    >
                    <span class="text-xs uppercase tracking-wider text-white/60"
                      >${translateText(`rooms.state_${roomState(lobby)}`)}</span
                    >
                  </button>`,
              )}
            </div>`
          : nothing}
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
            </p>`
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
    // A pirate who landed is back among the living: their next death is a
    // death screen again.
    if (this.hasShownDeathModal && !this.roundOver && myPlayer?.isAlive()) {
      this.hasShownDeathModal = false;
    }
    if (
      !this.hasShownDeathModal &&
      myPlayer &&
      !myPlayer.isAlive() &&
      !this.game.inSpawnPhase() &&
      myPlayer.hasSpawned()
    ) {
      this.hasShownDeathModal = true;
      this.arrived = false;
      this._title = translateText("win_modal.died");
      this.eventBus.emit(new PlaySoundEffectEvent("defeat"));
      // On a room's round this opens the rooms panel (L46), and its feed.
      this.show();
    } else if (
      !this.hasShownDeathModal &&
      !this.roundOver &&
      myPlayer &&
      !myPlayer.hasSpawned() &&
      !myPlayer.isPirate() &&
      !this.game.inSpawnPhase() &&
      !this.game.inOpening() &&
      this.game.config().piracyConfig().enabled
    ) {
      // Arrived after the spawn phase, or never picked a spawn: a pirate
      // from 30 s into play (L36).
      this.hasShownDeathModal = true;
      this.arrived = true;
      this._title = translateText("rooms.arrived_title");
      this.show();
    }
    const updates = this.game.updatesSinceLastTick();
    const winUpdates = updates?.[GameUpdateType.Win] ?? [];
    winUpdates.forEach((wu) => {
      this.roundOver = true;
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
        if (
          currentThrone() !== undefined &&
          winnerClient !== null &&
          this.game.joinedAfterStart(winnerClient)
        ) {
          // A drop-in landed the killing blow (L44): the round is void,
          // nobody is credited, and the seat opens for the next round.
          this._title =
            winnerClient === me?.clientID()
              ? translateText("rooms.void_you")
              : translateText("rooms.void_other", {
                  player: winner.displayName(),
                });
          this.isWin = false;
        } else if (winnerClient !== null && winnerClient === me?.clientID()) {
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
