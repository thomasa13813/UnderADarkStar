import { ClientEnv } from "src/client/ClientEnv";
import { UserMeResponse } from "../core/ApiSchemas";
import { assetUrl } from "../core/AssetUrls";
import { EventBus } from "../core/EventBus";
import {
  GAME_ID_REGEX,
  GameInfo,
  GameRecord,
  GameStartInfo,
  PublicGameInfo,
} from "../core/Schemas";
import { toWireGameStartInfo } from "../core/Util";
import { GameEnv } from "../core/configuration/Config";
import { UserSettings } from "../core/game/UserSettings";
import { getUserMe } from "./Api";
import { userAuth } from "./Auth";
import { joinOwnsInFlightFlag } from "./BootInterrupts";
import { joinLobby, type JoinLobbyResult } from "./ClientGameRunner";
import { getPlayerCosmeticsRefs } from "./Cosmetics";
import "./GameModeSelector";
import { GameModeSelector, joinIsGateable } from "./GameModeSelector";
import { GameStartingModal } from "./GameStartingModal";
import { HostLobbyModal as HostPrivateLobbyModal } from "./HostLobbyModal";
import { showInGameAlert, showInGameConfirm } from "./InGameModal";
import { JoinLobbyModal } from "./JoinLobbyModal";
import "./LangSelector";
import { LangSelector } from "./LangSelector";
import { initLayout } from "./Layout";
import "./LeaderboardModal";
import {
  hideMenuChrome,
  menuChromeIsTornDown,
  restoreMenuChrome,
} from "./MenuChrome";
import { modalRouter } from "./ModalRouter";
import { initNavigation } from "./Navigation";
import { setOwnJoinName } from "./OwnName";
import { capturePagePin } from "./PagePin";
import { fallbackPlayerName } from "./PlayerName";
import {
  ensureServerList,
  redirectToGameVersion,
  startServerListPolling,
} from "./ServerList";
import "./SinglePlayerModal";
// Reached by URL only (#modal=troubleshooting, linked from the wiki's
// Troubleshooting page), so nothing else imports it.
import { SinglePlayerModal } from "./SinglePlayerModal";
import {
  SendKickPlayerIntentEvent,
  SendToggleGameStartTimer,
  SendUpdateGameConfigIntentEvent,
} from "./Transport";
import "./TroubleshootingModal";
import {
  setTurnstileDialogVisible,
  TURNSTILE_CONTAINER_SELECTOR,
} from "./TurnstileDialog";
import {
  requestTurnstileToken,
  resolveTurnstileToken,
  TURNSTILE_LOAD_FAILED_CODE,
  TURNSTILE_TIMEOUT_CODE,
  TurnstileError,
  type TurnstileApi,
  type TurnstileToken,
} from "./TurnstileToken";
import "./UserSettingModal";
import "./UsernameInput";
import { UsernameInput } from "./UsernameInput";
import {
  apexPathFor,
  currentPagePath,
  flushReloadToast,
  homeHref,
  incrementGamesPlayed,
  translateText,
} from "./Utils";
import { isReplayShellHost } from "./VersionedReplay";
import { initAudioMixer } from "./sound/AudioMixer";
import { initSoundtrack } from "./sound/Soundtrack";
import {
  installCtrlWheelZoomBlocker,
  installDoubleTapZoomBlocker,
  installSafariPinchZoomBlocker,
} from "./utilities/DisableSafariPinchZoom";

import "./components/DesktopNavBar";
import "./components/DetailedGameViewModal";
import "./components/Footer";
import "./components/MainLayout";
import "./components/MobileNavBar";
import "./components/PlayPage";
import "./components/RoundTransition";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import "./styles.css";
import "./styles/core/typography.css";
import "./styles/core/variables.css";
import "./styles/layout/container.css";
import "./styles/layout/header.css";
import "./styles/modal/chat.css";

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    gtag?: (...args: any[]) => void;
    PageOS: {
      session: {
        newPageView: () => void;
      };
    };
    ramp: {
      que: Array<() => void>;
      passiveMode: boolean;
      spaAddAds: (ads: Array<{ type: string; selectorId?: string }>) => void;
      destroyUnits: (adType: string | string[]) => Promise<void>;
      settings?: {
        slots?: any;
      };
      spaNewPage: (url?: string) => void;
      spaAds: (config?: {
        ads?: Array<{ type: string; selectorId?: string }>;
        countPageview?: boolean;
        path?: string;
      }) => void;
      // Video ad methods
      onPlayerReady: (() => void) | null;
      addUnits: (units: Array<{ type: string }>) => Promise<void>;
      displayUnits: () => void;
    };
    Bolt: {
      on: (unitType: string, event: string, callback: () => void) => void;
      BOLT_AD_REQUEST_START: string;
      BOLT_AD_IMPRESSION: string;
      BOLT_AD_STARTED: string;
      BOLT_FIRST_QUARTILE: string;
      BOLT_MIDPOINT: string;
      BOLT_THIRD_QUARTILE: string;
      BOLT_AD_COMPLETE: string;
      BOLT_AD_ERROR: string;
      BOLT_AD_PAUSED: string;
      BOLT_AD_CLICKED: string;
      SHOW_HIDDEN_CONTAINER: string;
    };
    currentPageId?: string;
    showPage?: (pageId: string) => void;
  }

  // Extend the global interfaces to include your custom events
  interface DocumentEventMap {
    "join-lobby": CustomEvent<JoinLobbyEvent>;
    // A join that died before it had a connection (see failJoin).
    "join-failed": CustomEvent<JoinFailedEvent>;
    "kick-player": CustomEvent;
    toggle_game_start_timer: CustomEvent;
    "join-changed": CustomEvent;
    userMeResponse: CustomEvent<UserMeResponse | false>;
    "session-cleared": CustomEvent;
    "leave-lobby": CustomEvent;
    "game-starting": CustomEvent;
    "update-game-config": CustomEvent;
  }
}

