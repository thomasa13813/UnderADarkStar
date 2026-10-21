import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import {
  calculateServerTimeOffset,
  getSecondsUntilServerTimestamp,
  renderDuration,
  showToast,
  translateText,
} from "../client/Utils";
import { GameEnv } from "../core/configuration/Config";
import { EventBus } from "../core/EventBus";
import { DoomsdayClockSpeed } from "../core/game/DoomsdayClock";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  UnitType,
} from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import {
  ClientInfo,
  GameConfig,
  LobbyInfoEvent,
  TeamCountConfig,
  isValidGameID,
} from "../core/Schemas";
import { createLobby, getUserMe, setLobbyListed } from "./Api";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import "./components/ConfirmDialog";
import { CopyButton } from "./components/CopyButton";
import "./components/GameConfigSettings";
import "./components/InputCard";
import "./components/LobbyPlayerView";
import "./components/ToggleInputCard";
import { modalHeader } from "./components/ui/ModalHeader";
import { JoinFailedEvent, JoinLobbyEvent } from "./Main";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import {
  getBotsForCompactMap,
  getNationsForCompactMap,
  getRandomMapType,
  getUpdatedDisabledUnits,
  nationsConfigToSlider,
  parseBoundedFloatFromInput,
  parseBoundedIntegerFromInput,
  preventDisallowedKeys,
  sliderToNationsConfig,
  toOptionalNumber,
} from "./utilities/GameConfigHelpers";

// Under a Dark Star (docs/DarkStar-Accounts.md A20): listing a private lobby
// in the public browser is off at launch; thrones are the public offer. The
// server refuses it too (the API grants no canCreatePublicLobbies), so this
// only hides a switch that could never succeed. Flip to offer it again.
const PUBLIC_LISTING_OFFERED = false;

@customElement("host-lobby-modal")
export class HostLobbyModal extends BaseModal {
  @state() private selectedMap: GameMapType = GameMapType.EventHorizon;
  @state() private selectedDifficulty: Difficulty = Difficulty.Easy;
  @state() private nations: number = 0;
  @state() private defaultNationCount: number = 0;
  @state() private gameMode: GameMode = GameMode.FFA;
  @state() private teamCount: TeamCountConfig = 2;

  constructor() {
    super();
    this.id = "page-host-lobby";
  }
  @state() private bots: number = 400;
  @state() private spawnImmunity: boolean = false;
  @state() private spawnImmunityDurationMinutes: number | undefined = undefined;
  @state() private infiniteGold: boolean = false;
  @state() private donateGold: boolean = false;
  @state() private infiniteTroops: boolean = false;
  @state() private donateTroops: boolean = false;
  // A Hegemon round is always timed (R5): 20 minutes unless the host says.
  @state() private maxTimer: boolean = true;
  @state() private maxTimerValue: number | undefined = 20;
  @state() private startDelayValue: number | undefined = 3;
  @state() private instantBuild: boolean = false;
  @state() private randomSpawn: boolean = false;
  @state() private compactMap: boolean = false;
  @state() private goldMultiplier: boolean = false;
  @state() private goldMultiplierValue: number | undefined = undefined;
  @state() private startingGold: boolean = false;
  @state() private startingGoldValue: number | undefined = undefined;
  @state() private customAlliances: boolean = false;
  @state() private customAllianceMinutes: number | undefined = undefined;
  @state() private doomsdayClock: boolean = false;
  @state() private doomsdayClockSpeed: DoomsdayClockSpeed = "normal";
  @state() private overtime: boolean = false;
  @state() private overtimeStartMinutes: number | undefined = undefined;
  @state() private anonymizeNames: boolean = false;
  @state() private nameReveals: string[] = [];
  @state() private whitelistEnabled: boolean = false;
  @state() private allowedPublicIds: string = "";
  @state() private waterNukes: boolean = false;
  // Piracy (docs/DarkStar-Piracy.md): the server's lobby default is on.
  @state() private piracy: boolean = true;
  // Under a Dark Star (P0): the throne is always there (the game itself, never
  // a toggle). The creator seats one player from the roster; nobody seated
  // means the AI holds it.
  @state() private hegemonSeat: string | null = null;
  @state() private lobbyId = "";
  @state() private lobbyUrlSuffix = "";
  @state() private clients: ClientInfo[] = [];
  @state() private useRandomMap: boolean = false;
  @state() private disabledUnits: UnitType[] = [];
  @state() private hostCheatsEnabled: boolean = false;
  @state() private hostCheatInfiniteGold: boolean = false;
  @state() private hostCheatInfiniteTroops: boolean = false;
  @state() private hostCheatGoldMultiplier: boolean = false;
  @state() private hostCheatGoldMultiplierValue: number | undefined = undefined;
  @state() private hostCheatStartingGold: boolean = false;
  @state() private hostCheatStartingGoldValue: number | undefined = undefined;
  @state() private lobbyCreatorClientID: string = "";
  @state() private lobbyStartAt: number | null = null;
  @state() private serverTimeOffset: number = 0;
  // Whether this user may actually make the lobby public (the API's
  // canCreatePublicLobbies entitlement, or anyone in dev). The toggle itself
  // is always shown.
  @state() private canListPublicly: boolean = false;
  @state() private publiclyListed: boolean = false;
  @state() private showSubscriptionRequired: boolean = false;
  // Server timestamp when the listed lobby auto-starts (from lobby info).
  @state() private autoStartAt: number | null = null;

  @property({ attribute: false }) eventBus: EventBus | null = null;
  // Timers for debouncing slider changes
  private botsUpdateTimer: number | null = null;
  private nationsUpdateTimer: number | null = null;
  private mapLoader = terrainMapFileLoader;
  private userSettings = new UserSettings();

  private leaveLobbyOnClose = true;

  // Guards against overlapping listing requests: rapid Public/Private clicks
  // could otherwise be applied out of order by the server, leaving the UI
  // showing the opposite of the real listed state.
  private listingRequestInFlight = false;

  // Attach mode (a successor lobby the server minted with the previous
  // round's settings): the first lobby info hydrates the form, which
  // otherwise shows defaults and would push them over the inherited config
  // at the first click.
  private hydrateFromLobby = false;

