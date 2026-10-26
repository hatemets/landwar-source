import { GameMapType, GameType } from "@openfront/engine-api/game/GameTypes";
import { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { PublicGameInfo, PublicGames } from "@openfront/shared/WireSchemas";
import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./components/ConquestGlobe";
import type { GlobeRegionSelectEvent } from "./components/ConquestGlobe";
import {
  canJoinTrustedLobby,
  lobbyCard,
  mapAspectRatios,
  trustRequiredDialog,
  viewerIsSignedIn,
  viewerIsTrusted,
} from "./components/LobbyCard";
import {
  MAP_REGIONS,
  mapFocus,
  mapRegions,
  type GlobeFocus,
  type GlobeRegionPin,
  type MapRegion,
} from "./globe/MapRegions";
import type { HostLobbyModal } from "./HostLobbyModal";
import { showInGameAlert } from "./InGameModal";
import type { JoinLobbyModal } from "./JoinLobbyModal";
import { whenModalLoaded } from "./LazyModals";
import { PublicLobbySocket } from "./LobbySocket";
import { JoinLobbyEvent } from "./Main";
import {
  backendUnreachableConfirmed,
  isPinnedToAVersion,
  MANUAL_RETRY_COOLDOWN_MS,
  manualRetryAvailable,
  refreshServerList,
  retryServerList,
  type BackendReachabilityDetail,
} from "./ServerList";
import type { SinglePlayerModal } from "./SinglePlayerModal";
import { lastUserMeResponse } from "./UserMeBroadcast";
import { UsernameInput } from "./UsernameInput";
import {
  calculateServerTimeOffset,
  getGameModeLabel,
  getSecondsUntilServerTimestamp,
  reloadForUpdate,
  renderDuration,
  showToast,
  translateText,
} from "./Utils";
import { isReplayShellHost } from "./VersionedReplay";

/** Every action is a full pill of one height. Colour comes from the variant. */
const SECONDARY_ACTION = "menu-action--secondary";
const DISABLED = "opacity-50 cursor-not-allowed pointer-events-none";

/**
 * THE REACHABILITY RULE (OPE-439). Stated once, here; every other call site
 * in this feature points back at this comment rather than restating it.
 *
 * The backend-reachability signal is the health of ONE thing: the server-list
 * API (`/cluster.json`), as observed by ServerList's heartbeat. It is not a
 * general "is the internet up" light, and in particular it says nothing about
 * whether any given GAME server is up.
 *
 * So it may gate exactly one category of action: the ones that cannot even
 * begin without that API answering first, because nothing has yet told the
 * client which server to talk to.
 *
 *   GATED (API-dependent): creating/hosting a lobby, entering matchmaking,
 *   opening the join-by-code modal. Each has to resolve a server for
 *   something the client has heard nothing about, so a dead list API really
 *   does mean the click cannot work. These dim, and refuse with
 *   reportMultiplayerRefusal.
 *
 *   NOT GATED (socket-sourced): anything whose target arrived over a live
 *   game-server socket -- every card in the public lobby feed, in both the
 *   homepage selector and the detailed browser -- and every join that reaches
 *   Main's funnel. The card's very existence is proof that the game server
 *   behind it is up and talking to us, which is the only liveness that join
 *   needs.
 *
 * ---
 *
 * Whether multiplayer should be available given what we know about the
 * backend.
 *
 * The parameter is ServerList.backendUnreachableConfirmed(), NOT the raw
 * backendReachable(), and the difference is load-bearing. That accessor is
 * already false for the two states this must never gate:
 *
 *   - before the first attempt settles. A page is in that state for its first
 *     few hundred milliseconds, and gating there would lock every player out
 *     of multiplayer on every load over a suspicion we have not tested yet.
 *   - after a single missed heartbeat. The cached list is still serving and
 *     the next request would very likely have worked; taking the game away
 *     for a retry interval over one blip is worse than the blip.
 *
 * It is also false when the API answered with anything short of a 5xx -- a
 * 404 for a site with no list is a reachable backend.
 */
export function multiplayerAllowedForBackend(backendOutage: boolean): boolean {
  return !backendOutage;
}

/**
 * Tells the player why a multiplayer action was refused, and acts as the
 * retry it tells them to make.
 *
 * An unreachable backend would otherwise refuse in complete silence, which
 * reads as a broken button, so the player gets a transient message. The
 * refused click also PROBES: the web has no retry button, so without this the
 * only way out of the gated state is the heartbeat's own next beat -- which
 * backs off to as much as RETRY_MAX_MS once an outage has run a while. So the
 * click the player makes IS the retry, and the message is true.
 *
 * Throttled by ServerList.manualRetryAvailable(): nothing while an attempt is
 * already out, nothing for MANUAL_RETRY_COOLDOWN_MS after the last one.
 * Nothing is rendered from the result: a successful probe flips the
 * reachability signal, which is what un-dims the buttons.
 */
export function reportMultiplayerRefusal(backendOutage: boolean): void {
  if (backendOutage) {
    if (manualRetryAvailable()) {
      retryServerList().catch((err: unknown) => {
        // retryServerList never rejects; belt and braces, so a change there
        // cannot surface as an unhandled rejection from a click handler.
        console.warn("server list retry from a refused click failed", err);
      });
    }
    showToast(translateText("common.backend_unreachable"), "red");
  }
}

/**
 * Whether the multiplayer gate applies to a given join at all. Single-player
 * runs entirely in-client and a replay simulates from an archived record, so
 * neither needs a session, an up-to-date build, or a backend that is up.
 * getTurnstileToken in Main.ts exempts the same pair, and calls this so the
 * two cannot drift. Exported for tests and kept free of component state.
 */
export function joinIsGateable(lobby: JoinLobbyEvent): boolean {
  return (
    lobby.gameStartInfo?.config.gameType !== GameType.Singleplayer &&
    lobby.gameRecord === undefined
  );
}

@customElement("game-mode-selector")
export class GameModeSelector extends LitElement {
  @state() private lobbies: PublicGames | null = null;
  @state() private inputValid: boolean = true;
  @state() private viewerTrusted: boolean = false;
  @state() private viewerSignedIn: boolean = false;
  @state() private showTrustRequired: boolean = false;
  // The DEBOUNCED outage signal, not the raw per-attempt one: see
  // multiplayerAllowedForBackend for why one missed heartbeat must not dim
  // these buttons.
  @state() private backendOutage = false;
  // The region picked on the globe; the upcoming list shows only its lobbies.
  @state() private regionFilter: MapRegion | null = null;
  // The hovered lobby's place, which the globe turns into view.
  @state() private globeFocus: GlobeFocus | null = null;
  private serverTimeOffset: number = 0;
  private countdownTimer: number | null = null;

  // True from join-lobby until leave-lobby: the player is waiting in (or
  // loading into) a lobby. This socket is NOT scoped to the homepage — Main.ts
  // only stops it when a game actually starts (prestart/join), so it is still
  // listening during the whole lobby wait.
  private inLobby = false;
  // Whether Main wants the feed open at all (false from game start until the
  // player is back at the menu). Kept apart from the socket's own state so a
  // session change can close and reopen the feed without forgetting that.
  private feedWanted = false;
  // The socket ran out of fast attempts and is only re-dialing slowly;
  // cleared by the next start() or snapshot.
  @state() private feedGaveUp = false;
  // Held for the same cooldown as the other Retry affordances, on this
  // component's own clock: refreshServerList fires a real request per press
  // (past its 1s floor), so this is what stops a player leaning on it.
  @state() private retryCoolingDown = false;
  private retryCooldownTimer: number | undefined;
  // A Retry press is waiting on the server list; the globe shows it loading.
  @state() private retryPending = false;
  // An update/drain signal arrived during a lobby wait; prompt on leave-lobby.
  private updateDeferred = false;

  private lobbySocket = new PublicLobbySocket(
    (lobbies) => this.handleLobbiesUpdate(lobbies),
    {
      onUpdateAvailable: () => this.handleUpdateAvailable(),
      onGaveUp: () => {
        // Nothing is loading any more, and cards from a feed that has died
        // are lobbies the player cannot join.
        this.feedGaveUp = true;
        this.lobbies = null;
      },
    },
  );

  private handleUpdateAvailable() {
    // A versioned replay shell is pinned to the archived game's build on
    // purpose (VersionedReplay.ts), but its baked-in serverHost points at a
    // live deployment running a newer build — so the lobby socket's commit
    // compare (or a drain signal) fires on every load. "Update" is
    // meaningless here, and reloading re-serves the same immutable shell,
    // which would loop the prompt forever.
    if (isReplayShellHost(window.location.hostname)) return;
    // A page pinned under /v/<commit>/ is on that build because the game it
    // opened runs there (redirectToGameVersion), and its build's servers are
    // draining by definition -- so the lobby feed's drain signal fires on
    // every load. Reloading would strip the pin, land on latest, and be
    // re-pinned straight back: the same loop as the replay shell, closed the
    // same way. Leaving to the menu goes to the version-free root anyway.
    if (isPinnedToAVersion()) return;
    // A blocking reload prompt during a lobby wait would eject the player
    // from a lobby the draining deployment deliberately lets finish — and a
    // private lobby's members are all pinned to the same deployment, so they
    // would all be prompted out at once. Defer until they leave the lobby;
    // if the game starts instead, Main.ts stops this socket, and every exit
    // from a started game is a full navigation that picks up the new shell
    // anyway.
    if (this.inLobby) {
      this.updateDeferred = true;
      return;
    }
    showInGameAlert(translateText("update_available.message")).then(() => {
      reloadForUpdate();
    });
  }

  createRenderRoot() {
    return this;
  }

  // Silent backstop; the buttons are already disabled while input is invalid.
  private validateUsername(): boolean {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    return usernameInput ? usernameInput.canPlay() : true;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    document.addEventListener("userMeResponse", this.onUserMe);
    // play-page renders this after Main may already have broadcast.
    const last = lastUserMeResponse();
    if (last !== null) this.applyUserMe(last.response);
    this.start();
    // Repaint countdowns between lobby-feed updates.
    this.countdownTimer ??= window.setInterval(
      () => this.requestUpdate(),
      1000,
    );
    // Seeded here: the heartbeat's first attempts often settle before this
    // element exists (it is started in Main's initialize, we are rendered by
    // <play-page> later), so the event alone would miss them.
    this.backendOutage = backendUnreachableConfirmed();
    document.addEventListener(
      "backend-reachability",
      this.onBackendReachability,
    );
    document.addEventListener("join-lobby", this.onJoinLobby);
    document.addEventListener("leave-lobby", this.onLeaveLobby);
    window.addEventListener("resize", this.onResize);
    // Pick up the current value in case username-input validated before us.
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    if (usernameInput) {
      this.inputValid = usernameInput.canPlay();
    }
  }

  disconnectedCallback() {
    this.stop();
    if (this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    window.clearTimeout(this.retryCooldownTimer);
    this.retryCoolingDown = false;
    window.removeEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    document.removeEventListener("userMeResponse", this.onUserMe);
    document.removeEventListener(
      "backend-reachability",
      this.onBackendReachability,
    );
    document.removeEventListener("join-lobby", this.onJoinLobby);
    document.removeEventListener("leave-lobby", this.onLeaveLobby);
    window.removeEventListener("resize", this.onResize);
    super.disconnectedCallback();
  }

  private onJoinLobby = () => {
    this.inLobby = true;
  };

  private onResize = () => this.positionGlobe(false);

  protected updated(): void {
    this.positionGlobe(this.globePlaced);
  }

  // False until the globe has its first position, which is set without a
  // transition so it does not slide in on page load.
  private globePlaced = false;

  /**
   * While the lobby list loads, the globe sits centred under the "Upcoming"
   * heading as the loading indicator. Once lobbies arrive (or the feed is
   * known to be down) it slides back to its own column. Offsets use layout
   * positions, which ignore the transform, so repeated calls are stable.
   */
  private positionGlobe(animate: boolean): void {
    const globe = this.querySelector<HTMLElement>(".menu-globe");
    const slot = this.querySelector<HTMLElement>(".menu-lobbies");
    if (!globe || !slot) return;
    const loading = this.lobbies === null && !this.offlineForLobbies();
    // Under the "Upcoming" heading, which is the slot's first child.
    const heading = slot.firstElementChild as HTMLElement | null;
    const headingH = heading ? heading.offsetHeight + 8 : 0;
    const dx = loading
      ? slot.offsetLeft +
        slot.offsetWidth / 2 -
        (globe.offsetLeft + globe.offsetWidth / 2)
      : 0;
    const dy = loading ? slot.offsetTop + headingH - globe.offsetTop : 0;
    const transform = `translate(${dx}px, ${dy}px)`;
    // Over the empty lobby slot it sits on top, so it can still be dragged.
    globe.classList.toggle("menu-globe--loading", loading);
    if (!animate) {
      globe.style.transition = "none";
      globe.style.transform = transform;
      void globe.offsetWidth; // commit before re-enabling the transition
      globe.style.transition = "";
      this.globePlaced = true;
      return;
    }
    globe.style.transform = transform;
  }

  private onLeaveLobby = () => {
    this.inLobby = false;
    if (this.updateDeferred) {
      this.updateDeferred = false;
      this.handleUpdateAvailable();
    }
  };

  private handleValidityChange = (e: Event) => {
    this.inputValid = (e as CustomEvent).detail?.isValid ?? true;
  };

  private onUserMe = (e: Event) => {
    this.applyUserMe((e as CustomEvent<UserMeResponse | false>).detail);
  };

  private applyUserMe(me: UserMeResponse | false): void {
    this.viewerSignedIn = viewerIsSignedIn(me);
    this.viewerTrusted = viewerIsTrusted(me);
  }

  private onBackendReachability = (e: Event) => {
    this.backendOutage = (
      e as CustomEvent<BackendReachabilityDetail>
    ).detail.confirmed;
  };

  public stop() {
    this.feedWanted = false;
    this.lobbySocket.stop();
  }

  // Also drops the snapshot: a card from a feed we have closed is a lobby the
  // player cannot join, and the hero slot reads `null` as "show why".
  private closeLobbyFeed() {
    this.lobbySocket.stop();
    this.lobbies = null;
  }

  /**
   * Re-open the public-lobby socket after stop().
   *
   * connectedCallback() used to be the only caller of lobbySocket.start(),
   * which was fine while every exit from a started game reloaded the page. It
   * is not fine for an exit that leaves in place (openInvite, OPE-255): this
   * element is never disconnected, so connectedCallback never runs again and
   * the lobby list stayed frozen on whatever it last received.
   *
   * Safe to call when already running -- PublicLobbySocket.start() closes any
   * existing socket before opening a new one -- but callers should still only
   * use it to undo a stop(), since a needless reconnect drops the cached
   * snapshot and re-primes the list from the server.
   */
  public start() {
    this.openLobbyFeed();
  }

  private openLobbyFeed(refreshList = false) {
    this.feedWanted = true;
    this.feedGaveUp = false;
    this.lobbySocket.start({ refreshList });
  }

  /**
   * Whether an empty hero slot should say "offline" instead of spinning. On a
   * confirmed outage the feed may still be connecting, but a spinner over a
   * dead backend reads as broken, and the feed reconnects on its own if the
   * server answers.
   */
  private offlineForLobbies(): boolean {
    return this.backendOutage || this.feedGaveUp;
  }

  private renderLobbiesUnavailable(heightClass: string) {
    // An outage is our servers not answering, which is not the player being
    // offline.
    const message = this.backendOutage
      ? "mode_selector.servers_unreachable"
      : "mode_selector.lobbies_unreachable";
    return html`<div
      role="status"
      aria-live="polite"
      class="menu-offline-card ${heightClass}"
    >
      <svg
        class="menu-offline-card__icon"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="16" cy="16" r="11" stroke="currentColor" />
        <path d="M8 24 24 8" stroke="currentColor" />
        <path d="M12 16h8" stroke="currentColor" />
      </svg>
      <p class="menu-offline-card__message">${translateText(message)}</p>
      <button
        class="menu-offline-card__retry"
        ?disabled=${this.retryCoolingDown}
        @click=${this.retryLobbies}
      >
        ${translateText("mode_selector.retry_lobbies")}
      </button>
    </div>`;
  }

  private renderNoOpenLobbies(heightClass: string) {
    return html`<div
      role="status"
      aria-live="polite"
      class="lobby-empty-state ${heightClass}"
    >
      <img
        class="lobby-empty-state__art"
        src=${assetUrl("images/illustrations/Camp.webp")}
        alt=""
        aria-hidden="true"
        draggable="false"
      />
      <p class="lobby-empty-state__message">
        ${translateText("private_lobby.no_open_lobbies")}
      </p>
      <p class="menu-empty-hint">
        ${translateText("landwar_ui.no_lobbies_hint")}
      </p>
    </div>`;
  }

  private retryLobbies = () => {
    if (this.retryCoolingDown) return;
    this.retryCoolingDown = true;
    this.retryCooldownTimer = window.setTimeout(() => {
      this.retryCoolingDown = false;
    }, MANUAL_RETRY_COOLDOWN_MS);
    // Only a feed that gave up is reopened: one still inside its fast
    // attempts is already dialing, and restarting it would throw that attempt
    // away. The socket refreshes the list itself before it dials.
    if (this.feedGaveUp && this.feedWanted) {
      this.openLobbyFeed(true);
      return;
    }
    // Shown over a feed that has not given up, this is a confirmed outage,
    // which only an answer from the list API clears. The globe shows the
    // attempt for at least a moment, so a fast failure does not just blink.
    this.retryPending = true;
    void Promise.all([
      refreshServerList(),
      new Promise((resolve) => window.setTimeout(resolve, 1200)),
    ]).finally(() => (this.retryPending = false));
  };

  private handleLobbiesUpdate(lobbies: PublicGames) {
    this.lobbies = lobbies;
    this.feedGaveUp = false;
    this.serverTimeOffset = calculateServerTimeOffset(lobbies.serverTime);
    document.dispatchEvent(
      new CustomEvent("public-lobbies-update", {
        detail: { payload: lobbies },
      }),
    );
    // A region whose lobbies have all gone has no pin left to click.
    if (
      this.regionFilter !== null &&
      !this.allLobbies().some((l) =>
        mapRegions(l.gameConfig?.gameMap).includes(this.regionFilter!),
      )
    ) {
      this.regionFilter = null;
    }
    this.requestUpdate();

    const allGames = Object.values(lobbies.games ?? {}).flat();
    for (const game of allGames) {
      mapAspectRatios.ensure(game.gameConfig?.gameMap as GameMapType, () =>
        this.requestUpdate(),
      );
    }
  }

  /** Every advertised lobby, in the order the upcoming list shows them. */
  private allLobbies(): PublicGameInfo[] {
    return [
      ...(this.lobbies?.games?.ffa ?? []),
      ...(this.lobbies?.games?.team ?? []),
      ...(this.lobbies?.games?.special ?? []),
      ...(this.lobbies?.games?.hosted ?? []),
    ];
  }

  /** A pin for each real-world region that has at least one lobby. */
  private regionPins(): GlobeRegionPin[] {
    const counts = new Map<MapRegion, number>();
    for (const lobby of this.allLobbies()) {
      for (const region of mapRegions(lobby.gameConfig?.gameMap)) {
        counts.set(region, (counts.get(region) ?? 0) + 1);
      }
    }
    return MAP_REGIONS.filter((r) => counts.has(r)).map((region) => ({
      region,
      label: translateText(`map_categories.${region}`),
      count: counts.get(region)!,
      selected: region === this.regionFilter,
    }));
  }

  private clearGlobeFocus = () => (this.globeFocus = null);

  // A second click on the selected region shows every lobby again.
  private onRegionSelect = (e: Event) => {
    const { region } = (e as GlobeRegionSelectEvent).detail;
    this.regionFilter = this.regionFilter === region ? null : region;
  };

  render() {
    const region = this.regionFilter;
    const featuredLobbies = this.allLobbies()
      .filter(
        (l) =>
          region === null || mapRegions(l.gameConfig?.gameMap).includes(region),
      )
      .slice(0, 5);
    const showNoLobbies = this.lobbies !== null && featuredLobbies.length === 0;
    const heroHeight = "menu-lobby-slot";

    // Actions form one row of tiles above the lobby list and globe.
    return html`
      <div class="menu-play-board">
        <h1 class="sr-only">${translateText("main.play")}</h1>

        <div class="menu-action-rail">
          ${this.renderSmallActionCard(
            translateText("main.solo"),
            this.openSinglePlayerModal,
            SECONDARY_ACTION,
            undefined,
            false,
            "images/menu/SoloIcon.png",
          )}
          ${this.renderSmallActionCard(
            translateText("main.create"),
            this.openHostLobby,
            SECONDARY_ACTION,
            undefined,
            true,
            "images/menu/CreateLobbyIcon.png",
          )}
          ${this.renderSmallActionCard(
            translateText("main.join"),
            this.openJoinLobby,
            SECONDARY_ACTION,
            this.hostedLobbyCount(),
            true,
            "images/menu/JoinLobbyIcon.png",
          )}
          ${this.renderSmallActionCard(
            translateText("mode_selector.ranked_1v1"),
            this.openRanked,
            SECONDARY_ACTION,
            undefined,
            true,
            "images/menu/Ranked1v1Icon.png",
          )}
          ${this.backendOutage
            ? html`<p class="menu-action-note" role="status">
                ${translateText("landwar_ui.multiplayer_unavailable")}
              </p>`
            : nothing}
        </div>

        <div class="menu-lobbies">
          ${this.renderUpcomingHeading()}
          ${featuredLobbies.length > 0
            ? html`<div class="menu-lobby-list">
                ${featuredLobbies.map((lobby) => {
                  const config = lobby.gameConfig;
                  const mode = config ? getGameModeLabel(config) : "";
                  const subtitle =
                    config?.nations === "disabled"
                      ? mode
                      : `${mode} · ${translateText("player_type.nation")}`;
                  const focus = mapFocus(config?.gameMap);
                  return html`<div
                    class="min-w-0"
                    @pointerenter=${() => (this.globeFocus = focus)}
                    @pointerleave=${this.clearGlobeFocus}
                    @focusin=${() => (this.globeFocus = focus)}
                    @focusout=${this.clearGlobeFocus}
                  >
                    ${this.renderLobbyCard(lobby, subtitle, heroHeight)}
                  </div>`;
                })}
              </div>`
            : this.lobbies === null
              ? this.offlineForLobbies()
                ? this.renderLobbiesUnavailable(heroHeight)
                : // The globe, centred over this slot, is the loading indicator.
                  html`<div
                    class=${heroHeight}
                    role="status"
                    aria-label=${translateText("common.loading")}
                  ></div>`
              : showNoLobbies
                ? this.renderNoOpenLobbies(heroHeight)
                : nothing}
        </div>

        <conquest-globe
          class="menu-globe"
          fill="0.86"
          interactive
          .pins=${this.regionPins()}
          .focusOn=${this.globeFocus}
          @globe-region-select=${this.onRegionSelect}
          ?orbiting=${(this.lobbies === null && !this.offlineForLobbies()) ||
          this.retryPending}
        ></conquest-globe>

        ${this.showTrustRequired
          ? trustRequiredDialog(
              this.viewerSignedIn,
              () => (this.showTrustRequired = false),
            )
          : nothing}
      </div>
    `;
  }

  /**
   * Refuses an API-DEPENDENT action (Create, Ranked, Join by code) and tells
   * the player why. Returns true when the caller should stop.
   *
   * The reachability rule at the top of this file applies here: none of these
   * three can resolve a server without the list API. A lobby card never goes
   * through this.
   *
   * Deliberately NOT implemented with the `disabled` attribute the way
   * renderSmallActionCard handles invalid input: a disabled control swallows
   * the click, leaving nothing to trigger the retry that
   * reportMultiplayerRefusal makes of it. The button stays clickable and
   * merely stops being actionable.
   */
  private blockedFromApiAction(): boolean {
    if (multiplayerAllowedForBackend(this.backendOutage)) return false;
    reportMultiplayerRefusal(this.backendOutage);
    return true;
  }

  // Joins a ranked queue. The matchmaking modal checks the player is signed in.
  private openRanked = () => {
    if (this.blockedFromApiAction()) return;
    if (!this.validateUsername()) return;
    document.dispatchEvent(
      new CustomEvent("open-matchmaking", { detail: { mode: "1v1" } }),
    );
  };

  private openDetailedView = () => {
    if (!this.validateUsername()) return;
    window.showPage?.("page-detailed-view");
  };

  private openSinglePlayerModal = () => {
    if (!this.validateUsername()) return;
    whenModalLoaded("single-player-modal", () =>
      (
        document.querySelector("single-player-modal") as SinglePlayerModal
      )?.open(),
    );
  };

  private openHostLobby = () => {
    if (this.blockedFromApiAction()) return;
    if (!this.validateUsername()) return;
    whenModalLoaded("host-lobby-modal", () =>
      (document.querySelector("host-lobby-modal") as HostLobbyModal)?.open(),
    );
  };

  private openJoinLobby = () => {
    if (this.blockedFromApiAction()) return;
    if (!this.validateUsername()) return;
    whenModalLoaded("join-lobby-modal", () =>
      (document.querySelector("join-lobby-modal") as JoinLobbyModal)?.open(),
    );
  };

  // Number of open hosted lobbies waiting in the browser; shown as a chip
  // on the Join button.
  /**
   * The heading over the upcoming column, and the way to the lobby browser now
   * that the Detailed View button is gone. Heading and link are one control:
   * side by side they were two runs of small uppercase text, and neither read
   * as clickable. A heading may hold a button, so the h2 survives.
   *
   * Dims and stops responding on an invalid username, as the button it
   * replaces did: openDetailedView's own check is a silent backstop that
   * assumes its control already looks disabled.
   */
  /** Heading over the upcoming column; also the link to the lobby browser. */
  private renderUpcomingHeading() {
    const count = this.advertisedLobbyCount();
    const seeAllLabel =
      count > 0
        ? translateText("public_lobby.see_all", { count })
        : translateText("detailed_view.title");
    return html`
      <div class="flex min-w-0 items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <h2
            class="menu-lobby-heading truncate text-base font-semibold text-white"
          >
            ${translateText("public_lobby.upcoming")}
          </h2>
          ${this.regionFilter !== null
            ? html`<button
                class="flex shrink-0 items-center gap-1 rounded-full border border-[#f2862e]/60 bg-[#f2862e]/15 py-0.5 pl-2.5 pr-1.5 text-sm font-medium text-white transition-colors hover:bg-[#f2862e]/25"
                aria-label=${translateText("landwar_ui.clear_region_filter")}
                title=${translateText("landwar_ui.clear_region_filter")}
                @click=${() => (this.regionFilter = null)}
              >
                ${translateText(`map_categories.${this.regionFilter}`)}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  class="size-4"
                  aria-hidden="true"
                >
                  <path
                    d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"
                  />
                </svg>
              </button>`
            : nothing}
        </div>
        <button
          @click=${this.openDetailedView}
          ?disabled=${!this.inputValid}
          aria-label=${seeAllLabel}
          title=${seeAllLabel}
          class="flex shrink-0 items-center gap-1 rounded-md py-1.5 pl-2.5 pr-1.5 text-sm font-medium text-[var(--field-muted)] transition-colors hover:bg-white/[0.06] hover:text-white ${this
            .inputValid
            ? ""
            : DISABLED}"
        >
          ${seeAllLabel}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            class="size-4"
            aria-hidden="true"
          >
            <path
              fill-rule="evenodd"
              d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z"
              clip-rule="evenodd"
            />
          </svg>
        </button>
      </div>
    `;
  }

  /** Every lobby the browser lists, hosted included. */
  private advertisedLobbyCount(): number {
    return Object.values(this.lobbies?.games ?? {}).flat().length;
  }

  private hostedLobbyCount(): number {
    return this.lobbies?.games?.hosted?.length ?? 0;
  }

  private renderSmallActionCard(
    title: string,
    onClick: () => void,
    bgClass: string = SECONDARY_ACTION,
    badge?: number,
    // Only the multiplayer action cards (create/ranked/join) pass this;
    // the solo card is never gated (see openSinglePlayerModal) and must never
    // show as disabled here.
    gated: boolean = false,
    icon?: string,
    adornment: TemplateResult | typeof nothing = nothing,
  ) {
    const blocked = gated && !multiplayerAllowedForBackend(this.backendOutage);
    return html`
      <button
        @click=${onClick}
        ?disabled=${!this.inputValid}
        aria-disabled=${blocked}
        class="menu-action relative ${bgClass} ${!this.inputValid
          ? DISABLED
          : blocked
            ? "opacity-50 cursor-not-allowed"
            : ""}"
      >
        ${icon
          ? html`<img
              class="menu-action__icon"
              src=${assetUrl(icon)}
              alt=""
              aria-hidden="true"
              draggable="false"
            />`
          : nothing}
        ${title}
        ${badge
          ? html`<span
              class="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1.5 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold"
              >${badge}</span
            >`
          : nothing}
        ${adornment}
      </button>
    `;
  }

  private renderLobbyCard(
    lobby: PublicGameInfo,
    titleContent: string | TemplateResult,
    heightClass: string,
  ) {
    const startAt = lobby.startsAt ?? lobby.autoStartAt;
    const timeRemaining =
      startAt === undefined
        ? undefined
        : getSecondsUntilServerTimestamp(startAt, this.serverTimeOffset);

    let timeDisplay: string;
    let timeDisplayUppercase = false;
    if (timeRemaining === undefined) {
      timeDisplay = translateText("host_modal.waiting");
    } else if (timeRemaining > 0) {
      timeDisplay = translateText("public_lobby.starting_in", {
        time: renderDuration(timeRemaining),
      });
    } else {
      timeDisplay = translateText("public_lobby.starting_game");
      timeDisplayUppercase = true;
    }

    // Socket-sourced, so a list-API outage neither dims this nor refuses it,
    // for the reason in the rule at the top of this file.
    return lobbyCard({
      lobby,
      subtitle: titleContent,
      timeDisplay,
      timeDisplayUppercase,
      disabled: !this.inputValid,
      blocked: false,
      viewerTrusted: this.viewerTrusted,
      heightClass,
      onClick: () => this.validateAndJoin(lobby),
    });
  }

  private validateAndJoin(lobby: PublicGameInfo) {
    if (!this.validateUsername()) return;
    if (!canJoinTrustedLobby(lobby, this.viewerTrusted)) {
      this.showTrustRequired = true;
      return;
    }

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: lobby.gameID,
          source: "public",
          publicLobbyInfo: lobby,
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }
}
