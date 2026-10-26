import { GAME_ID_REGEX } from "@openfront/engine-api/Schemas";
import { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { EventBus } from "@openfront/shared/EventBus";
import { toWireGameStartInfo } from "@openfront/shared/SharedUtil";
import {
  GameInfo,
  GameRecord,
  PublicGameInfo,
  WireGameStartInfo,
} from "@openfront/shared/WireSchemas";
import { GameEnv } from "@openfront/shared/configuration/Env";
import { ClientEnv } from "src/client/ClientEnv";
import { renderNavVersion } from "src/client/GameVersion";
import { getUserMe } from "./Api";
import { initAnalytics, track } from "./Analytics";
import { userAuth } from "./Auth";

import type { JoinLobbyResult } from "./ClientGameRunner";
import { getPlayerCosmeticsRefs } from "./Cosmetics";
import { loadGameClient, prefetchGameClient } from "./GameClientLoader";
import "./GameModeSelector";
import { GameModeSelector, joinIsGateable } from "./GameModeSelector";
import { GameStartingModal } from "./GameStartingModal";
import type { HostLobbyModal as HostPrivateLobbyModal } from "./HostLobbyModal";
import { showInGameAlert, showInGameConfirm } from "./InGameModal";
import type { JoinLobbyModal } from "./JoinLobbyModal";
import "./LangSelector";
import { LangSelector } from "./LangSelector";
import { initLayout } from "./Layout";
import { loadModal, prefetchModals, whenModalLoaded } from "./LazyModals";
import {
  SendKickPlayerIntentEvent,
  SendToggleGameStartTimer,
  SendUpdateGameConfigIntentEvent,
} from "./LobbyEvents";
import type { MatchmakingModal, MatchmakingMode } from "./Matchmaking";
import {
  hideMenuChrome,
  menuChromeIsTornDown,
  restoreMenuChrome,
} from "./MenuChrome";
import { modalRouter } from "./ModalRouter";
import { updateAccountNavButton } from "./NavAccountButton";
import { initNavigation } from "./Navigation";
import { capturePagePin } from "./PagePin";
import { fallbackPlayerName } from "./PlayerName";
import {
  ensureServerList,
  redirectToGameVersion,
  setServerListInGame,
  startServerListPolling,
} from "./ServerList";
import {
  requestTurnstileToken,
  resolveTurnstileToken,
  TURNSTILE_LOAD_FAILED_CODE,
  TurnstileError,
  type TurnstileApi,
  type TurnstileToken,
} from "./TurnstileToken";
// Before the first userMeResponse, for the modals that load after it.
import { lastUserMeResponse } from "./UserMeBroadcast";
import { UserSettings } from "./UserSettings";
import "./UsernameInput";
import { UsernameInput } from "./UsernameInput";
import {
  apexPathFor,
  currentPagePath,
  flushReloadToast,
  homeHref,
  incrementGamesPlayed,
  reloadForUpdate,
  translateText,
} from "./Utils";
import { isReplayShellHost } from "./VersionedReplay";
import "./components/BannedModal";
import { classicReplayHref } from "./replay/ReplayEntry";
import { parseReplayViewerHash } from "./replay/ReplayViewerRoute";
import {
  installCtrlWheelZoomBlocker,
  installDoubleTapZoomBlocker,
  installSafariPinchZoomBlocker,
} from "./utilities/DisableSafariPinchZoom";
import { playerProfileRouteArgs } from "./utilities/PlayerProfileUrl";

import "./components/MainLayout";
import "./components/MobileNavBar";
import "./components/PlayPage";
import "./components/SiteHeader";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import "./styles.css";
import "./styles/core/fonts.css";
import "./styles/core/typography.css";
import "./styles/core/variables.css";
import "./styles/layout/container.css";
import "./styles/layout/header.css";

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    adsEnabled: boolean;
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
    "kick-player": CustomEvent;
    toggle_game_start_timer: CustomEvent;
    "join-changed": CustomEvent;
    "open-matchmaking": CustomEvent<{ mode?: MatchmakingMode } | undefined>;
    "matchmaking-requeue": CustomEvent<{ mode?: MatchmakingMode } | undefined>;
    userMeResponse: CustomEvent<UserMeResponse | false>;
    "session-cleared": CustomEvent;
    "leave-lobby": CustomEvent;
    "game-starting": CustomEvent;
    "menu-restored": CustomEvent;
    "update-game-config": CustomEvent;
  }
}