  private readonly handleLobbyInfo = (event: LobbyInfoEvent) => {
    const lobby = event.lobby;
    if (!this.lobbyId || lobby.gameID !== this.lobbyId) {
      return;
    }
    if ("serverTime" in lobby && typeof lobby.serverTime === "number") {
      this.serverTimeOffset = calculateServerTimeOffset(lobby.serverTime);
    }
    this.lobbyStartAt = lobby.startsAt ?? null;
    this.lobbyCreatorClientID = lobby.lobbyCreatorClientID ?? "";
    if (lobby.clients) {
      this.clients = lobby.clients;
    }
    if (lobby.gameConfig) {
      if (this.hydrateFromLobby) {
        this.hydrateFromLobby = false;
        this.applyConfig(lobby.gameConfig);
      }
      // The seat is the server's to change under us: it seats the heir as
      // they arrive and unseats a player who left.
      this.hegemonSeat = lobby.gameConfig.hegemon?.seat ?? null;
    }
    // The server can delist on its own (duplicate creator / cap overflow
    // resolved by the master); follow its state unless our own toggle
    // request is mid-flight.
    if (!this.listingRequestInFlight && lobby.listed !== undefined) {
      this.publiclyListed = lobby.listed;
    }
    this.autoStartAt = lobby.autoStartAt ?? null;
  };