export interface JoinFailedEvent {
  gameID: string;
}

export interface JoinLobbyEvent {
  // Multiplayer games only have gameID, gameConfig is not known until game starts.
  gameID: string;
  // GameConfig only exists when playing a singleplayer game.
  gameStartInfo?: GameStartInfo;
  // GameRecord exists when replaying an archived game.
  gameRecord?: GameRecord;
  source?: "public" | "private" | "host" | "matchmaking" | "singleplayer";
  publicLobbyInfo?: GameInfo | PublicGameInfo;
  // Watch without playing.
  spectator?: boolean;
}

/**
 * The single point where "a match is running" is published.
 *
 * Two consumers, and they must never disagree:
 *   - the `.in-game` body class, which the client's own markup keys off to hide
 *     the footer, the nav bars and the desktop update snackbar;
 *   - the Electron shell's updater, which pauses asset downloads and version
 *     polling in-game so a cache-bust cannot saturate a player's connection
 *     mid-match.
 *
 * Every add/remove of that class goes through here. Setting the class without
 * telling the shell leaves the updater's pause dead; telling the shell without
 * setting the class leaves downloads paused at a menu forever.
 *
 * `setInGame` is optional by the shell contract (the web build has no bridge at
 * all, and a Steam shell older than the updater has no such method), and the
 * IPC round trip is fire-and-forget: a rejection must never surface as an
 * unhandled rejection in the client.
 */
function setInGameSignal(inGame: boolean): void {
  document.body.classList.toggle("in-game", inGame);
}

class Client {
  private lobbyHandle: JoinLobbyResult | null = null;
  private eventBus: EventBus = new EventBus();

  private currentUrl: string | null = null;

  private usernameInput: UsernameInput | null = null;

  private hostModal: HostPrivateLobbyModal;
  private joinModal: JoinLobbyModal;
  private gameModeSelector: GameModeSelector;
  private userSettings: UserSettings = new UserSettings();
  private mostRecentJoinEvent: number;
  // A join the player has committed to but that has not reached a lobbyHandle
  // yet. `lobbyHandle` alone does not cover this: a public-lobby join awaits
  // userAuth(), whenSeeded(), getPlayerCosmeticsRefs() and
  // getTurnstileToken() before the handle is assigned, and rewrites the URL
  // only once `join` resolves — so throughout that window the page still looks
  // like a pristine homepage and a /users/@me landing in it would open a
  // confirm over a game that is starting.
  private joinInFlight = false;

  private turnstileTokenPromise: Promise<TurnstileToken> | null = null;