export interface JoinLobbyEvent {
  // Multiplayer games only have gameID, gameConfig is not known until game starts.
  gameID: string;
  // GameConfig only exists when playing a singleplayer game.
  gameStartInfo?: WireGameStartInfo;
  // GameRecord exists when replaying an archived game.
  gameRecord?: GameRecord;
  source?: "public" | "private" | "host" | "matchmaking" | "singleplayer";
  publicLobbyInfo?: GameInfo | PublicGameInfo;
  // Watch without playing.
  spectator?: boolean;
  // Host only: the play token the lobby was created under (see createLobby).
  creatorToken?: string;
}

/**
 * The single point where "a match is running" is published.
 *
 * Two consumers, and they must never disagree:
 *   - the `.in-game` body class, which the client's own markup keys off to hide
 *     the footer and the nav bars;
 *   - the server-list heartbeat, which pauses in-game: a running match already
 *     knows its server, so polling /cluster.json through it buys nothing.
 *
 * Every add/remove of that class goes through here.
 */
function setInGameSignal(inGame: boolean): void {
  document.body.classList.toggle("in-game", inGame);
  setServerListInGame(inGame);
}

class Client {
  private lobbyHandle: JoinLobbyResult | null = null;
  /** The game the replay viewer is showing, once it has replaced the menu. */
  private replayViewerID: string | null = null;
  private eventBus: EventBus = new EventBus();

  private currentUrl: string | null = null;

  private usernameInput: UsernameInput | null = null;
  private readonly guestPlayerName = fallbackPlayerName();

  private hostModal: HostPrivateLobbyModal;
  private joinModal: JoinLobbyModal;
  private gameModeSelector: GameModeSelector;
  private userSettings: UserSettings = new UserSettings();
  private matchmakingModal: MatchmakingModal;
  private mostRecentJoinEvent: number;
  // A join the player has committed to but that has not reached a lobbyHandle
  // yet. `lobbyHandle` alone does not cover this: a public-lobby join awaits
  // userAuth(), getPlayerCosmeticsRefs() and
  // getTurnstileToken() before the handle is assigned, and rewrites the URL
  // only once `join` resolves — so throughout that window the page still looks
  // like a pristine homepage and a /users/@me landing in it would open a
  // confirm over a game that is starting.
  private joinInFlight = false;

  /**
   * Whether the home page is currently torn down for a game.
   *
   * For listeners that may not exist when "game-starting" fires: the event
   * carries no history, so anything registered later cannot tell "no game
   * yet" from "a game started while I was loading". The menu audio chunk is
   * exactly that case. Tracks the menu's state, so "menu-restored" clears it.
   */
  private menuTornDown = false;

  private turnstileTokenPromise: Promise<TurnstileToken> | null = null;