  private getRandomString(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from(
      { length: 5 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  }

  private async buildLobbyUrl(): Promise<string> {
    // window.location.origin is deliberate here, NOT ClientEnv.shareOrigin():
    // this URL only ever reaches history.replaceState (updateLobbyHistory), and
    // replaceState to a different origin throws a SecurityError. The link the
    // host actually shares is built separately by copy-button, which does use
    // shareOrigin.
    return `${window.location.origin}${ClientEnv.gamePath(this.lobbyId)}?lobby&s=${encodeURIComponent(this.lobbyUrlSuffix)}`;
  }

  private async constructUrl(): Promise<string> {
    this.lobbyUrlSuffix = this.getRandomString();
    return await this.buildLobbyUrl();
  }

  private updateHistory(url: string): void {
    history.replaceState(null, "", url);
  }

  private updateLobbyHistory(lobbyUrl: string): void {
    const lobbyIdHidden = !this.userSettings.lobbyIdVisibility();
    history.replaceState(null, "", lobbyIdHidden ? "/streamer-mode" : lobbyUrl);
  }

  private startLobbyUpdates() {
    this.stopLobbyUpdates();
    if (!this.eventBus) {
      console.warn(
        "HostLobbyModal: eventBus not set, cannot subscribe to lobby updates",
      );
      return;
    }
    this.eventBus.on(LobbyInfoEvent, this.handleLobbyInfo);
  }

  private stopLobbyUpdates() {
    this.eventBus?.off(LobbyInfoEvent, this.handleLobbyInfo);
  }

  protected renderHeaderSlot() {
    return modalHeader({
      titleContent: html`
        <span
          class="text-white text-xl lg:text-2xl font-bold uppercase tracking-widest break-words hyphens-auto"
        >
          ${translateText("host_modal.title")}
        </span>
        ${PUBLIC_LISTING_OFFERED ? this.renderVisibilityToggle() : nothing}
      `,
      onBack: () => {
        this.leaveLobbyOnClose = true;
        this.close();
      },
      ariaLabel: translateText("common.back"),
      // Both answer "get my friends into this lobby", so they sit together —
      // the host is the player holding the code and deciding who joins, and
      // was the one surface the invite button originally missed. Paired behind
      // a wrapper only when the invite is present, so a browser renders exactly
      // the markup it did before.
      rightContent: (() => {
        const copy = html`<copy-button
          .lobbyId=${this.lobbyId}
          .lobbySuffix=${this.lobbyUrlSuffix}
          include-lobby-query
        ></copy-button>`;
        return copy;
      })(),
    });
  }

  // Private/Public segmented toggle in the header. Shown to everyone;
  // non-subscribers get a subscription-required dialog instead of a listing
  // request (the server re-checks the subscription regardless). Listing is
  // one-way (the server rejects unlisting), so the Private segment goes away
  // once the lobby is listed.
  private renderVisibilityToggle() {
    const segment = (labelKey: string, isPublic: boolean) => html`
      <button
        class="px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full transition-all ${this
          .publiclyListed === isPublic
          ? "bg-malibu-blue text-white"
          : "text-white/50 hover:text-white"}"
        @click=${() => this.handleVisibilitySelect(isPublic)}
      >
        ${translateText(labelKey)}
      </button>
    `;
    return html`
      <div
        class="flex items-center rounded-full border border-white/10 bg-white/5 p-0.5 shrink-0"
      >
        ${this.publiclyListed
          ? nothing
          : segment("host_modal.visibility_private", false)}
        ${segment("host_modal.visibility_public", true)}
      </div>
      ${this.renderAutoStartTimer()}
    `;
  }

  // Countdown until the listed lobby starts automatically (hosts can't sit
  // on a public listing). Hidden once the real start countdown is running —
  // the Start button shows that one.
  private renderAutoStartTimer() {
    if (
      !this.publiclyListed ||
      this.autoStartAt === null ||
      this.lobbyStartAt !== null
    ) {
      return nothing;
    }
    const seconds = getSecondsUntilServerTimestamp(
      this.autoStartAt,
      this.serverTimeOffset,
    );
    return html`<span
      class="text-amber-300 text-xs font-bold tabular-nums shrink-0"
      title=${translateText("host_modal.auto_start_timer")}
      >${renderDuration(seconds)}</span
    >`;
  }

  private handleVisibilitySelect(isPublic: boolean) {
    if (
      this.listingRequestInFlight ||
      isPublic === this.publiclyListed ||
      !this.lobbyId
    ) {
      return;
    }
    if (isPublic && !this.canListPublicly) {
      this.showSubscriptionRequired = true;
      return;
    }
    void this.handlePublicListingToggle(isPublic);
  }

  protected renderBody() {
    const secondsRemaining =
      this.lobbyStartAt !== null
        ? getSecondsUntilServerTimestamp(
            this.lobbyStartAt,
            this.serverTimeOffset,
          )
        : null;
    const statusLabel =
      secondsRemaining === null
        ? this.clients.length === 1
          ? translateText("host_modal.waiting")
          : translateText("game_settings.start")
        : translateText("host_modal.starting_in", {
            time: renderDuration(secondsRemaining),
          });

    const inputCards = [
      html`<toggle-input-card
        .labelKey=${"game_settings.max_timer"}
        .checked=${this.maxTimer}
        .inputMin=${1}
        .inputMax=${120}
        .inputValue=${this.maxTimerValue}
        .inputAriaLabel=${translateText("game_settings.max_timer")}
        .inputPlaceholder=${translateText("game_settings.mins_placeholder")}
        .defaultInputValue=${30}
        .minValidOnEnable=${1}
        .onToggle=${this.handleMaxTimerToggle}
        .onInput=${this.handleMaxTimerValueChanges}
        .onKeyDown=${this.handleMaxTimerValueKeyDown}
      ></toggle-input-card>`,
      html`<input-card
        .labelKey=${"host_modal.start_delay"}
        .inputId=${"start-delay-value"}
        .inputMin=${0}
        .inputMax=${600}
        .inputStep=${"1"}
        .inputValue=${this.startDelayValue}
        .inputAriaLabel=${translateText("host_modal.start_delay")}
        .inputPlaceholder=${"3"}
        .defaultInputValue=${3}
        .onChange=${this.handleStartDelayValueChanges}
        .onKeyDown=${this.handleStartDelayValueKeyDown}
      ></input-card>`,
      html`<toggle-input-card
        .labelKey=${"host_modal.player_immunity_duration"}
        .checked=${this.spawnImmunity}
        .inputMin=${0}
        .inputMax=${120}
        .inputStep=${1}
        .inputValue=${this.spawnImmunityDurationMinutes}
        .inputAriaLabel=${translateText("host_modal.player_immunity_duration")}
        .inputPlaceholder=${translateText("game_settings.mins_placeholder")}
        .defaultInputValue=${5}
        .minValidOnEnable=${0}
        .onToggle=${this.handleSpawnImmunityToggle}
        .onInput=${this.handleSpawnImmunityDurationInput}
        .onKeyDown=${this.handleSpawnImmunityDurationKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"game_settings.custom_alliances"}
        .checked=${this.customAlliances}
        .inputMin=${0}
        .inputMax=${15}
        .inputStep=${1}
        .inputValue=${this.customAllianceMinutes}
        .inputAriaLabel=${translateText("game_settings.custom_alliances")}
        .inputPlaceholder=${translateText("game_settings.mins_placeholder")}
        .defaultInputValue=${0}
        .minValidOnEnable=${0}
        .zeroLabel=${`(${translateText("public_game_modifier.disable_alliances")})`}
        .onToggle=${this.handleCustomAlliancesToggle}
        .onInput=${this.handleCustomAllianceMinutesInput}
        .onKeyDown=${this.handleCustomAllianceMinutesKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"game_settings.overtime"}
        .checked=${this.overtime}
        .inputMin=${1}
        .inputMax=${120}
        .inputStep=${1}
        .inputValue=${this.overtimeStartMinutes}
        .inputAriaLabel=${translateText("game_settings.overtime")}
        .inputPlaceholder=${translateText("game_settings.mins_placeholder")}
        .defaultInputValue=${30}
        .minValidOnEnable=${1}
        .onToggle=${this.handleOvertimeToggle}
        .onInput=${this.handleOvertimeMinutesInput}
        .onKeyDown=${this.handleOvertimeMinutesKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"game_settings.gold_multiplier"}
        .checked=${this.goldMultiplier}
        .inputId=${"gold-multiplier-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.goldMultiplierValue}
        .inputAriaLabel=${translateText("game_settings.gold_multiplier")}
        .inputPlaceholder=${"2.0x"}
        .defaultInputValue=${2}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleGoldMultiplierToggle}
        .onChange=${this.handleGoldMultiplierValueChanges}
        .onKeyDown=${this.handleGoldMultiplierValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"game_settings.starting_gold"}
        .checked=${this.startingGold}
        .inputId=${"starting-gold-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.startingGoldValue}
        .inputAriaLabel=${translateText("game_settings.starting_gold")}
        .inputPlaceholder=${"5"}
        .defaultInputValue=${5}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleStartingGoldToggle}
        .onChange=${this.handleStartingGoldValueChanges}
        .onKeyDown=${this.handleStartingGoldValueKeyDown}
      ></toggle-input-card>`,
      // A join whitelist and public listing are mutually exclusive (the
      // server rejects both combinations), so the control disappears while
      // the lobby is listed.
      ...(this.publiclyListed
        ? []
        : [
            html`<toggle-input-card
              .labelKey=${"host_modal.player_whitelist"}
              .checked=${this.whitelistEnabled}
              .inputType=${"text"}
              .inputId=${"allowed-public-ids"}
              .inputValue=${this.allowedPublicIds}
              .inputAriaLabel=${translateText("host_modal.player_whitelist")}
              .inputPlaceholder=${translateText(
                "host_modal.player_whitelist_placeholder",
              )}
              .onToggle=${this.handleWhitelistToggle}
              .onChange=${this.handleAllowedPublicIdsChange}
            ></toggle-input-card>`,
          ]),
    ];

    const hostCheatInputCards = [
      html`<toggle-input-card
        .labelKey=${"game_settings.gold_multiplier"}
        .checked=${this.hostCheatGoldMultiplier}
        .inputId=${"host-cheat-gold-multiplier-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.hostCheatGoldMultiplierValue}
        .inputAriaLabel=${translateText("game_settings.gold_multiplier")}
        .inputPlaceholder=${"2.0x"}
        .defaultInputValue=${2}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleHostCheatGoldMultiplierToggle}
        .onChange=${this.handleHostCheatGoldMultiplierValueChanges}
        .onKeyDown=${this.handleHostCheatGoldMultiplierValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"game_settings.starting_gold"}
        .checked=${this.hostCheatStartingGold}
        .inputId=${"host-cheat-starting-gold-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.hostCheatStartingGoldValue}
        .inputAriaLabel=${translateText("game_settings.starting_gold")}
        .inputPlaceholder=${"5"}
        .defaultInputValue=${5}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleHostCheatStartingGoldToggle}
        .onChange=${this.handleHostCheatStartingGoldValueChanges}
        .onKeyDown=${this.handleHostCheatStartingGoldValueKeyDown}
      ></toggle-input-card>`,
    ];

    return html`
      <div class="flex flex-col h-full">
        <div
          class="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6 mr-1 mx-auto w-full max-w-5xl"
        >
          <game-config-settings
            class="block"
            .sectionGapClass=${"space-y-10"}
            .settings=${{
              map: {
                selected: this.selectedMap,
                useRandom: this.useRandomMap,
                randomMapDivider: true,
                collapsible: true,
              },
              difficulty: {
                selected: this.selectedDifficulty,
                disabled: this.nations === 0,
              },
              gameMode: {
                selected: this.gameMode,
              },
              teamCount: {
                selected: this.teamCount,
              },
              options: {
                titleKey: "game_settings.options",
                bots: {
                  value: this.bots,
                  labelKey: "game_settings.bots",
                  disabledKey: "common.disabled",
                },
                nations: {
                  value: this.nations,
                  defaultValue: this.defaultNationCount,
                  labelKey: "game_settings.nations",
                  disabledKey: "common.disabled",
                },
                toggles: [
                  {
                    labelKey: "game_settings.instant_build",
                    checked: this.instantBuild,
                  },
                  {
                    labelKey: "game_settings.random_spawn",
                    checked: this.randomSpawn,
                  },
                  {
                    labelKey: "host_modal.donate_gold",
                    checked: this.donateGold,
                  },
                  {
                    labelKey: "host_modal.donate_troops",
                    checked: this.donateTroops,
                  },
                  {
                    labelKey: "game_settings.infinite_gold",
                    checked: this.infiniteGold,
                  },
                  {
                    labelKey: "game_settings.infinite_troops",
                    checked: this.infiniteTroops,
                  },
                  {
                    labelKey: "game_settings.compact_map",
                    checked: this.compactMap,
                  },
                  {
                    labelKey: "host_modal.anonymous_players",
                    checked: this.anonymizeNames,
                  },
                  {
                    labelKey: "game_settings.water_nukes",
                    checked: this.waterNukes,
                  },
                  {
                    labelKey: "game_settings.piracy",
                    descriptionKey: "game_settings.piracy_desc",
                    checked: this.piracy,
                  },
                  {
                    labelKey: "game_settings.doomsday_clock",
                    checked: this.doomsdayClock,
                    doomsdayClockSpeed: this.doomsdayClockSpeed,
                  },
                  // Host cheats and public listing are mutually exclusive
                  // (the server rejects both combinations), so the controls
                  // disappear while the lobby is listed.
                  ...(this.publiclyListed
                    ? []
                    : [
                        {
                          labelKey: "host_modal.host_cheats",
                          checked: this.hostCheatsEnabled,
                        },
                      ]),
                ],
                inputCards,
              },
              hostCheats: {
                titleKey: "host_modal.host_cheats",
                visible: this.hostCheatsEnabled && !this.publiclyListed,
                toggles: [
                  {
                    labelKey: "game_settings.infinite_gold",
                    checked: this.hostCheatInfiniteGold,
                  },
                  {
                    labelKey: "game_settings.infinite_troops",
                    checked: this.hostCheatInfiniteTroops,
                  },
                ],
                inputCards: hostCheatInputCards,
              },
              unitTypes: {
                titleKey: "game_settings.disable_units",
                disabledUnits: this.disabledUnits,
                // Off under a Dark Star (S6, H19), as in the singleplayer modal.
                hiddenUnits: [
                  UnitType.MIRV,
                  UnitType.SAMLauncher,
                  UnitType.MissileSilo,
                ],
              },
            }}
            @map-selected=${this.handleConfigMapSelected}
            @random-map-selected=${this.handleConfigRandomMapSelected}
            @difficulty-selected=${this.handleConfigDifficultySelected}
            @doomsday-clock-speed-selected=${this
              .handleConfigDoomsdayClockSpeedSelected}
            @game-mode-selected=${this.handleConfigGameModeSelected}
            @team-count-selected=${this.handleConfigTeamCountSelected}
            @bots-changed=${this.handleBotsChange}
            @nations-changed=${this.handleNationsChange}
            @option-toggle-changed=${this.handleConfigOptionToggleChanged}
            @host-cheat-toggle-changed=${this
              .handleConfigHostCheatToggleChanged}
            @unit-toggle-changed=${this.handleConfigUnitToggleChanged}
          ></game-config-settings>

          <lobby-player-view
            class="mt-10"
            .gameMode=${this.gameMode}
            .clients=${this.clients}
            .lobbyCreatorClientID=${this.lobbyCreatorClientID}
            .currentClientID=${this.lobbyCreatorClientID}
            .teamCount=${this.teamCount}
            .nationCount=${this.nations}
            .onKickPlayer=${this.publiclyListed
              ? undefined
              : (clientID: string) => this.kickPlayer(clientID)}
            .hegemonSeat=${this.hegemonSeat}
            .onSeatHegemon=${(clientID: string) => this.seatHegemon(clientID)}
            .onToggleNameReveal=${(clientID: string) =>
              this.toggleNameReveal(clientID)}
            .nameReveals=${this.nameReveals}
            .anonymizeNames=${this.anonymizeNames}
          ></lobby-player-view>
        </div>

        <!-- Player List / footer -->
        <div class="p-6 pt-4 border-t border-white/10 bg-black/20 shrink-0">
          <o-button
            variant=${secondsRemaining !== null ? "warning" : "primary"}
            width="block"
            size="lg"
            .title=${statusLabel}
            .uppercase=${secondsRemaining === null}
            ?disable=${this.lobbyStartAt === null && this.clients.length < 2}
            @click=${this.toggleGameStartTimer}
          ></o-button>
        </div>

        ${this.showSubscriptionRequired
          ? html`<confirm-dialog
              .heading=${translateText(
                "host_modal.subscription_required_title",
              )}
              .message=${translateText("host_modal.subscription_required_body")}
              variant="warning"
              .showClose=${true}
              .buttons=${"confirmOnly"}
              .confirmText=${translateText("host_modal.view_subscriptions")}
              @cancel=${() => (this.showSubscriptionRequired = false)}
              @confirm=${() => {
                this.showSubscriptionRequired = false;
                window.location.href = "/#modal=store&tab=subscriptions";
              }}
            ></confirm-dialog>`
          : ""}
      </div>
    `;
  }

  protected onOpen(args?: Record<string, unknown>): void {
    // Re-armed here (not in onClose's reset) so that once
    // closeWithoutLeaving() disarms it, no close cascade — e.g. another
    // modal's close() navigating via showPage, which force-closes this one —
    // can re-arm it and disconnect the host mid game-start.
    this.leaveLobbyOnClose = true;
    this.startLobbyUpdates();
    void getUserMe().then((userMe) => {
      // Dev skips the entitlement gate (matching the server) so the
      // listing flow is testable locally.
      this.canListPublicly =
        ClientEnv.env() === GameEnv.Dev ||
        (userMe !== false && userMe.player.canCreatePublicLobbies);
    });

    // Attach mode: the server already minted this successor lobby with us as
    // creator (win-screen "New lobby" flow), so bind to the existing id instead
    // of creating another game.
    const existingLobbyId =
      typeof args?.existingLobbyId === "string" ? args.existingLobbyId : null;
    if (existingLobbyId !== null) {
      this.attachToExistingLobby(existingLobbyId).catch(() => {
        // Clear clipboard so the host doesn't accidentally share a dead link,
        // matching the createLobby() failure path below.
        void navigator.clipboard.writeText("").catch(() => {});
      });
      this.loadNationCount();
      return;
    }

    // The server mints the game id, so we don't know it until createLobby
    // resolves. clientID is assigned by the server when we join the lobby.

    // Pass auth token for creator identification (server extracts persistentID from it)
    createLobby()
      .then(async (lobby) => {
        this.lobbyId = lobby.gameID;
        if (!isValidGameID(this.lobbyId)) {
          throw new Error(`Invalid lobby ID format: ${this.lobbyId}`);
        }

        // Now that we have the id, build and copy the share link. If lobby
        // creation fails, the catch below clears the clipboard.
        const url = await this.constructUrl();
        this.updateLobbyHistory(url);
        await this.updateComplete;
        void (this.querySelector("copy-button") as CopyButton)?.handleCopy();
      })
      .then(() => {
        this.dispatchEvent(
          new CustomEvent("join-lobby", {
            detail: {
              gameID: this.lobbyId,
              source: "host",
            } as JoinLobbyEvent,
            bubbles: true,
            composed: true,
          }),
        );
      })
      .catch(() => {
        // Clear clipboard so the host doesn't accidentally share a dead link
        void navigator.clipboard.writeText("").catch(() => {});
      });
    // BaseModal.firstUpdated() owns modalEl.onClose so the o-modal close path
    // (backdrop / close button) runs confirmBeforeClose(). Don't override it
    // here — doing so would bypass the leave-lobby confirmation.
    this.loadNationCount();
  }

  // Bind the host view to a lobby the server already created (the successor of a
  // finished game). Mirrors the createLobby() success path, minus the creation.
  private async attachToExistingLobby(lobbyId: string): Promise<void> {
    if (!isValidGameID(lobbyId)) {
      throw new Error(`Invalid lobby ID format: ${lobbyId}`);
    }
    this.lobbyId = lobbyId;
    this.hydrateFromLobby = true;

    const url = await this.constructUrl();
    this.updateLobbyHistory(url);
    await this.updateComplete;
    void (this.querySelector("copy-button") as CopyButton)?.handleCopy();

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: this.lobbyId,
          source: "host",
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private leaveLobby() {
    if (!this.lobbyId) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("leave-lobby", {
        detail: { lobby: this.lobbyId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // Main.ts dispatches "join-failed" when the host's own join died before it
  // had a connection (the bot check refused, say). The lobby exists on the
  // server with nobody in it; closing leaves it (onClose) and returns the
  // host to the menu. Main has told them why.
  private readonly handleJoinFailed = (event: CustomEvent<JoinFailedEvent>) => {
    if (
      !this.isModalOpen ||
      !this.lobbyId ||
      event.detail.gameID !== this.lobbyId
    ) {
      return;
    }
    this.close();
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("join-failed", this.handleJoinFailed);
  }

  disconnectedCallback() {
    document.removeEventListener("join-failed", this.handleJoinFailed);
    super.disconnectedCallback();
  }

  // Close as part of the lobby -> game transition (e.g. auto-start of a
  // listed lobby): the host is entering the game, not leaving the lobby, so
  // closing must not disconnect them (the server would tear the lobby down).
  // disarmLeaveOnClose is separate because closing ANY page-modal navigates
  // via showPage, which force-closes the currently visible page — so all
  // lobby modals must be disarmed before any of them is closed.
  public disarmLeaveOnClose() {
    this.leaveLobbyOnClose = false;
  }

  public closeWithoutLeaving() {
    this.disarmLeaveOnClose();
    this.close();
  }

  public confirmBeforeClose(): boolean | Promise<boolean> {
    return this.confirmClose(translateText("host_modal.leave_confirmation"));
  }

  protected onClose(): void {
    console.log("Closing host lobby modal");
    this.stopLobbyUpdates();
    if (this.leaveLobbyOnClose) {
      this.leaveLobby();
      this.updateHistory("/"); // Reset URL to base
    }

    // Clean up timers and resources
    if (this.botsUpdateTimer !== null) {
      clearTimeout(this.botsUpdateTimer);
      this.botsUpdateTimer = null;
    }
    if (this.nationsUpdateTimer !== null) {
      clearTimeout(this.nationsUpdateTimer);
      this.nationsUpdateTimer = null;
    }

    // Reset all transient form state to ensure clean slate
    this.selectedMap = GameMapType.EventHorizon;
    this.selectedDifficulty = Difficulty.Easy;
    this.nations = 0;
    this.defaultNationCount = 0;
    this.gameMode = GameMode.FFA;
    this.teamCount = 2;
    this.bots = 400;
    this.spawnImmunity = false;
    this.spawnImmunityDurationMinutes = undefined;
    this.infiniteGold = false;
    this.donateGold = false;
    this.infiniteTroops = false;
    this.donateTroops = false;
    this.maxTimer = true;
    this.maxTimerValue = 20;
    this.hegemonSeat = null;
    this.startDelayValue = 3;
    this.instantBuild = false;
    this.randomSpawn = false;
    this.compactMap = false;
    this.useRandomMap = false;
    this.disabledUnits = [];
    this.lobbyId = "";
    this.clients = [];
    this.lobbyCreatorClientID = "";
    this.goldMultiplier = false;
    this.goldMultiplierValue = undefined;
    this.startingGold = false;
    this.startingGoldValue = undefined;
    this.customAlliances = false;
    this.customAllianceMinutes = undefined;
    this.doomsdayClock = false;
    this.doomsdayClockSpeed = "normal";
    this.overtime = false;
    this.overtimeStartMinutes = undefined;
    this.anonymizeNames = false;
    this.nameReveals = [];
    this.whitelistEnabled = false;
    this.allowedPublicIds = "";
    this.waterNukes = false;
    this.piracy = true;
    this.hostCheatsEnabled = false;
    this.hostCheatInfiniteGold = false;
    this.hostCheatInfiniteTroops = false;
    this.hostCheatGoldMultiplier = false;
    this.hostCheatGoldMultiplierValue = undefined;
    this.hostCheatStartingGold = false;
    this.hostCheatStartingGoldValue = undefined;
    this.publiclyListed = false;
    this.showSubscriptionRequired = false;
    this.autoStartAt = null;
  }

  private async handleSelectRandomMap() {
    this.useRandomMap = true;
    this.selectedMap = getRandomMapType();
    await this.loadNationCount();
    this.putGameConfig();
  }

  private handleConfigRandomMapSelected = () => {
    void this.handleSelectRandomMap();
  };

  private async handleMapSelection(value: GameMapType) {
    this.selectedMap = value;
    this.useRandomMap = false;
    await this.loadNationCount();
    this.putGameConfig();
  }

  private handleConfigMapSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ map: GameMapType }>;
    void this.handleMapSelection(customEvent.detail.map);
  };

  private async handleDifficultySelection(value: Difficulty) {
    this.selectedDifficulty = value;
    this.putGameConfig();
  }

  private handleConfigDifficultySelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ difficulty: Difficulty }>;
    void this.handleDifficultySelection(customEvent.detail.difficulty);
  };

  private handleConfigDoomsdayClockSpeedSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ speed: DoomsdayClockSpeed }>;
    this.doomsdayClockSpeed = customEvent.detail.speed;
    this.putGameConfig();
  };

  private handleConfigGameModeSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ mode: GameMode }>;
    void this.handleGameModeSelection(customEvent.detail.mode);
  };

  private handleConfigTeamCountSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ count: TeamCountConfig }>;
    void this.handleTeamCountSelection(customEvent.detail.count);
  };

  private handleConfigOptionToggleChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{
      labelKey: string;
      checked: boolean;
    }>;
    const { labelKey, checked } = customEvent.detail;

    switch (labelKey) {
      case "game_settings.instant_build":
        this.handleInstantBuildChange(checked);
        break;
      case "game_settings.random_spawn":
        this.handleRandomSpawnChange(checked);
        break;
      case "host_modal.donate_gold":
        this.handleDonateGoldChange(checked);
        break;
      case "host_modal.donate_troops":
        this.handleDonateTroopsChange(checked);
        break;
      case "game_settings.infinite_gold":
        this.handleInfiniteGoldChange(checked);
        break;
      case "game_settings.infinite_troops":
        this.handleInfiniteTroopsChange(checked);
        break;
      case "game_settings.compact_map":
        this.handleCompactMapChange(checked);
        break;
      case "host_modal.anonymous_players":
        this.anonymizeNames = checked;
        this.putGameConfig();
        break;
      case "game_settings.water_nukes":
        this.waterNukes = checked;
        this.putGameConfig();
        break;
      case "game_settings.piracy":
        this.piracy = checked;
        this.putGameConfig();
        break;
      case "game_settings.doomsday_clock":
        this.doomsdayClock = checked;
        this.putGameConfig();
        break;
      case "host_modal.host_cheats":
        this.hostCheatsEnabled = checked;
        this.putGameConfig();
        break;
      default:
        break;
    }
  };

  private handleConfigHostCheatToggleChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{
      labelKey: string;
      checked: boolean;
    }>;
    const { labelKey, checked } = customEvent.detail;

    switch (labelKey) {
      case "game_settings.infinite_gold":
        this.hostCheatInfiniteGold = checked;
        this.putGameConfig();
        break;
      case "game_settings.infinite_troops":
        this.hostCheatInfiniteTroops = checked;
        this.putGameConfig();
        break;
      default:
        break;
    }
  };

  private handleConfigUnitToggleChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{ unit: UnitType; checked: boolean }>;
    const { unit, checked } = customEvent.detail;
    this.disabledUnits = getUpdatedDisabledUnits(
      this.disabledUnits,
      unit,
      checked,
    );
    this.putGameConfig();
  };

  // Modified to include debouncing
  private handleBotsChange = (e: Event) => {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }

    // Update the display value immediately
    this.bots = value;

    // Clear any existing timer
    if (this.botsUpdateTimer !== null) {
      clearTimeout(this.botsUpdateTimer);
    }

    // Set a new timer to call putGameConfig after 300ms of inactivity
    this.botsUpdateTimer = window.setTimeout(() => {
      this.putGameConfig();
      this.botsUpdateTimer = null;
    }, 300);
  };

  private handleInstantBuildChange = (val: boolean) => {
    this.instantBuild = val;
    this.putGameConfig();
  };

  private handleMaxTimerToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.maxTimer = checked;
    this.maxTimerValue = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleOvertimeToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.overtime = checked;
    this.overtimeStartMinutes = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleOvertimeMinutesKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e"]);
  };

  private handleOvertimeMinutesInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, {
      min: 1,
      max: 120,
      stripPattern: /[e+-]/gi,
    });
    if (value === undefined) {
      return;
    }
    this.overtimeStartMinutes = value;
    this.putGameConfig();
  };

  private handleSpawnImmunityToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.spawnImmunity = checked;
    this.spawnImmunityDurationMinutes = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleGoldMultiplierToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.goldMultiplier = checked;
    this.goldMultiplierValue = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleStartingGoldToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.startingGold = checked;
    this.startingGoldValue = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleSpawnImmunityDurationKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e", "E"]);
  };

  private handleSpawnImmunityDurationInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, { min: 0, max: 120 });
    if (value === undefined) {
      return;
    }
    this.spawnImmunityDurationMinutes = value;
    this.putGameConfig();
  };

  private handleCustomAlliancesToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.customAlliances = checked;
    this.customAllianceMinutes = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleCustomAllianceMinutesKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e", "E"]);
  };

  private handleCustomAllianceMinutesInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, { min: 0, max: 15 });
    if (value === undefined) {
      return;
    }
    this.customAllianceMinutes = value;
    this.putGameConfig();
  };

  private handleGoldMultiplierValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["+", "-", "e", "E"]);
  };

  private handleGoldMultiplierValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, { min: 0.1, max: 1000 });

    if (value === undefined) {
      this.goldMultiplierValue = undefined;
      input.value = "";
    } else {
      this.goldMultiplierValue = value;
    }
    this.putGameConfig();
  };

  private handleStartingGoldValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e", "E"]);
  };

  private handleStartingGoldValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, {
      min: 0.1,
      max: 1000,
    });

    if (value === undefined) {
      this.startingGoldValue = undefined;
      input.value = "";
    } else {
      this.startingGoldValue = value;
    }
    this.putGameConfig();
  };

  private handleHostCheatGoldMultiplierToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.hostCheatGoldMultiplier = checked;
    this.hostCheatGoldMultiplierValue = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleHostCheatGoldMultiplierValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["+", "-", "e", "E"]);
  };

  private handleHostCheatGoldMultiplierValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, { min: 0.1, max: 1000 });

    if (value === undefined) {
      this.hostCheatGoldMultiplierValue = undefined;
      input.value = "";
    } else {
      this.hostCheatGoldMultiplierValue = value;
    }
    this.putGameConfig();
  };

  private handleHostCheatStartingGoldToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.hostCheatStartingGold = checked;
    this.hostCheatStartingGoldValue = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleHostCheatStartingGoldValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e", "E"]);
  };

  private handleHostCheatStartingGoldValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, {
      min: 0.1,
      max: 1000,
    });

    if (value === undefined) {
      this.hostCheatStartingGoldValue = undefined;
      input.value = "";
    } else {
      this.hostCheatStartingGoldValue = value;
    }
    this.putGameConfig();
  };

  private handleRandomSpawnChange = (val: boolean) => {
    this.randomSpawn = val;
    this.putGameConfig();
  };

  private handleInfiniteGoldChange = (val: boolean) => {
    this.infiniteGold = val;
    this.putGameConfig();
  };

  private handleDonateGoldChange = (val: boolean) => {
    this.donateGold = val;
    this.putGameConfig();
  };

  private handleInfiniteTroopsChange = (val: boolean) => {
    this.infiniteTroops = val;
    this.putGameConfig();
  };

  private handleCompactMapChange = (val: boolean) => {
    this.compactMap = val;
    this.bots = getBotsForCompactMap(this.bots, val);
    this.nations = getNationsForCompactMap(
      this.nations,
      this.defaultNationCount,
      val,
    );
    this.putGameConfig();
  };

  private handleDonateTroopsChange = (val: boolean) => {
    this.donateTroops = val;
    this.putGameConfig();
  };

  private handleMaxTimerValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e"]);
  };

  private handleMaxTimerValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, {
      min: 1,
      max: 120,
      stripPattern: /[e+-]/gi,
    });

    if (value === undefined) {
      return;
    }
    this.maxTimerValue = value;
    this.putGameConfig();
  };

  private handleStartDelayValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e", "E", "."]);
  };

  private handleStartDelayValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, {
      min: 0,
      max: 600,
    });

    if (value === undefined) {
      this.startDelayValue = undefined;
      input.value = "";
    } else {
      this.startDelayValue = value;
    }
    this.putGameConfig();
  };

  private handleNationsChange = (e: Event) => {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.nations = value;

    if (this.nationsUpdateTimer !== null) {
      clearTimeout(this.nationsUpdateTimer);
    }
    this.nationsUpdateTimer = window.setTimeout(() => {
      this.putGameConfig();
      this.nationsUpdateTimer = null;
    }, 300);
  };

  // The form from a lobby's config (the successor of a finished round). The
  // inverse of putGameConfig, field for field.
  private applyConfig(c: GameConfig) {
    this.selectedMap = c.gameMap;
    this.useRandomMap = c.randomMap ?? false;
    this.compactMap = c.gameMapSize === GameMapSize.Compact;
    this.selectedDifficulty = c.difficulty;
    this.bots = c.bots;
    this.infiniteGold = c.infiniteGold;
    this.donateGold = c.donateGold;
    this.infiniteTroops = c.infiniteTroops;
    this.donateTroops = c.donateTroops;
    this.instantBuild = c.instantBuild;
    this.randomSpawn = c.randomSpawn ?? false;
    this.gameMode = c.gameMode;
    this.teamCount = c.playerTeams ?? 2;
    this.disabledUnits = c.disabledUnits ?? [];
    this.spawnImmunity =
      c.spawnImmunityDuration !== null && c.spawnImmunityDuration !== undefined;
    this.spawnImmunityDurationMinutes = c.spawnImmunityDuration
      ? c.spawnImmunityDuration / 600
      : undefined;
    this.maxTimer = c.maxTimerValue !== null && c.maxTimerValue !== undefined;
    this.maxTimerValue = c.maxTimerValue ?? undefined;
    this.startDelayValue = c.startDelay ?? 3;
    this.goldMultiplier =
      c.goldMultiplier !== null && c.goldMultiplier !== undefined;
    this.goldMultiplierValue = c.goldMultiplier ?? undefined;
    this.startingGold = c.startingGold !== null && c.startingGold !== undefined;
    this.startingGoldValue =
      c.startingGold !== null && c.startingGold !== undefined
        ? c.startingGold / 1_000_000
        : undefined;
    this.customAlliances =
      c.customAllianceDuration !== null &&
      c.customAllianceDuration !== undefined;
    this.customAllianceMinutes = c.customAllianceDuration ?? undefined;
    this.doomsdayClock = c.doomsdayClock?.enabled ?? false;
    this.doomsdayClockSpeed = c.doomsdayClock?.speed ?? "normal";
    this.overtime = c.overtime?.enabled ?? false;
    this.overtimeStartMinutes = c.overtime?.startMinutes;
    this.anonymizeNames = c.anonymizeNames ?? false;
    this.nameReveals = c.nameReveals ?? [];
    this.whitelistEnabled = (c.allowedPublicIds?.length ?? 0) > 0;
    this.allowedPublicIds = (c.allowedPublicIds ?? []).join(", ");
    this.waterNukes = c.waterNukes ?? false;
    this.piracy = c.piracy?.enabled ?? false;
    this.hegemonSeat = c.hegemon?.seat ?? null;
    this.hostCheatsEnabled = c.hostCheats !== undefined;
    this.hostCheatInfiniteGold = c.hostCheats?.infiniteGold ?? false;
    this.hostCheatInfiniteTroops = c.hostCheats?.infiniteTroops ?? false;
    this.hostCheatGoldMultiplier =
      c.hostCheats?.goldMultiplier !== null &&
      c.hostCheats?.goldMultiplier !== undefined;
    this.hostCheatGoldMultiplierValue =
      c.hostCheats?.goldMultiplier ?? undefined;
    this.hostCheatStartingGold =
      c.hostCheats?.startingGold !== null &&
      c.hostCheats?.startingGold !== undefined;
    this.hostCheatStartingGoldValue =
      c.hostCheats?.startingGold !== null &&
      c.hostCheats?.startingGold !== undefined
        ? c.hostCheats.startingGold / 1_000_000
        : undefined;
    // The nations slider needs the map's default count, loaded per map.
    void this.loadNationCount().then(() => {
      if (this.selectedMap === c.gameMap) {
        this.nations = nationsConfigToSlider(
          c.nations,
          this.defaultNationCount,
        );
      }
    });
  }

  private seatHegemon(clientID: string) {
    this.hegemonSeat = this.hegemonSeat === clientID ? null : clientID;
    this.putGameConfig();
  }

  private async handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
    if (this.gameMode === GameMode.Team) {
      this.donateGold = true;
      this.donateTroops = true;
    } else {
      this.donateGold = false;
      this.donateTroops = false;
    }
    this.putGameConfig();
  }

  private async handleTeamCountSelection(value: TeamCountConfig) {
    this.teamCount = value;
    this.putGameConfig();
  }

  private handleWhitelistToggle = (checked: boolean) => {
    this.whitelistEnabled = checked;
    this.putGameConfig();
  };

  // Server-authoritative: it re-verifies the subscription and enforces the
  // listing limits, so a failed request reverts the toggle.
  private async handlePublicListingToggle(checked: boolean) {
    this.listingRequestInFlight = true;
    this.publiclyListed = checked;
    const result = await setLobbyListed(this.lobbyId, checked);
    if (result.ok) {
      this.publiclyListed = result.listed;
    } else {
      this.publiclyListed = !checked;
      this.showListingError(result.error);
    }
    this.listingRequestInFlight = false;
  }

  private showListingError(serverError?: string) {
    let key = "private_lobby.listing_failed";
    if (serverError === "subscription_required") {
      key = "private_lobby.listing_requires_subscription";
    } else if (serverError === "listing_limit_reached") {
      key = "private_lobby.listing_limit_reached";
    } else if (serverError === "listing_whitelist_enabled") {
      key = "private_lobby.listing_whitelist_enabled";
    } else if (serverError === "listing_host_cheats_enabled") {
      key = "private_lobby.listing_host_cheats_enabled";
    } else if (serverError === "listing_full") {
      key = "private_lobby.listing_full";
    }
    showToast(translateText(key), "red", 3000);
  }

  private handleAllowedPublicIdsChange = (e: Event) => {
    this.allowedPublicIds = (e.target as HTMLInputElement).value;
    this.putGameConfig();
  };

  // Comma/space/newline-separated publicIds, capped at the 200 the schema
  // allows so a large paste can't make the config update fail validation.
  // Undefined when empty (no allowlist).
  private parseAllowedPublicIds(): string[] | undefined {
    const ids = this.allowedPublicIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 200);
    return ids.length > 0 ? ids : undefined;
  }

  private async putGameConfig() {
    const spawnImmunityTicks = this.spawnImmunityDurationMinutes
      ? this.spawnImmunityDurationMinutes * 60 * 10
      : 0;
    const url = await this.constructUrl();
    this.updateLobbyHistory(url);
    this.dispatchEvent(
      new CustomEvent("update-game-config", {
        detail: {
          config: {
            gameMap: this.selectedMap,
            // The server picks the map at prestart when this is set; the
            // gameMap above is then only a placeholder.
            randomMap: this.useRandomMap,
            gameMapSize: this.compactMap
              ? GameMapSize.Compact
              : GameMapSize.Normal,
            difficulty: this.selectedDifficulty,
            bots: this.bots,
            infiniteGold: this.infiniteGold,
            donateGold: this.donateGold,
            infiniteTroops: this.infiniteTroops,
            donateTroops: this.donateTroops,
            instantBuild: this.instantBuild,
            randomSpawn: this.randomSpawn,
            gameMode: this.gameMode,
            disabledUnits: this.disabledUnits,
            spawnImmunityDuration: this.spawnImmunity
              ? spawnImmunityTicks
              : null,
            playerTeams: this.teamCount,
            nations: sliderToNationsConfig(
              this.nations,
              this.defaultNationCount,
            ),
            maxTimerValue: this.maxTimer === true ? this.maxTimerValue : null,
            startDelay: this.startDelayValue,
            goldMultiplier:
              this.goldMultiplier === true ? this.goldMultiplierValue : null,
            startingGold:
              this.startingGold === true && this.startingGoldValue !== undefined
                ? Math.round(this.startingGoldValue * 1_000_000)
                : null,
            customAllianceDuration: this.customAlliances
              ? (this.customAllianceMinutes ?? 0)
              : null,
            // Send {enabled:false} (not undefined) when off: undefined is dropped
            // by JSON.stringify, so the server's "!== undefined" merge would keep a
            // previously-enabled config and the toggle could never turn off.
            doomsdayClock: this.doomsdayClock
              ? { enabled: true, speed: this.doomsdayClockSpeed }
              : { enabled: false },
            // Same {enabled:false} rule as doomsdayClock above: undefined is
            // dropped by JSON.stringify, so the toggle could never turn off.
            overtime: this.overtime
              ? {
                  enabled: true,
                  startMinutes: this.overtimeStartMinutes ?? 30,
                }
              : { enabled: false },
            anonymizeNames: this.anonymizeNames,
            nameReveals: this.nameReveals,
            // Always on (the server enforces it); only the seat is ours.
            hegemon: {
              enabled: true,
              ...(this.hegemonSeat !== null ? { seat: this.hegemonSeat } : {}),
            },
            allowedPublicIds: this.whitelistEnabled
              ? (this.parseAllowedPublicIds() ?? [])
              : [],
            waterNukes: this.waterNukes ? true : null,
            // {enabled:false} when off, as doomsdayClock above.
            piracy: { enabled: this.piracy },
            hostCheats: this.hostCheatsEnabled
              ? {
                  infiniteGold: this.hostCheatInfiniteGold || undefined,
                  infiniteTroops: this.hostCheatInfiniteTroops || undefined,
                  goldMultiplier:
                    this.hostCheatGoldMultiplier === true
                      ? this.hostCheatGoldMultiplierValue
                      : null,
                  startingGold:
                    this.hostCheatStartingGold === true &&
                    this.hostCheatStartingGoldValue !== undefined
                      ? Math.round(this.hostCheatStartingGoldValue * 1_000_000)
                      : null,
                }
              : undefined,
          } satisfies Partial<GameConfig>,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private toggleNameReveal(clientID: string) {
    this.nameReveals = this.nameReveals.includes(clientID)
      ? this.nameReveals.filter((c) => c !== clientID)
      : [...this.nameReveals, clientID];
    this.putGameConfig();
  }

  private async toggleGameStartTimer() {
    await this.putGameConfig();
    console.log(
      `Starting private game with map: ${GameMapType[this.selectedMap as keyof typeof GameMapType]} ${this.useRandomMap ? " (Randomly selected)" : ""}`,
    );

    // If the modal closes as part of starting the game, do not leave the lobby
    this.leaveLobbyOnClose = false;

    this.dispatchEvent(
      new CustomEvent("toggle_game_start_timer", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private kickPlayer(clientID: string) {
    this.dispatchEvent(
      new CustomEvent("kick-player", {
        detail: { target: clientID },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async loadNationCount() {
    const currentMap = this.selectedMap;
    try {
      const mapData = this.mapLoader.getMapData(currentMap);
      const manifest = await mapData.manifest();
      // Only update if the map hasn't changed
      if (this.selectedMap === currentMap) {
        this.defaultNationCount = manifest.nations.length;
        this.nations = this.compactMap
          ? Math.max(0, Math.floor(manifest.nations.length * 0.25))
          : manifest.nations.length;
      }
    } catch (error) {
      console.warn("Failed to load nation count", error);
      // Leave existing values unchanged so the UI stays consistent
    }
  }
}