  async initialize(): Promise<void> {
    // FIRST, ahead of consumeCreatorCodePath() and of handleUrl() below --
    // ahead of every history write this client performs. A page served under
    // `/v/<commit>/` is pinned to that build, and three guards depend on
    // knowing it (isPinnedToAVersion, currentPagePath, ClientGameRunner's
    // version_mismatch branch). The address bar stops being able to answer
    // the moment updateJoinUrlForShare rewrites it to the version-free share
    // URL, so take the value while it is still the URL we were served at.
    // See PagePin.ts.
    capturePagePin();

    flushReloadToast();

    // One mixer and one soundtrack for the page: the music plays on through
    // the lobby and the game, and the SoundManager a game creates later
    // routes through the same mixer, so the volume sliders reach everything.
    initSoundtrack(initAudioMixer(this.userSettings));

    // Register modals with the URL router. Lobby modals (join/host) are
    // intentionally omitted — they own their own URL state (path-based).
    modalRouter.register("settings", {
      tag: "user-setting",
      pageId: "page-settings",
    });
    modalRouter.register("language", {
      tag: "language-modal",
      pageId: "page-language",
    });
    modalRouter.register("single-player", {
      tag: "single-player-modal",
      pageId: "page-single-player",
    });
    modalRouter.register("detailed-view", {
      tag: "detailed-view-modal",
      pageId: "page-detailed-view",
    });
    modalRouter.register("troubleshooting", {
      tag: "troubleshooting-modal",
      pageId: "page-troubleshooting",
    });

    // Kick the server-list fetch off here, before anything below awaits the
    // network, so it overlaps with the rest of boot: by the time a player
    // can click Join or Create the list is already known and the click
    // never waits on a fetch (docs/MultiServer.md, "Server list v2"). It
    // never throws and keeps itself alive with a heartbeat afterwards.
    startServerListPolling();

    // Prefetch turnstile token so it is available when the user joins a lobby.
    // Skipped on the versioned replay shells: the replay host may not be on
    // the Turnstile site key's domain allowlist,
    // so rendering the widget there just fails — and replays never
    // send a token anyway (see getTurnstileToken below).
    const turnstilePrefetch = isReplayShellHost(window.location.hostname)
      ? null
      : getTurnstileToken();
    // A prefetch that fails is not an error anyone has asked about yet: the
    // join path drops it and fetches once more (see getTurnstileToken below),
    // and only that attempt alerts. Mark it handled here so a boot-time
    // rejection nobody is awaiting yet does not surface as an unhandled one.
    turnstilePrefetch?.catch(() => {});
    this.turnstileTokenPromise = turnstilePrefetch;

    // Wait for components to render before setting version
    await customElements.whenDefined("mobile-nav-bar");
    await customElements.whenDefined("desktop-nav-bar");

    // The display face, Tektur (chosen 2026-10-07; see --font-display in
    // styles.css): a variable font in two subsets, with Overpass Bold behind
    // it as the fallback. Loaded through assetUrl so the hashed CDN path
    // resolves in production.
    const displayFonts = [
      new FontFace("Tektur", `url(${assetUrl("fonts/tektur-latin.woff2")})`, {
        weight: "400 900",
        unicodeRange:
          "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
      }),
      new FontFace(
        "Tektur",
        `url(${assetUrl("fonts/tektur-latin-ext.woff2")})`,
        {
          weight: "400 900",
          unicodeRange:
            "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
        },
      ),
      new FontFace("Overpass", `url(${assetUrl("fonts/overpass-bold.woff")})`, {
        weight: "700",
      }),
      // The game's own pixel face (2026-10-24), from branding/; --font-pixel
      // in styles.css. Without it (a fork) the text falls back to Tektur.
      new FontFace(
        "DarkStar Pixel",
        `url(${assetUrl("fonts/darkstar-pixel.woff2")})`,
      ),
    ];
    for (const font of displayFonts) {
      document.fonts.add(font);
      font.load().catch(() => {});
    }

    const langSelector = document.querySelector(
      "lang-selector",
    ) as LangSelector;
    if (!langSelector) {
      console.warn("Lang selector element not found");
    }

    this.usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    if (!this.usernameInput) {
      console.warn("Username input element not found");
    }

    this.gameModeSelector = document.querySelector(
      "game-mode-selector",
    ) as GameModeSelector;

    window.addEventListener("beforeunload", async () => {
      console.log("Browser is closing");
      if (this.lobbyHandle !== null) {
        // Leaving a game by navigating away (the popstate path's
        // `window.location.href = "/"`, or a desktop renderer reload) tears the
        // page down without ever running handleLeaveLobby, so nothing else
        // clears the in-game signal. The body class dies with the document, but
        // the shell's updater lives in the main process and would stay paused
        // forever -- no downloads, no polling -- for the rest of the session.
        setInGameSignal(false);
        this.lobbyHandle.stop(true);
      }
    });

    document.addEventListener("join-lobby", (event) => {
      // A rejected handshake (Turnstile alerts then rejects) never assigns
      // lobbyHandle, so nothing downstream ever hears that the join is over.
      void this.handleJoinLobby(event).catch((error) => {
        console.error("Join failed before it had a connection", error);
        // joinInFlight has exactly the same problem: set when the join
        // committed, and cleared only on the two paths that reach a handle.
        // Left set it would silence every boot interrupt for the rest of the
        // session. Guarded on the timestamp so a join that failed after being
        // superseded cannot clear the flag its successor is relying on.
        if (joinOwnsInFlightFlag(this.mostRecentJoinEvent, event.timeStamp)) {
          this.joinInFlight = false;
          this.failJoin(event.detail.gameID, error);
        }
      });
    });
    document.addEventListener("leave-lobby", this.handleLeaveLobby.bind(this));
    document.addEventListener("kick-player", this.handleKickPlayer.bind(this));
    document.addEventListener(
      "toggle_game_start_timer",
      this.handleToggleGameStartTimer.bind(this),
    );
    document.addEventListener(
      "update-game-config",
      this.handleUpdateGameConfig.bind(this),
    );

    // Tutorial entry point (the play-page card): a default solo game with the
    // guide on, unless a username problem needs fixing first.
    document.addEventListener("start-tutorial", () => {
      if (this.usernameInput && !this.usernameInput.canPlay()) return;
      void (
        document.querySelector("single-player-modal") as SinglePlayerModal
      )?.startTutorial();
    });

    const onUserMe = async (userMeResponse: UserMeResponse | false) => {
      document.dispatchEvent(
        new CustomEvent("userMeResponse", {
          detail: userMeResponse,
          bubbles: true,
          cancelable: true,
        }),
      );

      if (userMeResponse !== false) {
        console.log(
          `Your player ID is ${userMeResponse.player.publicId}\n` +
            "Sharing this ID will allow others to view your game history and stats.",
        );
      }
    };

    // A profile request issued before a logout can still be in flight when the
    // session goes, and its 200 was fetched with a JWT that was valid at the
    // time. Applying it afterwards would put the expired account back in the
    // nav and re-disable ads, so a response is only applied while the session
    // it was fetched under is still current.
    let authGeneration = 0;

    const applyUserMe =
      (generation: number) => (userMeResponse: UserMeResponse | false) => {
        if (generation !== authGeneration) return;
        void onUserMe(userMeResponse);
      };

    // A session dropped in the background — an expired refresh token, a 401 on
    // any endpoint — clears itself deep inside Auth, where none of the above
    // is reachable. Routing it through onUserMe means the nav button, its
    // cached profile and window.adsEnabled all follow, rather than only the
    // components listening for userMeResponse.
    document.addEventListener("session-cleared", () => {
      authGeneration++;
      void onUserMe(false);
    });

    const initialAuthGeneration = authGeneration;
    if ((await userAuth()) === false) {
      // Not logged in: apply the signed-out profile directly.
      applyUserMe(initialAuthGeneration)(false);
    } else {
      // JWT appears valid: fetch the profile and apply it if still current.
      getUserMe().then(applyUserMe(initialAuthGeneration));
    }

    this.hostModal = document.querySelector(
      "host-lobby-modal",
    ) as HostPrivateLobbyModal;
    if (!this.hostModal || !(this.hostModal instanceof HostPrivateLobbyModal)) {
      console.warn("Host private lobby modal element not found");
    } else {
      this.hostModal.eventBus = this.eventBus;
    }

    this.joinModal = document.querySelector(
      "join-lobby-modal",
    ) as JoinLobbyModal;
    if (!this.joinModal || !(this.joinModal instanceof JoinLobbyModal)) {
      console.warn("Join lobby modal element not found");
    } else {
      this.joinModal.eventBus = this.eventBus;
    }

    // Attempt to join lobby from the current URL once the document is ready.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.handleUrl());
    } else {
      this.handleUrl();
    }