  async initialize(): Promise<void> {
    // FIRST, ahead of handleUrl() below --
    // ahead of every history write this client performs. A page served under
    // `/v/<commit>/` is pinned to that build, and three guards depend on
    // knowing it (isPinnedToAVersion, currentPagePath, ClientGameRunner's
    // version_mismatch branch). The address bar stops being able to answer
    // the moment updateJoinUrlForShare rewrites it to the version-free share
    // URL, so take the value while it is still the URL we were served at.
    // See PagePin.ts.
    capturePagePin();

    flushReloadToast();

    // Stale key still in existing players' storage; nothing reads it.
    localStorage.removeItem("achievements.pushed");

    // One mixer for the page: the menu theme here and the SoundManager a game
    // creates later both route through it, so the volume sliders reach both.
    // It and howler are their own chunk, so the page doesn't wait on them. A
    // game that got there first has made the mixer already, and the menu
    // theme has no business starting under it.
    //
    // gameInProgress covers the other order, where this chunk lands while a
    // game is up but before the game client has built a mixer. startMenuMusic
    // only disarms on the "game-starting" it can hear, so arming it in that
    // window would leave it live under a running game, free to start the
    // theme over the gameplay track on the next click or music-volume change.
    // It is still called, so that its "menu-restored" listener exists and a
    // player who leaves the lobby in place gets the theme back.
    //
    // The mixer check stays a skip rather than the same treatment:
    // initAudioMixer disposes whatever is there, so calling it once a game
    // has one would pull the mixer out from under that game.
    Promise.all([
      import("./sound/AudioMixer"),
      import("./sound/MenuMusic"),
    ]).then(
      ([{ audioMixer, initAudioMixer }, { startMenuMusic }]) => {
        if (audioMixer() === null) {
          startMenuMusic(initAudioMixer(this.userSettings), {
            gameInProgress: this.menuTornDown,
          });
        }
      },
      (err) => console.error("Menu audio failed to load:", err),
    );

    // Register modals with the URL router. Pages with a `path` are routes of
    // their own (`/settings`); the rest live in the hash. Lobby modals (join/host) and
    // matchmaking are intentionally omitted — they own their own URL state
    // (path-based) or none at all.
    modalRouter.register("settings", {
      tag: "user-setting",
      pageId: "page-settings",
      path: "/settings",
    });
    modalRouter.register("leaderboard", {
      tag: "leaderboard-modal",
      pageId: "page-leaderboard",
      path: "/leaderboard",
    });
    modalRouter.register("account", {
      tag: "account-modal",
      pageId: "page-account",
      path: "/account",
    });
    modalRouter.register("signin", {
      tag: "signin-page",
      pageId: "page-signin",
      path: "/signin",
    });
    modalRouter.register("signup", {
      tag: "signup-page",
      pageId: "page-signup",
      path: "/signup",
    });
    // Profile-menu modals: popup style, so no pageId.
    modalRouter.register("change-username", { tag: "change-username-modal" });
    modalRouter.register("stats", {
      tag: "game-stats-modal",
      pageId: "page-stats",
      path: "/stats",
    });
    modalRouter.register("profile", {
      tag: "player-profile-modal",
      pageId: "page-profile",
    });
    // The canonical profile link, `/player/<id>` (see playerProfileUrl).
    modalRouter.registerPath("profile", playerProfileRouteArgs);
    modalRouter.register("language", {
      tag: "language-modal",
      pageId: "page-language",
      path: "/language",
    });
    modalRouter.register("single-player", {
      tag: "single-player-modal",
      pageId: "page-single-player",
      path: "/single-player",
    });
    modalRouter.register("store", {
      tag: "store-modal",
      pageId: "page-item-store",
      path: "/store",
    });
    modalRouter.register("inventory", {
      tag: "inventory-modal",
      pageId: "page-inventory",
      path: "/inventory",
    });
    modalRouter.register("detailed-view", {
      tag: "detailed-view-modal",
      pageId: "page-detailed-view",
      path: "/detailed-view",
    });

    // Kick the server-list fetch off here, before anything below awaits the
    // network, so it overlaps with the rest of boot: by the time a player
    // can click Join or Create the list is already known and the click
    // never waits on a fetch (docs/MultiServer.md, "Server list v2"). It
    // never throws and keeps itself alive with a heartbeat afterwards.
    startServerListPolling();

    // Prefetch turnstile token so it is available when the user joins a lobby.
    // Skip on the versioned replay shells:
    // the replay host may not be on the Turnstile site key's domain allowlist,
    // so rendering the widget there just fails — and replays never
    // send a token anyway (see getTurnstileToken below).
    const turnstilePrefetch =
      isReplayShellHost(window.location.hostname) || !turnstileEnabled()
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

    // The tagged version only. See renderNavVersion / taggedGameVersion.
    if (renderNavVersion() === 0) {
      console.warn("Game version element not found");
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

    this.gameModeSelector = document.querySelector(
      "game-mode-selector",
    ) as GameModeSelector;

    window.addEventListener("beforeunload", async () => {
      console.log("Browser is closing");
      if (this.replayViewerID !== null) {
        // Leaving the replay viewer always navigates, so the same applies:
        // nothing else clears the in-game signal it set.
        setInGameSignal(false);
      }
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
      // Re-throw so a rejected handshake (Turnstile alerts then rejects)
      // still surfaces.
      void this.handleJoinLobby(event).catch((error) => {
        // joinInFlight is set when the join committed, and cleared only on the
        // two paths that reach a handle. Guarded on the timestamp so a join
        // that failed after being superseded cannot clear the flag its
        // successor is relying on.
        if (this.mostRecentJoinEvent === event.timeStamp) {
          this.joinInFlight = false;
        }
        throw error;
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
    document.addEventListener(
      "open-matchmaking",
      this.handleOpenMatchmaking.bind(this),
    );
    document.addEventListener(
      "matchmaking-requeue",
      this.handleMatchmakingRequeue.bind(this),
    );

    this.matchmakingModal = document.querySelector(
      "matchmaking-modal",
    ) as MatchmakingModal;
    if (!this.matchmakingModal) {
      console.warn("Matchmaking modal element not found");
    }

    const onUserMe = (userMeResponse: UserMeResponse | false) => {
      updateAccountNavButton(userMeResponse);
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
    // nav, so a response is only applied while the session
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
    // cached profile all follow, rather than only the
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

    // Both load on demand (see LazyModals). whenDefined resolves while a
    // modal's module is still evaluating, so they have the bus before
    // whatever loaded them can open them.
    this.hostModal = document.querySelector(
      "host-lobby-modal",
    ) as HostPrivateLobbyModal;
    if (!this.hostModal) {
      console.warn("Host private lobby modal element not found");
    } else {
      void customElements.whenDefined("host-lobby-modal").then(() => {
        this.hostModal.eventBus = this.eventBus;
      });
    }

    this.joinModal = document.querySelector(
      "join-lobby-modal",
    ) as JoinLobbyModal;
    if (!this.joinModal) {
      console.warn("Join lobby modal element not found");
    } else {
      void customElements.whenDefined("join-lobby-modal").then(() => {
        this.joinModal.eventBus = this.eventBus;
      });
    }

    // Attempt to join lobby from the current URL once the document is ready.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.handleUrl());
    } else {
      this.handleUrl();
    }

    const onHashUpdate = () => {
      if (this.replayViewerID !== null) {
        this.leaveReplayViewer();
        return;
      }
      // Checked before the join modal is closed below: closing it resets
      // the URL, which would drop the hash before handleUrl reads it.
      const replayViewerID = parseReplayViewerHash(window.location.hash);
      if (replayViewerID !== null) {
        // Not over a game that's running, a lobby being waited in, or a join
        // still on its way to one: the viewer would open on top of it. Drop
        // the hash, so a reload goes back to the game rather than the viewer.
        // currentUrl is only set once the game starts.
        if (this.gameUnderway()) {
          console.warn("replay viewer: ignored, a game is running");
          history.replaceState(
            null,
            "",
            this.currentUrl ??
              window.location.pathname + window.location.search,
          );
          return;
        }
        void this.openReplayViewer(replayViewerID);
        return;
      }
      // Router-managed hash changes (#modal=...) are handled by the router
      // syncing in/out; we don't need to tear down the lobby state for them.
      if (modalRouter.isHashRouted()) {
        modalRouter.routeFromHash();
        return;
      }
      // Back/Forward between page routes (`/settings`, `/leaderboard`, ...).
      if (modalRouter.routeFromHistory()) return;

      // Reset the UI to its initial state.
      this.loadedJoinModal()?.close();

      onJoinChanged();
    };

    const leaveGame = () => {
      // redirect to the home page
      window.location.href = homeHref();
    };

    const onPopState = () => {
      if (this.replayViewerID !== null) {
        this.leaveReplayViewer();
        return;
      }
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

  /**
   * Close the menu's modals and hide its chrome, for something that
   * replaces the menu: a game at prestart, or the replay viewer. Callers
   * dispatch "game-starting" first, so the listeners that stay up through
   * a lobby wait (featured stream, streams feed, menu music) stop too.
   */
  private closeMenu(): void {
    [
      "single-player-modal",
      "game-starting-modal",
      "game-top-bar",
      "user-setting",
      // The in-game instance is addressed by id: querySelector("user-setting")
      // above only ever reaches the page's inline one.
      "#game-settings",
      "language-modal",
      "account-button",
      "leaderboard-button",
      "matchmaking-modal",
      "change-username-modal",
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
  }

  /** A game or lobby is up, or a join is on its way to one. */
  private gameUnderway(): boolean {
    return this.lobbyHandle !== null || this.joinInFlight;
  }

  /**
   * Replace the menu with the replay viewer. Leaving it reloads the page,
   * like leaving a game.
   */
  private async openReplayViewer(gameID: string): Promise<void> {
    // Opening the viewer fires both popstate and hashchange, and both can
    // get here. Only the first opens it.
    if (this.replayViewerID !== null) return;
    this.replayViewerID = gameID;
    let ReplayViewer: typeof import("./replay/ReplayViewer").ReplayViewer;
    try {
      ({ ReplayViewer } = await import("./replay/ReplayViewer"));
    } catch (err) {
      // The viewer's chunk didn't load (a network error, or a deploy that
      // replaced it). The menu is still up, so fall back to the client-side
      // replay. It's a full page load, which also picks up a new deploy.
      console.error("replay viewer failed to load:", err);
      this.replayViewerID = null;
      window.location.assign(classicReplayHref(gameID));
      return;
    }
    // A join may have started while the chunk loaded.
    if (this.gameUnderway()) {
      console.warn("replay viewer: ignored, a game started");
      this.replayViewerID = null;
      return;
    }
    // The same teardown as starting a game: the featured stream, ads and
    // menu music stop, and the menu's modals close.
    const hash = window.location.hash;
    // Set first, as at game prestart: a menu-audio import that finishes
    // later must not start the menu theme under the viewer.
    this.menuTornDown = true;
    document.dispatchEvent(new CustomEvent("game-starting"));
    // A lobby modal may be open (a #join hash switched to a replay): close it
    // the way a game start does, without leaving a lobby it never joined.
    this.loadedHostModal()?.disarmLeaveOnClose();
    this.loadedJoinModal()?.disarmLeaveOnClose();
    this.loadedHostModal()?.closeWithoutLeaving();
    this.loadedJoinModal()?.closeWithoutLeaving();
    this.closeMenu();
    // Closing a modal the router opened clears the hash. Put the viewer's
    // back, so a reload opens the replay again.
    if (window.location.hash !== hash) {
      history.replaceState(
        history.state,
        "",
        window.location.pathname + window.location.search + hash,
      );
    }
    setInGameSignal(true);
    const viewer = new ReplayViewer();
    viewer.gameID = gameID;
    document.body.appendChild(viewer);
  }

  /**
   * The URL changed under the viewer (Back, or an edited hash). The menu
   * isn't there to route it, so load the page again: another replay opens
   * its viewer, anything else goes home, like leaving a game.
   */
  private leaveReplayViewer(): void {
    const gameID = parseReplayViewerHash(window.location.hash);
    // Opening the viewer fires both popstate and hashchange, and the first
    // one opens it. The second still points at the open replay.
    if (gameID === this.replayViewerID) return;
    if (gameID !== null) {
      window.location.reload();
    } else {
      window.location.href = homeHref();
    }
  }

  private async handleUrl() {
    const hash = window.location.hash;

    // Decode the hash first to handle encoded characters
    const decodedHash = decodeURIComponent(hash);

    // The replay viewer takes over the page (loaded on demand).
    const replayViewerID = parseReplayViewerHash(hash);
    if (replayViewerID !== null) {
      await this.openReplayViewer(replayViewerID);
      return;
    }

    // On a versioned replay shell the pathname IS the game id: the worker
    // serves the record's matching build at replay.<domain>/<gameId> (see
    // VersionedReplay.ts).
    if (isReplayShellHost(window.location.hostname)) {
      const replayGameId = window.location.pathname.slice(1);
      if (GAME_ID_REGEX.test(replayGameId)) {
        whenModalLoaded("join-lobby-modal", () => {
          window.showPage?.("page-join-lobby");
          this.joinModal.open({ lobbyId: replayGameId });
        });
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
        whenModalLoaded("host-lobby-modal", () =>
          this.hostModal.open({ existingLobbyId: lobbyId }),
        );
        console.log(`reopening host lobby ${lobbyId}`);
        return;
      }
      track("invite_opened");
      // ?spectate is the watch-only form of the same lobby link, so a cast or
      // an archive can hand out a URL that never takes a player slot.
      const spectate = new URLSearchParams(window.location.search).has(
        "spectate",
      );
      whenModalLoaded("join-lobby-modal", () => {
        window.showPage?.("page-join-lobby");
        this.joinModal.open({ lobbyId, spectate });
      });
      console.log(`${spectate ? "spectating" : "joining"} lobby ${lobbyId}`);
      return;
    }
    // A shared profile link (`/player/<id>`) opens that profile.
    if (modalRouter.routeFromPath()) {
      return;
    }
    if (modalRouter.routeFromHash()) {
      return;
    }
    if (decodedHash.startsWith("#refresh")) {
      window.location.href = homeHref();
    }

    const requeueMode = this.consumeRequeueUrl();
    if (requeueMode !== null) {
      document.dispatchEvent(
        new CustomEvent("open-matchmaking", {
          detail: { mode: requeueMode },
        }),
      );
    }
  }

  // The lobby modals load on demand (see LazyModals); until one has, it
  // can't be open, so there's nothing to close.
  private loadedJoinModal(): JoinLobbyModal | null {
    return customElements.get("join-lobby-modal") ? this.joinModal : null;
  }

  private loadedHostModal(): HostPrivateLobbyModal | null {
    return customElements.get("host-lobby-modal") ? this.hostModal : null;
  }

  private loadedMatchmakingModal(): MatchmakingModal | null {
    return customElements.get("matchmaking-modal")
      ? this.matchmakingModal
      : null;
  }

  // Returns the requeue mode ("/?requeue" = 1v1), or null when the URL has
  // no requeue param.
  private consumeRequeueUrl(): MatchmakingMode | null {
    const searchParams = new URLSearchParams(window.location.search);
    if (!searchParams.has("requeue")) {
      return null;
    }
    searchParams.delete("requeue");
    const newUrl =
      window.location.pathname +
      (searchParams.toString() ? `?${searchParams.toString()}` : "") +
      window.location.hash;
    history.replaceState(null, "", newUrl);
    return "1v1";
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
    // Entering a lobby. Singleplayer, public lobbies and replays know their
    // config up front; everything else is filled in by the lobby_info
    // subscription in initialize() a moment later.
    if (this.lobbyHandle !== null) {
      console.log("joining lobby, stopping existing game");
      this.lobbyHandle.stop(true);
      setInGameSignal(false);
    }
    if (lobby.source === "public") {
      // Awaited so the modal opens before the join goes on to close it. A
      // modal that won't load doesn't stop the join.
      await loadModal("join-lobby-modal").catch((err) =>
        console.error("join-lobby-modal failed to load:", err),
      );
      this.loadedJoinModal()?.open({
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
    // local game:
    // read the cached JWT and refresh in the background instead.
    const isSingleplayer = lobby.source === "singleplayer";
    if (isSingleplayer) {
      void userAuth();
    }
    const auth = await userAuth(!isSingleplayer);
    const playerRole = auth !== false ? (auth.claims.role ?? null) : null;
    // One resolution for the whole join: the name and the verified badge have
    // to describe the same decision, so they are read together rather than
    // asked for separately.
    const profile = lastUserMeResponse()?.response;
    const accountName = profile ? profile.player.username : null;
    const resolvedName =
      this.usernameInput?.resolvedName() ??
      (accountName
        ? { name: accountName, source: "stored" as const, verified: false }
        : this.guestPlayerName);
    let joinLobby: typeof import("./ClientGameRunner").joinLobby;
    try {
      ({ joinLobby } = await loadGameClient());
    } catch (err) {
      // The game's chunk didn't load (a network error, or a deploy that
      // replaced it). A full page load also picks up a new deploy, unless the
      // player has since left or started another join.
      console.error("game client failed to load:", err);
      if (this.mostRecentJoinEvent !== event.timeStamp) return;
      // The URL names the singleplayer game now, which no server has.
      if (isSingleplayer) history.replaceState(null, "", "/");
      reloadForUpdate();
      return;
    }
    const newLobbyHandle = joinLobby(this.eventBus, {
      gameID: lobby.gameID,
      cosmetics: await getPlayerCosmeticsRefs({
        verified: resolvedName.verified,
      }),
      turnstileToken: await this.getTurnstileToken(lobby),
      playerName: resolvedName.name,
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
      creatorToken: lobby.creatorToken,
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
      // The game is actually starting now (lobby wait is over).
      this.menuTornDown = true;
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
      this.loadedHostModal()?.disarmLeaveOnClose();
      this.loadedJoinModal()?.disarmLeaveOnClose();
      this.loadedHostModal()?.closeWithoutLeaving();
      this.loadedJoinModal()?.closeWithoutLeaving();
      this.closeMenu();

      // show when the game loads
      const startingModal = document.querySelector(
        "game-starting-modal",
      ) as GameStartingModal;
      if (startingModal && startingModal instanceof GameStartingModal) {
        startingModal.show();
      }
    });

    this.lobbyHandle.join.then(() => {
      this.loadedJoinModal()?.closeWithoutLeaving();
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
    // Above the lobbyHandle guard: a modal closed during the pre-handle window
    // dispatches leave-lobby and returns early, which would otherwise strand
    // the flag set forever.
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
      // The counterpart to "game-starting", and the only signal that the home
      // page is live again without a navigation. MenuMusic tore its gesture
      // listeners down at prestart and needs them back, or the menu theme is
      // silent for the rest of the session.
      this.menuTornDown = false;
      document.dispatchEvent(new CustomEvent("menu-restored"));
    }

    if (this.loadedJoinModal()?.isOpen()) {
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

  // Puts the player back into the ranked queue. From a pre-start match
  // cancellation the matchmaking modal is still open and rejoins in place,
  // keeping its mode. From a finished game (WinModal passes the mode) the
  // page needs the reload teardown, so navigate home with the requeue
  // param and let consumeRequeueUrl() reopen the queue. A modeless
  // dispatch with no open modal (the player closed it mid-wait) stays a
  // no-op — don't force them back into a queue they left.
  private handleMatchmakingRequeue(
    event: CustomEvent<{ mode?: MatchmakingMode } | undefined>,
  ) {
    if (this.loadedMatchmakingModal()?.requeue()) {
      return;
    }
    if (event.detail?.mode !== undefined) {
      window.location.href = "/?requeue";
    }
  }

  private handleOpenMatchmaking(
    event: CustomEvent<{ mode?: MatchmakingMode } | undefined>,
  ) {
    if (!this.matchmakingModal) return;
    whenModalLoaded("matchmaking-modal", () => {
      // A game that started while it loaded has the screen now, and the
      // game-start teardown couldn't close a modal that hadn't loaded.
      if (menuChromeIsTornDown()) return;
      // Always set the mode: dispatchers without a detail (homepage button,
      // requeue URL) mean 1v1 and must reset a lingering selection.
      this.matchmakingModal.mode = event.detail?.mode ?? "1v1";
      this.matchmakingModal.open();
    });
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

  private async getTurnstileToken(
    lobby: JoinLobbyEvent,
  ): Promise<string | null> {
    if (
      ClientEnv.env() === GameEnv.Dev ||
      // Single-player and replays: no server to verify a token against (and
      // on the CDN replay shells Turnstile cannot load at all).
      !joinIsGateable(lobby) ||
      !turnstileEnabled()
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
      onError: (code) =>
        void showInGameAlert(
          translateText("error_modal.turnstile_error", { code }),
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
  initAnalytics();
  new Client().initialize();
  initNavigation();
  prefetchGameClient();
  prefetchModals();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}

// A deployment without a site key runs no challenge at all.
function turnstileEnabled(): boolean {
  return ClientEnv.turnstileSiteKey() !== "";
}

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js";

// The script loads on first use, so a deployment without a site key never
// contacts Cloudflare.
function loadTurnstileScript(): void {
  if (
    window.turnstile !== undefined ||
    document.querySelector(`script[src="${TURNSTILE_SCRIPT_URL}"]`) !== null
  ) {
    return;
  }
  const script = document.createElement("script");
  script.src = TURNSTILE_SCRIPT_URL;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

async function getTurnstileToken(): Promise<TurnstileToken> {
  loadTurnstileScript();
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
  // lives in TurnstileToken.ts.
  return requestTurnstileToken(turnstile, {
    sitekey: ClientEnv.turnstileSiteKey(),
    container: "#turnstile-container",
  });
}
