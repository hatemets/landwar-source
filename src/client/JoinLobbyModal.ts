import { GAME_ID_REGEX, GameConfig } from "@openfront/engine-api/Schemas";
import { GameMode, GameType } from "@openfront/engine-api/game/GameTypes";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { EventBus } from "@openfront/shared/EventBus";
import {
  ClientInfo,
  GameInfo,
  GameRecordSchema,
  LobbyInfoEvent,
  PublicGameInfo,
} from "@openfront/shared/WireSchemas";
import { html, nothing, TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import {
  calculateServerTimeOffset,
  getActiveModifiers,
  getGameModeLabel,
  getMapName,
  getSecondsUntilServerTimestamp,
  getServerNow,
  renderDuration,
  translateText,
} from "../client/Utils";
import { SendSpectateEvent } from "./LobbyEvents";
import { PublicLobbySocket } from "./LobbySocket";
import { JoinLobbyEvent } from "./Main";
import { ensureServerList, redirectToGameVersion } from "./ServerList";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { normaliseMapKey } from "./Utils";
import { findVersionedShell } from "./VersionedReplay";
import { BaseModal } from "./components/BaseModal";
import { renderGlobeLoader } from "./components/ConquestGlobe";
import "./components/CopyButton";
import { GameStartAlertController } from "./components/GameStartAlertController";
import { LobbyCardIconTag, lobbyCard } from "./components/LobbyCard";
import "./components/LobbyPlayerView";
import { DEFAULT_TITLE_CLASS, modalHeader } from "./components/ui/ModalHeader";
import { openReplayViewer } from "./replay/ReplayEntry";
import { nationsConfigToSlider } from "./utilities/GameConfigHelpers";
import {
  disabledUnitsTable,
  hostCheatsBox,
  lobbySettingsTable,
  lobbySettingTagText,
  notableLobbySettings,
} from "./utilities/LobbySettingsSummary";

@customElement("join-lobby-modal")
export class JoinLobbyModal extends BaseModal {
  @query("#lobbyIdInput") private lobbyIdInput!: HTMLInputElement;

  @property({ attribute: false }) eventBus: EventBus | null = null;

  @state() private players: ClientInfo[] = [];
  @state() private playerCount: number = 0;
  @state() private gameConfig: GameConfig | null = null;
  @state() private currentLobbyId: string = "";
  @state() private currentClientID: string = "";
  @state() private nationCount: number = 0;
  @state() private lobbyStartAt: number | null = null;
  @state() private serverTimeOffset: number = 0;
  @state() private isConnecting: boolean = true;
  @state() private lobbyCreatorClientID: string | null = null;
  // Subscriber-hosted private lobbies listed in the public browser, shown on
  // the pre-join form.
  @state() private hostedLobbies: PublicGameInfo[] = [];
  @state() private hostedLobbiesLoaded = false;
  // Clock offset for the hosted list's countdowns, kept apart from
  // serverTimeOffset (the joined lobby's).
  private hostedServerTimeOffset = 0;
  private readonly gameStartAlert = new GameStartAlertController(
    this,
    () => this.currentLobbyId !== "",
  );

  private leaveLobbyOnClose = true;
  private countdownTimerId: number | null = null;
  private handledJoinTimeout = false;

  private readonly hostedLobbySocket = new PublicLobbySocket((lobbies) => {
    this.hostedServerTimeOffset = calculateServerTimeOffset(lobbies.serverTime);
    // Re-assigned on every broadcast (~2/s), which also keeps the row
    // countdowns ticking.
    this.hostedLobbies = lobbies.games?.hosted ?? [];
    this.hostedLobbiesLoaded = true;
  });

  private isPrivateLobby(): boolean {
    return this.gameConfig?.gameType === GameType.Private;
  }

  // Read off the server's own view of us, so a switch it refused (lobby full,
  // game already started) shows the real state instead of what was asked for.
  private get isSpectating(): boolean {
    return (
      this.players.find((p) => p.clientID === this.currentClientID)
        ?.spectator === true
    );
  }

  private setSpectating(spectator: boolean) {
    this.eventBus?.emit(new SendSpectateEvent(spectator));
  }

  private readonly handleLobbyInfo = (event: LobbyInfoEvent) => {
    const lobby = event.lobby;
    this.currentClientID = event.myClientID;
    // Only stop showing spinner when we have player info
    if (this.isConnecting && lobby.clients) {
      this.isConnecting = false;
    }
    this.updateFromLobby({
      ...lobby,
      startsAt: lobby.startsAt ?? undefined,
    });
  };

  protected renderHeaderSlot() {
    if (!this.currentLobbyId) {
      return modalHeader({
        title: translateText("private_lobby.title"),
        titleClassName: "lobby-experience__title",
        onBack: () => this.closeAndLeave(),
        ariaLabel: translateText("common.close"),
      });
    }
    // Both affordances answer "get my friends into this lobby", so they sit
    // together. The Steam invite works for public and private lobbies alike,
    // because the shell keeps a shadow lobby for any joined game.
    // Except public FFA: bringing friends into an every-man-for-himself
    // public match encourages teaming, so both stay off there. Public team
    // lobbies and private lobbies keep them. A config that has not arrived
    // yet counts as "off" too — the URL-join and accepted-invite paths render
    // this header before the first lobby_info, and that window must not show
    // a button the config may be about to forbid.
    const isPublicFfa =
      this.gameConfig?.gameType === GameType.Public &&
      this.gameConfig.gameMode !== GameMode.Team;
    const canShare = this.gameConfig !== null && !isPublicFfa;
    const copy = canShare
      ? html`<copy-button .lobbyId=${this.currentLobbyId}></copy-button>`
      : undefined;
    return modalHeader({
      // titleContent (not title) so the bell can sit at the right edge of the
      // title row via ml-auto, next to the copy button.
      titleContent: html`<span
          class="lobby-experience__title ${DEFAULT_TITLE_CLASS}"
          >${translateText("public_lobby.title")}</span
        >
        ${this.gameStartAlert.renderBell()}`,
      onBack: () => this.closeAndLeave(),
      ariaLabel: translateText("common.close"),
      rightContent: copy,
    });
  }

  protected modalConfig() {
    return { appearance: "field" as const };
  }

  // Play/Spectate switch. Hidden once the game is running: the player list is
  // frozen at start, so the server would refuse to seat anyone new and the
  // control would do nothing.
  private renderSpectateToggle() {
    // Any joined lobby can be spectated — a host-started private lobby has no
    // scheduled start (lobbyStartAt null), and gating on it hid the toggle in
    // exactly the lobbies it exists for. The server still refuses seating after
    // start, so no client-side start check is needed here.
    if (this.isConnecting) return html``;
    const spectating = this.isSpectating;
    const cls = (on: boolean) =>
      `px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-widest transition ${
        on ? "bg-white text-black" : "text-white/60 hover:text-white"
      }`;
    return html`
      <div class="flex items-center gap-1 rounded-xl bg-white/5 p-1">
        <button
          class=${cls(!spectating)}
          ?disabled=${!spectating}
          @click=${() => this.setSpectating(false)}
        >
          ${translateText("private_lobby.play")}
        </button>
        <button
          class=${cls(spectating)}
          ?disabled=${spectating}
          @click=${() => this.setSpectating(true)}
        >
          ${translateText("private_lobby.spectate")}
        </button>
      </div>
    `;
  }

  protected renderBody() {
    // Pre-join state: show lobby ID input form
    if (!this.currentLobbyId) {
      return this.renderJoinForm();
    }

    // Post-join state: show lobby info (identical for public & private)
    const secondsRemaining =
      this.lobbyStartAt !== null
        ? getSecondsUntilServerTimestamp(
            this.lobbyStartAt,
            this.serverTimeOffset,
          )
        : null;
    const statusLabel =
      secondsRemaining === null
        ? this.isPrivateLobby()
          ? translateText("private_lobby.joined_waiting")
          : translateText("public_lobby.waiting_for_players")
        : secondsRemaining > 0
          ? translateText("public_lobby.starting_in", {
              time: renderDuration(secondsRemaining),
            })
          : translateText("public_lobby.started");
    const maxPlayers = this.gameConfig?.maxPlayers ?? 0;
    // Seats, not connections: spectators are in the roster but hold none.
    const playerCount = this.players?.filter((p) => !p.spectator).length ?? 0;
    const hostClientID = this.isPrivateLobby()
      ? (this.lobbyCreatorClientID ?? "")
      : "";
    return html`
      <div class="lobby-experience flex flex-col h-full">
        <div class="flex-1 custom-scrollbar p-6 space-y-4 mr-1">
          ${this.isConnecting
            ? html`
                ${renderGlobeLoader(translateText("public_lobby.connecting"))}
              `
            : html`
                ${this.gameConfig ? this.renderGameConfig() : html``}
                ${this.players.length > 0
                  ? html`
                      <lobby-player-view
                        class="mt-6"
                        .tableLayout=${true}
                        .gameMode=${this.gameConfig?.gameMode ?? GameMode.FFA}
                        .clients=${this.players}
                        .lobbyCreatorClientID=${hostClientID}
                        .currentClientID=${this.currentClientID}
                        .anonymizeNames=${this.gameConfig?.anonymizeNames ??
                        false}
                        .teamCount=${this.gameConfig?.playerTeams ?? 2}
                        .isPublicGame=${this.gameConfig?.gameType ===
                        GameType.Public}
                        .nationCount=${nationsConfigToSlider(
                          this.gameConfig?.nations ?? "default",
                          this.nationCount,
                        )}
                      ></lobby-player-view>
                    `
                  : ""}
              `}
        </div>

        ${html`
          <div
            class="p-6 lg:p-6 border-t border-white/10 bg-black/60 backdrop-blur-md shrink-0 sticky bottom-0 z-10"
          >
            <div
              class="w-full px-4 py-3 rounded-xl border border-white/10 bg-white/5 flex items-center justify-between gap-3"
            >
              <div class="flex flex-col">
                <span
                  class="text-[10px] font-bold uppercase tracking-widest text-white/40"
                  >${translateText("public_lobby.status")}</span
                >
                <span
                  data-test-lobby-status
                  class="text-sm font-bold tabular-nums ${secondsRemaining !==
                    null && secondsRemaining > 0
                    ? "text-amber-300"
                    : "text-white"}"
                  >${statusLabel}</span
                >
              </div>
              ${this.renderSpectateToggle()}
              ${maxPlayers > 0
                ? html`
                    <div
                      class="flex items-center gap-2 text-white/80 text-xs font-bold uppercase tracking-widest"
                    >
                      <span>${playerCount}/${maxPlayers}</span>
                      <svg
                        class="w-4 h-4 text-white"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.972 0 004 15v3H1v-3a3 3 0 013.75-2.906z"
                        ></path>
                      </svg>
                    </div>
                  `
                : html``}
            </div>
          </div>
        `}
      </div>
    `;
  }

  private renderJoinForm() {
    return html`
      <div
        class="lobby-experience lobby-experience--join-form custom-scrollbar p-6 space-y-4 mr-1"
      >
        <form @submit=${this.joinLobbyFromInput}>
          <div class="flex flex-col gap-3 md:flex-row md:gap-2">
            <input
              type="text"
              id="lobbyIdInput"
              placeholder=${translateText("private_lobby.enter_id")}
              @keyup=${this.handleChange}
              class="field-input md:flex-1"
              autocomplete="off"
              spellcheck="false"
            />
            <div class="flex gap-2 md:flex-1">
              <div class="flex-[2] md:flex-1">
                <o-button
                  title=${translateText("private_lobby.join_lobby")}
                  width="block"
                  submit
                ></o-button>
              </div>
              <div class="flex-1">
                <o-button
                  variant="secondary"
                  title=${translateText("private_lobby.spectate")}
                  width="block"
                  @click=${this.spectateLobbyFromInput}
                ></o-button>
              </div>
            </div>
          </div>
        </form>
        ${this.renderHostedLobbies()}
      </div>
    `;
  }

  private renderHostedLobbies() {
    let content: TemplateResult;
    if (!this.hostedLobbiesLoaded) {
      content = renderGlobeLoader(undefined, { compact: true });
    } else if (this.hostedLobbies.length === 0) {
      content = html`<div
        role="status"
        aria-live="polite"
        class="lobby-empty-state lobby-empty-state--large"
      >
        <img
          class="lobby-empty-state__art"
          src=${assetUrl("images/illustrations/FindLobby.webp")}
          alt=""
          aria-hidden="true"
          draggable="false"
        />
        <p class="lobby-empty-state__message">
          ${translateText("private_lobby.no_open_lobbies")}
        </p>
      </div>`;
    } else {
      content = html`<div class="menu-lobby-list menu-lobby-list--wide">
        ${this.hostedLobbies.map((lobby) => this.renderHostedLobbyRow(lobby))}
      </div>`;
    }
    return html`
      <div class="pt-4">
        <h3 class="text-sm font-semibold text-white mb-3">
          ${translateText("private_lobby.open_lobbies")}
        </h3>
        ${content}
      </div>
    `;
  }

  private renderHostedLobbyRow(lobby: PublicGameInfo) {
    const c = lobby.gameConfig;
    if (!c) return nothing;
    // The card already tags the lobby's modifiers; a setting they cover
    // would show twice.
    const modifiers = getActiveModifiers(
      c.publicGameModifiers,
      c.doomsdayClock?.speed,
    );
    const covered = new Set(modifiers.map((m) => translateText(m.labelKey)));
    if (c.publicGameModifiers?.startingGold) {
      covered.add(translateText("private_lobby.starting_gold"));
    }
    // Nation count for this map isn't loaded pre-join, so the numeric-nations
    // default comparison is skipped in the tags.
    const immunity = translateText("private_lobby.pvp_immunity");
    const tags: (string | LobbyCardIconTag)[] = notableLobbySettings(c, null)
      .filter((s) => !covered.has(s.label))
      .map((s) =>
        s.label === immunity
          ? { icon: "immunity", text: s.value, label: lobbySettingTagText(s) }
          : lobbySettingTagText(s),
      );
    const disabledUnitCount = c.disabledUnits?.length ?? 0;
    // A struck-out modifier ("Nukes") already says which units are off.
    const unitsTagged = modifiers.some(
      (m) =>
        m.turnsOff &&
        m.labelKey !== "public_game_modifier.disable_alliances_label",
    );
    if (disabledUnitCount > 0 && !unitsTagged) {
      tags.push(
        `${translateText("private_lobby.disabled_units")}: ${disabledUnitCount}`,
      );
    }
    // The host's Start countdown once armed, otherwise the listing deadline.
    const startAt = lobby.startsAt ?? lobby.autoStartAt;
    const secondsToStart =
      startAt === undefined
        ? undefined
        : getSecondsUntilServerTimestamp(startAt, this.hostedServerTimeOffset);
    // The same card as the homepage's upcoming list: the map fills it and
    // the details sit on the map.
    return lobbyCard({
      lobby,
      subtitle: getGameModeLabel(c),
      timeDisplay:
        secondsToStart === undefined
          ? ""
          : secondsToStart > 0
            ? renderDuration(secondsToStart)
            : translateText("public_lobby.starting_game"),
      tags,
      onClick: () => void this.joinHostedLobby(lobby),
    });
  }

  private async joinHostedLobby(lobby: PublicGameInfo) {
    const lobbyId = lobby.gameID;
    this.startTrackingLobby(lobbyId, lobby);
    try {
      const gameExists = await this.checkActiveLobby(lobbyId);
      if (!gameExists) {
        // The lobby vanished between the broadcast and the click.
        this.resetTrackingState();
        this.showMessage(translateText("private_lobby.not_found"), "red");
      }
    } catch (error) {
      console.error("Error joining hosted lobby:", error);
      this.resetTrackingState();
      this.showMessage(translateText("private_lobby.error"), "red");
    }
  }

  protected onOpen(args?: Record<string, unknown>): void {
    // Re-armed here (not in onClose's reset) so that once
    // disarmLeaveOnClose() runs, no close cascade can re-arm it and
    // disconnect the player mid game-start.
    this.leaveLobbyOnClose = true;
    this.hostedLobbiesLoaded = false;
    void this.hostedLobbySocket.start();
    const lobbyId = typeof args?.lobbyId === "string" ? args.lobbyId : "";
    const lobbyInfo = args?.lobbyInfo as GameInfo | PublicGameInfo | undefined;
    if (lobbyId) {
      this.startTrackingLobby(lobbyId, lobbyInfo);
      // If opened with lobbyId but no lobbyInfo (URL join case), auto-join the lobby
      if (!lobbyInfo) {
        this.handleUrlJoin(lobbyId, args?.spectate === true);
      }
    }
  }

  private async handleUrlJoin(
    lobbyId: string,
    spectator = false,
  ): Promise<void> {
    try {
      const gameExists = await this.checkActiveLobby(lobbyId, spectator);
      if (gameExists) return;

      // A finished game has no lobby to spectate, so both link forms fall
      // through to the same archive: the play link and the spectate link
      // become the same replay once the game is over.
      // Active lobby not found, check if it's an archived game
      switch (await this.checkArchivedGame(lobbyId)) {
        case "success":
          return;
        case "redirected":
          // Navigating to the versioned replay shell; leave state as-is.
          return;
        case "not_found":
          this.resetTrackingState();
          this.showMessage(translateText("private_lobby.not_found"), "red");
          return;
        case "version_mismatch":
          this.resetTrackingState();
          this.showMessage(
            translateText("private_lobby.version_mismatch"),
            "red",
          );
          return;
        case "error":
          this.resetTrackingState();
          this.showMessage(translateText("private_lobby.error"), "red");
          return;
      }
    } catch (error) {
      console.warn("Error checking lobby from URL:", error);
      this.resetTrackingState();
      this.showMessage(translateText("private_lobby.error"), "red");
    }
  }

  private startTrackingLobby(
    lobbyId: string,
    lobbyInfo?: GameInfo | PublicGameInfo,
  ) {
    this.currentLobbyId = lobbyId;
    // clientID will be assigned by server via lobby_info message
    this.currentClientID = "";
    this.gameConfig = null;
    this.players = [];
    this.nationCount = 0;
    this.lobbyStartAt = null;
    this.serverTimeOffset = 0;
    this.lobbyCreatorClientID = null;
    this.gameStartAlert.reset();
    this.isConnecting = true;
    this.handledJoinTimeout = false;
    this.startLobbyUpdates();
    if (lobbyInfo) {
      this.updateFromLobby(lobbyInfo);
      // Only stop showing spinner when we have player info
      if ("clients" in lobbyInfo && lobbyInfo.clients) {
        this.isConnecting = false;
      }
    }
  }

  private resetTrackingState() {
    this.stopLobbyUpdates();
    this.currentLobbyId = "";
    this.currentClientID = "";
    this.isConnecting = false;
  }

  private leaveLobby() {
    if (!this.currentLobbyId) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("leave-lobby", {
        detail: { lobby: this.currentLobbyId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  public confirmBeforeClose(): boolean | Promise<boolean> {
    if (!this.currentLobbyId) return true;
    return this.confirmClose(translateText("host_modal.leave_confirmation"));
  }

  protected onClose(): void {
    this.hostedLobbySocket.stop();
    this.hostedLobbies = [];
    this.hostedLobbiesLoaded = false;
    this.clearCountdownTimer();
    this.stopLobbyUpdates();

    if (this.leaveLobbyOnClose) {
      this.leaveLobby();
      this.updateHistory("/");
    }

    if (this.lobbyIdInput) this.lobbyIdInput.value = "";
    this.gameConfig = null;
    this.players = [];
    this.currentLobbyId = "";
    this.currentClientID = "";
    this.nationCount = 0;
    this.lobbyStartAt = null;
    this.serverTimeOffset = 0;
    this.lobbyCreatorClientID = null;
    this.gameStartAlert.reset();
    this.isConnecting = true;
  }

  disconnectedCallback() {
    this.hostedLobbySocket.stop();
    this.clearCountdownTimer();
    this.stopLobbyUpdates();
    super.disconnectedCallback();
  }

  public closeAndLeave() {
    this.leaveLobby();
    try {
      this.updateHistory("/");
    } catch (error) {
      console.warn("Failed to restore URL on leave:", error);
    }
    this.leaveLobbyOnClose = false;
    this.close();
  }

  // Closing this modal is part of the game-start transition, not the player
  // leaving. Kept separate from closeWithoutLeaving because closing ANY
  // page-modal navigates via showPage, which force-closes the currently
  // visible page — so all lobby modals must be disarmed before any of them
  // is closed.
  public disarmLeaveOnClose() {
    this.leaveLobbyOnClose = false;
  }

  public closeWithoutLeaving() {
    this.disarmLeaveOnClose();
    this.close();
  }

  private updateHistory(url: string): void {
    history.replaceState(null, "", url);
  }

  // --- Game config rendering ---

  private renderGameConfig(): TemplateResult {
    if (!this.gameConfig) return html``;

    const c = this.gameConfig;
    const mapName = getMapName(c.gameMap);
    const normalizedMap = normaliseMapKey(c.gameMap);
    const thumbnailUrl = assetUrl(
      `maps/${encodeURIComponent(normalizedMap)}/thumbnail.webp`,
    );
    const modeSubtitle = getGameModeLabel(c);

    const settings = notableLobbySettings(c, this.nationCount);

    // Size the frame to the image, so tall maps do not leave wide gutters.

    return html`
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
        <span class="text-lg font-bold text-white">${mapName}</span>
        <span class="text-sm text-white/60">${modeSubtitle}</span>
      </div>
      <div class="lobby-briefing">
        <div data-test-map-preview class="lobby-briefing__map">
          <img
            src=${thumbnailUrl}
            alt=${mapName ?? c.gameMap}
            class="block object-contain"
            @error=${(e: Event) => {
              const frame = (e.target as HTMLElement).parentElement;
              if (frame) frame.style.display = "none";
            }}
          />
        </div>
        <div data-test-lobby-settings class="lobby-briefing__details">
          ${settings.length > 0 ? lobbySettingsTable(settings) : nothing}
          ${disabledUnitsTable(c)} ${hostCheatsBox(c, "mt-4")}
        </div>
      </div>
    `;
  }

  // --- Lobby event handling ---

  private updateFromLobby(lobby: GameInfo | PublicGameInfo) {
    this.players = "clients" in lobby ? (lobby.clients ?? []) : [];
    if ("serverTime" in lobby && typeof lobby.serverTime === "number") {
      this.serverTimeOffset = calculateServerTimeOffset(lobby.serverTime);
    }
    // The start countdown once armed, otherwise a listed lobby's deadline,
    // so a player in any lobby that will start sees when.
    this.lobbyStartAt = lobby.startsAt ?? lobby.autoStartAt ?? null;
    this.syncCountdownTimer();
    if (lobby.gameConfig) {
      const mapChanged = this.gameConfig?.gameMap !== lobby.gameConfig.gameMap;
      this.gameConfig = lobby.gameConfig;
      if (mapChanged) {
        this.loadNationCount();
      }
    }

    this.lobbyCreatorClientID =
      "lobbyCreatorClientID" in lobby
        ? (lobby.lobbyCreatorClientID ?? null)
        : null;
  }

  private startLobbyUpdates() {
    this.stopLobbyUpdates();
    if (!this.eventBus) {
      console.warn(
        "JoinLobbyModal: eventBus not set, cannot subscribe to lobby updates",
      );
      return;
    }
    this.eventBus.on(LobbyInfoEvent, this.handleLobbyInfo);
  }

  private stopLobbyUpdates() {
    this.eventBus?.off(LobbyInfoEvent, this.handleLobbyInfo);
  }

  // --- Countdown timer ---

  private syncCountdownTimer() {
    if (this.lobbyStartAt === null) {
      this.clearCountdownTimer();
      return;
    }
    if (this.countdownTimerId !== null) {
      return;
    }
    this.countdownTimerId = window.setInterval(() => {
      this.checkForJoinTimeout();
      this.requestUpdate();
    }, 1000);
  }

  private clearCountdownTimer() {
    if (this.countdownTimerId === null) {
      return;
    }
    clearInterval(this.countdownTimerId);
    this.countdownTimerId = null;
  }

  private checkForJoinTimeout() {
    if (
      this.handledJoinTimeout ||
      !this.isConnecting ||
      this.lobbyStartAt === null ||
      !this.isModalOpen
    ) {
      return;
    }
    if (getServerNow(this.serverTimeOffset) < this.lobbyStartAt) {
      return;
    }
    this.handledJoinTimeout = true;
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: translateText("public_lobby.join_timeout"),
          color: "red",
          duration: 3500,
        },
      }),
    );
    this.closeAndLeave();
  }

  // --- Nation count ---

  private async loadNationCount() {
    if (!this.gameConfig) {
      this.nationCount = 0;
      return;
    }
    const currentMap = this.gameConfig.gameMap;
    try {
      const mapData = terrainMapFileLoader.getMapData(currentMap);
      const manifest = await mapData.manifest();
      if (this.gameConfig?.gameMap === currentMap) {
        this.nationCount = manifest.nations.length;
      }
    } catch (error) {
      console.warn("Failed to load nation count", error);
      if (this.gameConfig?.gameMap === currentMap) {
        this.nationCount = 0;
      }
    }
  }

  // --- Private lobby join flow (lobby ID input) ---

  private isValidLobbyId(value: string): boolean {
    return GAME_ID_REGEX.test(value);
  }

  private normalizeLobbyId(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const extracted = this.extractLobbyIdFromUrl(trimmed).trim();
    if (!this.isValidLobbyId(extracted)) return null;
    return extracted;
  }

  private sanitizeForLog(value: string): string {
    return value.replace(/[\r\n]/g, "");
  }

  private extractLobbyIdFromUrl(input: string): string {
    if (!input.startsWith("http")) {
      return input;
    }

    try {
      const url = new URL(input);
      const match = url.pathname.match(/game\/([^/]+)/);
      const candidate = match?.[1];
      if (candidate && GAME_ID_REGEX.test(candidate)) return candidate;

      return input;
    } catch (error) {
      console.warn("Failed to parse lobby URL", error);
      return input;
    }
  }

  private setLobbyId(id: string) {
    if (this.lobbyIdInput) {
      this.lobbyIdInput.value = this.extractLobbyIdFromUrl(id);
    }
  }

  private handleChange(e: Event) {
    const value = (e.target as HTMLInputElement).value.trim();
    this.setLobbyId(value);
  }

  private joinLobbyFromInput(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    return this.enterLobbyFromInput(false);
  }

  private spectateLobbyFromInput(): Promise<void> {
    return this.enterLobbyFromInput(true);
  }

  private async enterLobbyFromInput(spectator: boolean): Promise<void> {
    const lobbyId = this.normalizeLobbyId(this.lobbyIdInput.value);
    if (!lobbyId) {
      this.showMessage(translateText("private_lobby.not_found"), "red");
      return;
    }

    this.lobbyIdInput.value = lobbyId;
    console.log(`Joining lobby with ID: ${this.sanitizeForLog(lobbyId)}`);

    // Initialize tracking state before checking/joining
    this.startTrackingLobby(lobbyId);

    try {
      const gameExists = await this.checkActiveLobby(lobbyId, spectator);
      if (gameExists) return;

      switch (await this.checkArchivedGame(lobbyId)) {
        case "success":
          return;
        case "redirected":
          // Navigating to the versioned replay shell; leave state as-is.
          return;
        case "not_found":
          this.resetTrackingState();
          this.showMessage(translateText("private_lobby.not_found"), "red");
          return;
        case "version_mismatch":
          this.resetTrackingState();
          this.showMessage(
            translateText("private_lobby.version_mismatch"),
            "red",
          );
          return;
        case "error":
          this.resetTrackingState();
          this.showMessage(translateText("private_lobby.error"), "red");
          return;
      }
    } catch (error) {
      console.warn("Error checking lobby existence:", error);
      this.resetTrackingState();
      this.showMessage(translateText("private_lobby.error"), "red");
    }
  }

  private showMessage(message: string, color: "green" | "red" = "green") {
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: { message, duration: 3000, color },
      }),
    );
  }

  private async checkActiveLobby(
    lobbyId: string,
    spectator = false,
  ): Promise<boolean> {
    // The id's letter names the game's server in the API's list
    // (multi-server v2); load it before resolving. No version check here:
    // the letter names the server whatever version it runs, and a mismatch
    // is answered at join time (version_mismatch), never by navigating a
    // page that may be mid-game.
    await ensureServerList();
    // The list also says which build the game's server runs. On the web,
    // open the game at THAT version's page rather than probing it with the
    // wrong bundle: true here means a navigation is under way, and the
    // caller should stop as it does for a game it joined. The desktop and
    // replay shells, and the loop-guarded cases, fall through -- the whole
    // rule lives in redirectToGameVersion.
    if (redirectToGameVersion(lobbyId, spectator)) return true;

    let response: Response;
    try {
      const url = `${ClientEnv.gameHttpBase(lobbyId)}/${ClientEnv.gameWorkerPath(lobbyId)}/api/game/${lobbyId}/exists`;
      response = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      // Game server is unreachable, dead, or blocked by CORS: lobby is not active.
      return false;
    }

    if (!response.ok) {
      return false;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return false;
    }

    let gameInfo: { exists?: boolean };
    try {
      gameInfo = await response.json();
    } catch (error) {
      console.warn("Failed to parse active lobby response", error);
      return false;
    }

    if (gameInfo.exists) {
      // A spectator can enter a game that is already running, so the usual
      // "waiting for host to start" is wrong for them.
      this.showMessage(
        translateText(
          spectator
            ? "private_lobby.spectating"
            : "private_lobby.joined_waiting",
        ),
      );

      // Use the clientID that was already set by startTrackingLobby in open()
      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobbyId,
            source: "private",
            spectator,
          } as JoinLobbyEvent,
          bubbles: true,
          composed: true,
        }),
      );

      // Event tracking is already started by open() -> startTrackingLobby()
      // LobbyInfoEvents will update the UI as they arrive
      return true;
    }

    return false;
  }

  private async checkArchivedGame(
    lobbyId: string,
  ): Promise<
    "success" | "redirected" | "not_found" | "version_mismatch" | "error"
  > {
    const archiveResponse = await fetch(
      `/api/games/${encodeURIComponent(lobbyId)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    if (archiveResponse.status === 404) {
      return "not_found";
    }
    if (archiveResponse.status !== 200) {
      return "error";
    }

    const archiveData = await archiveResponse.json();
    const parsed = GameRecordSchema.safeParse(archiveData);
    if (!parsed.success) {
      return "version_mismatch";
    }

    const gitCommit = ClientEnv.gitCommit();
    if (gitCommit !== "DEV" && parsed.data.gitCommit !== gitCommit) {
      const safeLobbyId = this.sanitizeForLog(lobbyId);
      console.warn(
        `Git commit hash mismatch for game ${safeLobbyId}`,
        archiveData.details,
      );
      if (await this.redirectToVersionedShell(lobbyId)) {
        return "redirected";
      }
      return "version_mismatch";
    }

    // If the modal closes as part of joining the replay, do not leave/reset URL
    this.leaveLobbyOnClose = false;

    // This build can replay it, so open the replay viewer if the player
    // turned it on (and it hasn't sent this game back to the classic replay).
    if (openReplayViewer(lobbyId, parsed.data)) {
      this.close();
      return "success";
    }

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: lobbyId,
          gameRecord: parsed.data,
          source: "private",
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    return "success";
  }

  // The record was produced by a different build. replay.<domain>/<gameId>
  // serves the matching versioned shell (uploaded by update.sh on every
  // deploy); if it exists, navigate there and let that build replay the game
  // (#4934).
  private async redirectToVersionedShell(lobbyId: string): Promise<boolean> {
    const url = await findVersionedShell(
      ClientEnv.jwtAudience(),
      lobbyId,
      window.location.hostname,
    );
    if (url === null) {
      return false;
    }
    window.location.href = url;
    return true;
  }
}