    const onHashUpdate = () => {
      // Router-managed hash changes (#modal=...) are handled by the router
      // syncing in/out; we don't need to tear down the lobby state for them.
      if (modalRouter.isHashRouted()) {
        modalRouter.routeFromHash();
        return;
      }

      // Reset the UI to its initial state.
      this.joinModal?.close();

      onJoinChanged();
    };

    const leaveGame = () => {
      // redirect to the home page
      window.location.href = homeHref();
    };

    const onPopState = () => {
      if (this.currentUrl !== null && this.lobbyHandle !== null) {
        console.info("Game is active");

        if (!this.lobbyHandle.stop()) {
          console.info("Player is active, ask before leaving game");

          // We can't block navigation on an async confirmation, so restore the
          // history entry immediately and only leave once the player confirms.
          history.pushState(null, "", this.currentUrl);
          showInGameConfirm(translateText("help_modal.exit_confirmation")).then(
            (isConfirmed) => {
              if (isConfirmed) leaveGame();
            },
          );
          return;
        }

        console.info("Player is not active, leave the game immediately");

        leaveGame();
      } else {
        console.info("Game not active, handle hash update");

        onHashUpdate();
      }
    };

    const onJoinChanged = () => {
      if (this.lobbyHandle !== null) {
        this.handleLeaveLobby();
      }

      // Attempt to join lobby
      this.handleUrl();
    };

    // Handle browser navigation (back/forward) and manual hash edits.
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashUpdate);
    window.addEventListener("join-changed", onJoinChanged);

    function updateSliderProgress(slider: HTMLInputElement) {
      const percent =
        ((Number(slider.value) - Number(slider.min)) /
          (Number(slider.max) - Number(slider.min))) *
        100;
      slider.style.setProperty("--progress", `${percent}%`);
    }

    document
      .querySelectorAll<HTMLInputElement>(
        "#bots-count, #private-lobby-bots-count",
      )
      .forEach((slider) => {
        updateSliderProgress(slider);
        slider.addEventListener("input", () => updateSliderProgress(slider));
      });
  }

  private async handleUrl() {
    // Wait for modal custom elements to be defined
    await Promise.all([
      customElements.whenDefined("join-lobby-modal"),
      customElements.whenDefined("host-lobby-modal"),
    ]);

    const hash = window.location.hash;

    // Decode the hash first to handle encoded characters
    const decodedHash = decodeURIComponent(hash);

    // Handle different hash sections
    // On a versioned replay shell the pathname IS the game id: the worker
    // serves the record's matching build at replay.<domain>/<gameId> (see
    // VersionedReplay.ts).
    if (isReplayShellHost(window.location.hostname)) {
      const replayGameId = window.location.pathname.slice(1);
      if (GAME_ID_REGEX.test(replayGameId)) {
        window.showPage?.("page-join-lobby");
        this.joinModal.open({ lobbyId: replayGameId });
        console.log(`joining replay ${replayGameId}`);
        return;
      }
    }

    // Every version's page is also served under /v/<commit>/ (multi-server
    // v2), so the game path may sit behind that prefix.
    const pathMatch = window.location.pathname.match(
      /^(?:\/v\/[^/]+)?\/(?:w\d+\/)?game\/([^/]+)/,
    );
    const lobbyId =
      pathMatch && GAME_ID_REGEX.test(pathMatch[1]) ? pathMatch[1] : null;
    if (lobbyId) {
      // Joining needs the API's server list (multi-server v2): the id's
      // letter names the game's server there. No version check: joining an
      // existing game is not starting something new, and the id's letter
      // names its server whatever version that server runs.
      await ensureServerList();
      // A letter this shell's cluster map doesn't know means the map
      // predates the game's deployment (stale CDN shell, or a link into a
      // newer fleet). The apex always serves the freshest map, so re-enter
      // through it; on the apex itself (and dev/desktop) fall through to
      // the join flow's normal not-found handling.
      if (this.redirectUnknownLetterToApex(lobbyId)) return;
      // The game's server may run a different build than this page (a link
      // into a version still draining, or a page served as `latest` after a
      // deploy). Open it at that version's page rather than trying to play
      // it with the wrong bundle. The whole rule -- the loop guard, and the
      // desktop and replay shells that must never be navigated -- lives in
      // redirectToGameVersion.
      if (redirectToGameVersion(lobbyId)) return;
      // ?host means the lobby creator is returning to a successor lobby they
      // reused from the win screen: reopen the host view bound to the existing
      // lobby instead of the join flow. Non-creators who hit this URL still get
      // treated as normal joiners by the server.
      const returningAsHost = new URLSearchParams(window.location.search).has(
        "host",
      );
      if (returningAsHost) {
        // open() reveals the inline page itself (it calls showPage internally).
        // Calling showPage first would open the modal once with no args and
        // spuriously create a lobby before this attach call runs.
        this.hostModal.open({ existingLobbyId: lobbyId });
        console.log(`reopening host lobby ${lobbyId}`);
        return;
      }
      // ?spectate is the watch-only form of the same lobby link, so a cast or
      // an archive can hand out a URL that never takes a player slot.
      const spectate = new URLSearchParams(window.location.search).has(
        "spectate",
      );
      window.showPage?.("page-join-lobby");
      this.joinModal.open({ lobbyId, spectate });
      console.log(`${spectate ? "spectating" : "joining"} lobby ${lobbyId}`);
      return;
    }
    if (modalRouter.routeFromHash()) {
      return;
    }
    if (decodedHash.startsWith("#refresh")) {
      window.location.href = homeHref();
    }
  }

  // See the call site in handleUrl. True when a navigation was issued.
  private redirectUnknownLetterToApex(gameID: string): boolean {
    if (!ClientEnv.gameLetterUnknown(gameID)) return false;
    // With the API's list loaded there is nothing fresher to bounce to: an
    // unknown letter means the game does not exist.
    if (ClientEnv.serverListLoaded()) return false;
    // Only load-balanced deployments have an apex to bounce to; standalone
    // ones (beta, branch previews, dev) have no siteHost injected and fall
    // through to the normal not-found flow, as does the apex shell itself
    // (its map is already the freshest; CDN staleness ages out in minutes).
    const apex = ClientEnv.siteHost();
    if (apex === undefined || window.location.host === apex) return false;
    window.location.href = `https://${apex}${apexPathFor(window.location.pathname)}${window.location.search}`;
    return true;
  }

  private async handleJoinLobby(event: CustomEvent<JoinLobbyEvent>) {
    const lobby = event.detail;
    if (this.usernameInput && !this.usernameInput.canPlay()) {
      // The singleplayer modal shows the starting overlay before dispatching
      // join-lobby; a refused join must release it or it stays over the menu.
      const startingModal = document.querySelector("game-starting-modal");
      if (startingModal instanceof GameStartingModal) {
        startingModal.hide();
      }
      return;
    }
    // Only once the join is actually going ahead: a refused dispatch that
    // bumped this would supersede a legitimate join still awaiting userAuth
    // and cosmetics, stopping it as stale and leaving the player nowhere.
    this.mostRecentJoinEvent = event.timeStamp;
    // Cleared on both ways out of the pre-handle window (superseded, or the
    // handle being assigned) and by handleLeaveLobby, which runs its reset
    // above its own lobbyHandle guard precisely because this window exists.
    this.joinInFlight = true;

    console.log(`joining lobby ${lobby.gameID}`);
    if (this.lobbyHandle !== null) {
      console.log("joining lobby, stopping existing game");
      this.lobbyHandle.stop(true);
      setInGameSignal(false);
    }
    if (lobby.source === "public") {
      this.joinModal?.open({
        lobbyId: lobby.gameID,
        lobbyInfo: lobby.publicLobbyInfo,
      });
    }
    // Only update URL immediately for private lobbies, not public ones
    if (lobby.source !== "public") {
      this.updateJoinUrlForShare(lobby.gameID);
    }
    // Singleplayer runs entirely locally, and the session is only used here
    // for the HUD role — the end-of-game archive establishes its own session
    // via getAuthHeader(). So don't let a token refresh block starting a
    // local game (offline on Steam it waits out the 5s ticket timeout):
    // read the cached JWT and refresh in the background instead.
    const isSingleplayer = lobby.source === "singleplayer";
    if (isSingleplayer) {
      void userAuth();
    }
    const auth = await userAuth(!isSingleplayer);
    const playerRole = auth !== false ? (auth.claims.role ?? null) : null;
    // Ensure the one-shot Steam name-seed has settled before reading
    // getUsername(), mirroring how getClanCheck() runs in parallel with the
    // handshake. whenSeeded() always resolves (falling back to the generated
    // anon name on failure/timeout), so this can only delay, never block.
    await this.usernameInput?.whenSeeded();
    // A signed-in player's name is the account's: a rename just typed must
    // reach the API first, since the game server reads the name from there.
    await this.usernameInput?.whenNameSaved();
    // One resolution for the whole join: the name and the verified badge have
    // to describe the same decision, so they are read together rather than
    // asked for separately.
    const resolvedName =
      this.usernameInput?.resolvedName() ?? fallbackPlayerName();
    setOwnJoinName(resolvedName.name, this.usernameInput?.getClanTag() ?? null);
    const newLobbyHandle = joinLobby(this.eventBus, {
      gameID: lobby.gameID,
      cosmetics: await getPlayerCosmeticsRefs({
        verified: resolvedName.verified,
      }),
      turnstileToken: await this.getTurnstileToken(lobby),
      playerName: resolvedName.name,
      playerClanTag: this.usernameInput?.getClanTag() ?? null,
      clanTagCheck: this.usernameInput?.getClanCheck(),
      playerRole,
      gameStartInfo:
        lobby.gameStartInfo ??
        // Replays simulate from the archived record; re-apply the server's
        // wire blanking or team games desync (see toWireGameStartInfo).
        (lobby.gameRecord
          ? toWireGameStartInfo(lobby.gameRecord.info)
          : undefined),
      gameRecord: lobby.gameRecord,
      spectator: lobby.spectator,
    });

    if (this.mostRecentJoinEvent !== event.timeStamp) {
      newLobbyHandle.stop(true);
      console.warn("Join requested, but was superseded");
      // Deliberately NOT clearing joinInFlight. Being here means a newer join
      // has already set it, after this one did, so the flag is that join's and
      // clearing it would re-open the boot interrupts over a lobby the player
      // has committed to. The newer join clears it on its own exits, and if it
      // has already finished, lobbyHandle is the guard. Same ownership rule as
      // joinOwnsInFlightFlag, which is false by construction on this branch.
      return;
    }

    this.lobbyHandle = newLobbyHandle;
    // From here lobbyHandle is the guard.
    this.joinInFlight = false;

    this.lobbyHandle.prestart.then(() => {
      // The game is actually starting now (lobby wait is over). Listeners that
      // stay up through the wait hide at this point instead of on join.
      document.dispatchEvent(new CustomEvent("game-starting"));
      console.log("Closing modals");
      if (this.usernameInput) {
        // fix edge case where username-validation-error is re-rendered and hidden tag removed
        this.usernameInput.validationError = "";
      }
      document
        .getElementById("username-validation-error")
        ?.classList.add("hidden");
      // Disarm BOTH lobby modals before closing either: closing any
      // page-modal navigates via showPage, which force-closes the currently
      // visible page — the other lobby modal. If that one is still armed,
      // its onClose leaves the lobby and disconnects the player mid
      // game-start (host or joiner, depending on close order).
      this.hostModal?.disarmLeaveOnClose();
      this.joinModal?.disarmLeaveOnClose();
      this.hostModal?.closeWithoutLeaving();
      this.joinModal?.closeWithoutLeaving();
      [
        "single-player-modal",
        "game-starting-modal",
        "game-top-bar",
        "user-setting",
        // The in-game instance is addressed by id: querySelector("user-setting")
        // above only ever reaches the page's inline one.
        "#game-settings",
        "troubleshooting-modal",
        "language-modal",
        "steam-link-modal",
        "steam-handoff-modal",
        "lang-selector",
      ].forEach((tag) => {
        const modal = document.querySelector(tag) as HTMLElement & {
          close?: () => void;
          isModalOpen?: boolean;
        };
        if (modal?.close) {
          modal.close();
        } else if (modal && "isModalOpen" in modal) {
          modal.isModalOpen = false;
        }
      });
      this.gameModeSelector.stop();
      hideMenuChrome();

      // show when the game loads
      const startingModal = document.querySelector(
        "game-starting-modal",
      ) as GameStartingModal;
      if (startingModal && startingModal instanceof GameStartingModal) {
        startingModal.show();
      }
    });

    this.lobbyHandle.join.then(() => {
      this.joinModal?.closeWithoutLeaving();
      this.gameModeSelector.stop();
      incrementGamesPlayed();

      hideMenuChrome();

      if (window.PageOS?.session?.newPageView) {
        window.PageOS.session.newPageView();
      }
      setInGameSignal(true);

      const lobbyIdHidden = !this.userSettings.lobbyIdVisibility();
      if (isReplayShellHost(window.location.hostname)) {
        // Keep the canonical replay URL (replay.<domain>/<gameId>): the
        // /game/<id> shape and the #refresh trampoline only exist on the
        // game-server origin, so rewriting here would leave a URL that 404s
        // when reloaded or shared (see VersionedReplay.ts).
        history.pushState(null, "", window.location.pathname);
      } else {
        // Ensure there's a homepage entry in history before adding the lobby entry
        if (window.location.hash === "" || window.location.hash === "#") {
          history.replaceState(null, "", window.location.origin + "#refresh");
        }
        history.pushState(
          null,
          "",
          currentPagePath(
            lobbyIdHidden
              ? "/streamer-mode"
              : `${ClientEnv.gamePath(lobby.gameID)}?live`,
          ),
        );
      }

      // Store current URL for popstate confirmation
      this.currentUrl = window.location.href;
    });
  }

  private updateJoinUrlForShare(lobbyId: string) {
    const lobbyIdHidden = !this.userSettings.lobbyIdVisibility();
    let targetUrl: string;
    if (isReplayShellHost(window.location.hostname)) {
      // Keep the canonical replay URL (replay.<domain>/<gameId>): the
      // /game/<id> shape only exists on the game-server origin, so rewriting
      // here would leave a URL that 404s when reloaded or shared (see
      // VersionedReplay.ts).
      targetUrl = window.location.pathname;
    } else {
      // Version-free on purpose, unlike the in-game entry below: this is the
      // URL people copy out of the address bar to invite someone, and a
      // recipient must be routed to the version the GAME'S server runs
      // (handleUrl -> redirectToGameVersion), not pinned to whatever this
      // page happens to be serving.
      targetUrl = lobbyIdHidden
        ? "/streamer-mode"
        : ClientEnv.gamePath(lobbyId);
    }
    const currentUrl = window.location.pathname;

    if (currentUrl !== targetUrl) {
      history.replaceState(null, "", targetUrl);
    }
  }

  private async handleLeaveLobby(event?: CustomEvent) {
    // Above the guard: a modal closed during the pre-handle window dispatches
    // leave-lobby and returns early, which would otherwise strand the flag
    // set forever.
    this.joinInFlight = false;
    // And supersede whatever join is still in flight. Clearing the flag alone
    // says the player is not joining while the join carries on to assign a
    // handle and start the game they just left; bumping the timestamp makes
    // that join take the superseded branch above and stop itself. Pre-existing
    // on main -- the flag only made it visible. performance.now() is the same
    // clock Event.timeStamp comes from, so this is always newer than any join
    // already under way and older than any dispatched after it.
    this.mostRecentJoinEvent = performance.now();

    if (this.lobbyHandle === null) {
      return;
    }
    console.log("leaving lobby, cancelling game");
    this.lobbyHandle.stop(true);
    this.lobbyHandle = null;
    this.currentUrl = null;

    try {
      history.replaceState(null, "", "/");
    } catch (e) {
      console.warn("Failed to restore URL on leave:", e);
    }

    setInGameSignal(false);

    // The inverse of the game-start teardown. Every other exit from a started
    // game navigates, and the reload did this implicitly; this path leaves in
    // place, so it has to do it explicitly (OPE-255). It lives here rather
    // than in openInvite() because handleLeaveLobby is reached from several
    // places and any of them could be the next to hit it after a teardown.
    //
    // The gate asks whether the chrome is torn down, NOT whether we were
    // in-game: the teardown happens at prestart while the in-game signal is
    // only set at join, so gating on the signal missed a leave landing in the
    // window between them. Because the gate no longer reads that signal, it
    // does not matter that setInGameSignal(false) has already run above.
    if (menuChromeIsTornDown()) {
      this.gameModeSelector?.start();
      restoreMenuChrome();
    }

    if (this.joinModal.isOpen()) {
      this.joinModal.close();
      if (
        event?.detail.cause === "full-lobby" ||
        event?.detail.cause === "game-started"
      ) {
        window.dispatchEvent(
          new CustomEvent("show-message", {
            detail: {
              message: translateText("public_lobby.join_timeout"),
              color: "red",
              duration: 3500,
            },
          }),
        );
      }
    }
  }

  private handleKickPlayer(event: CustomEvent) {
    const { target } = event.detail;

    // Forward to eventBus if available
    if (this.eventBus) {
      this.eventBus.emit(new SendKickPlayerIntentEvent(target));
    }
  }

  private handleToggleGameStartTimer() {
    if (this.eventBus) {
      this.eventBus.emit(new SendToggleGameStartTimer());
    }
  }

  private handleUpdateGameConfig(event: CustomEvent) {
    const { config } = event.detail;

    // Forward to eventBus if available
    if (this.eventBus) {
      this.eventBus.emit(new SendUpdateGameConfigIntentEvent(config));
    }
  }

  // A join that died before it had a handle (the bot check refused, auth
  // failed): the lobby pages are still showing "Connecting to lobby..." and
  // nothing else would ever move them off it. Tell them, and tell the player
  // why -- unless the Turnstile path already has (resolveTurnstileToken shows
  // its own modal for the attempt that decided the join).
  private failJoin(gameID: string, error: unknown) {
    if (!(error instanceof TurnstileError)) {
      void showInGameAlert(translateText("error_modal.join_failed"));
    }
    document.dispatchEvent(
      new CustomEvent<JoinFailedEvent>("join-failed", { detail: { gameID } }),
    );
  }

  private async getTurnstileToken(
    lobby: JoinLobbyEvent,
  ): Promise<string | null> {
    if (
      ClientEnv.env() === GameEnv.Dev ||
      // Single-player and replays: no server to verify a token against (and
      // on the CDN replay shells Turnstile cannot load at all).
      !joinIsGateable(lobby)
    ) {
      return null;
    }

    const prefetch = this.turnstileTokenPromise;
    // Clear promise so a new token is fetched next time. Unconditional: a
    // prefetch that rejected must not be waited on twice either.
    this.turnstileTokenPromise = null;

    return resolveTurnstileToken({
      prefetch,
      requestFresh: getTurnstileToken,
      forceFresh: false,
      onError: (code) =>
        void showInGameAlert(
          code === TURNSTILE_TIMEOUT_CODE
            ? translateText("error_modal.turnstile_timeout")
            : translateText("error_modal.turnstile_error", { code }),
        ),
    });
  }
}

// Initialize the client when the DOM is loaded
const bootstrap = () => {
  // Prevent Safari's page-level pinch-zoom, which ignores `user-scalable=no`
  // on iOS and can softlock the HUD. See issue #2330.
  installSafariPinchZoomBlocker();

  // Same for double-tap "smart zoom", which `touch-action: manipulation`
  // alone does not reliably stop on iOS. See issue #4609.
  installDoubleTapZoomBlocker();

  // Chrome and Firefox report a trackpad pinch as ctrl+wheel, which only the
  // map canvas cancels — so pinching over a HUD panel zoomed the page instead
  // of the map. See issue #5098.
  installCtrlWheelZoomBlocker();

  initLayout();
  new Client().initialize();
  initNavigation();

  // Hide elements immediately
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}

async function getTurnstileToken(): Promise<TurnstileToken> {
  // Wait for Turnstile script to load (handles slow connections)
  let attempts = 0;
  while (window.turnstile === undefined && attempts < 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }

  const turnstile = window.turnstile;
  if (turnstile === undefined) {
    throw new TurnstileError(
      TURNSTILE_LOAD_FAILED_CODE,
      "Failed to load Turnstile script",
    );
  }

  // The render/execute choreography (and why the callbacks go on render)
  // lives in TurnstileToken.ts; the popup the widget appears in, when the
  // check needs the player, in TurnstileDialog.ts.
  return requestTurnstileToken(turnstile, {
    sitekey: ClientEnv.turnstileSiteKey(),
    container: TURNSTILE_CONTAINER_SELECTOR,
    onInteractive: setTurnstileDialogVisible,
  });
}
