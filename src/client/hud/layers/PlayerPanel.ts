import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  AllPlayers,
  GameType,
  PlayerActions,
  PlayerProfile,
  PlayerType,
  Relation,
} from "@openfront/engine-api/game/GameTypes";
import { Emoji, flattenedEmojiTable } from "@openfront/engine-api/Schemas";
import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import Countries from "resources/countries.json" with { type: "json" };
import { fetchLobbyListed } from "../../Api";
import "../../components/EquippedCosmeticsRow";
import { actionButton } from "../../components/ui/ActionButton";
import "../../components/ui/Divider";
import { Controller } from "../../Controller";
import {
  CloseViewEvent,
  MouseUpEvent,
  SwapRocketDirectionEvent,
} from "../../InputHandler";
import {
  PlayerReportedEvent,
  SendAllianceRequestIntentEvent,
  SendBreakAllianceIntentEvent,
  SendEmbargoAllIntentEvent,
  SendEmbargoIntentEvent,
  SendEmojiIntentEvent,
  SendTargetPlayerIntentEvent,
} from "../../Transport";
import { UIState } from "../../UIState";
import { UserSettings } from "../../UserSettings";
import { renderDuration, showToast, translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";
import { ChatModal } from "./ChatModal";
import { EmojiTable } from "./EmojiTable";
import "./PlayerModerationModal";
import "./PlayerReportModal";
import "./SendResourceModal";
import { menuIcon } from "../../components/ui/MenuIcon";
const allianceIcon = assetUrl("images/AllianceIconWhite.svg");
const chatIcon = assetUrl("images/ChatIconWhite.svg");
const donateGoldIcon = assetUrl("images/DonateGoldIconWhite.svg");
const donateTroopIcon = assetUrl("images/DonateTroopIconWhite.svg");
const emojiIcon = assetUrl("images/EmojiIconWhite.svg");
const reportIcon = assetUrl("images/SirenIconWhite.svg");
const shieldIcon = assetUrl("images/ShieldIconWhite.svg");
const stopTradingIcon = assetUrl("images/StopIconWhite.svg");
const targetIcon = assetUrl("images/TargetIconWhite.svg");
const startTradingIcon = assetUrl("images/TradingIconWhite.svg");
const traitorIcon = assetUrl("images/TraitorIconLightRed.svg");
const breakAllianceIcon = assetUrl("images/TraitorIconWhite.svg");

@customElement("player-panel")
export class PlayerPanel extends LitElement implements Controller {
  public g: GameView;
  public eventBus: EventBus;
  public emojiTable: EmojiTable;
  public uiState: UIState;

  private actions: PlayerActions | null = null;
  private tile: TileRef | null = null;
  private _profileForPlayerId: number | null = null;
  private kickedPlayerIDs = new Set<string>();
  private userSettings = new UserSettings();

  @state() private sendTarget: PlayerView | null = null;
  @state() private sendMode: "troops" | "gold" | "none" = "none";
  @state() public isVisible: boolean = false;
  @state() private allianceExpiryText: string | null = null;
  @state() private allianceExpirySeconds: number | null = null;
  @state() private otherProfile: PlayerProfile | null = null;
  @state() private suppressNextHide: boolean = false;
  @state() private moderationTarget: PlayerView | null = null;
  @state() private reportTarget: PlayerView | null = null;
  // clientIDs this client has reported this game (confirmed sent by
  // Transport); the button locks after one.
  private reportedClientIDs = new Set<string>();
  @state() private playerRole: string | null = null;
  // Whether this game is a publicly listed lobby. Kept out of
  // GameStartInfo (never touches records), so it's fetched from the worker.
  @state() private gameListed = false;

  setRole(role: string | null): void {
    this.playerRole = role;
  }

  private get isAdminRole(): boolean {
    return this.playerRole === "admin" || this.playerRole === "root";
  }

  private ctModal: ChatModal;

  createRenderRoot() {
    return this;
  }

  initEventBus(eventBus: EventBus) {
    this.eventBus = eventBus;
    eventBus.on(CloseViewEvent, (e) => {
      if (this.isVisible) {
        this.hide();
      }
    });
    eventBus.on(SwapRocketDirectionEvent, (event) => {
      this.uiState.rocketDirectionUp = event.rocketDirectionUp;
      this.requestUpdate();
    });
    eventBus.on(PlayerReportedEvent, (event) => {
      this.reportedClientIDs.add(event.reported);
      this.requestUpdate();
      showToast(translateText("player_panel.report_sent"), "green");
    });
  }
  init() {
    this.eventBus.on(MouseUpEvent, () => {
      if (this.suppressNextHide) {
        this.suppressNextHide = false;
        return;
      }
      this.hide();
    });

    this.ctModal = document.querySelector("chat-modal") as ChatModal;
    if (!this.ctModal) {
      console.warn("ChatModal element not found in DOM");
    }

    // Only private games can be listed.
    if (this.g.config().gameConfig().gameType === GameType.Private) {
      void fetchLobbyListed(this.g.gameID()).then((listed) => {
        this.gameListed = listed;
      });
    }
  }

  async tick() {
    if (this.isVisible && this.tile) {
      const owner = this.g.owner(this.tile);
      if (owner && owner.isPlayer()) {
        const pv = owner as PlayerView;
        const id = pv.id();
        // fetch only if we don't have it or the player changed
        if (this._profileForPlayerId !== Number(id)) {
          this.otherProfile = await pv.profile();
          this._profileForPlayerId = Number(id);
        }
      }

      // Refresh actions & alliance expiry
      const myPlayer = this.g.myPlayer();
      if (myPlayer !== null && myPlayer.isAlive()) {
        try {
          this.actions = await myPlayer.actions(this.tile, null);
        } catch (error) {
          console.warn("Failed to refresh player panel actions:", error);
        }
        if (this.actions?.interaction?.allianceInfo?.expiresAt !== undefined) {
          const expiresAt = this.actions.interaction.allianceInfo.expiresAt;
          const remainingTicks = expiresAt - this.g.ticks();
          const remainingSeconds = Math.max(0, Math.floor(remainingTicks / 10)); // 10 ticks per second

          if (remainingTicks > 0) {
            this.allianceExpirySeconds = remainingSeconds;
            this.allianceExpiryText = renderDuration(remainingSeconds);
          } else {
            this.allianceExpirySeconds = null;
            this.allianceExpiryText = null;
          }
        } else {
          this.allianceExpirySeconds = null;
          this.allianceExpiryText = null;
        }
      }
      // Keep repainting while the panel is visible so live values (e.g. the
      // alliance countdowns) keep updating even after the local player dies.
      this.requestUpdate();
    }
  }

  public show(actions: PlayerActions, tile: TileRef) {
    this.actions = actions;
    this.tile = tile;
    this.moderationTarget = null;
    this.reportTarget = null;
    this.isVisible = true;
    this.requestUpdate();
  }

  public openSendGoldModal(
    actions: PlayerActions,
    tile: TileRef,
    target: PlayerView,
  ) {
    this.suppressNextHide = true;
    this.actions = actions;
    this.tile = tile;
    this.sendTarget = target;
    this.sendMode = "gold";
    this.moderationTarget = null;
    this.reportTarget = null;
    this.isVisible = true;
    this.requestUpdate();
  }

  public hide() {
    this.isVisible = false;
    this.sendMode = "none";
    this.sendTarget = null;
    this.moderationTarget = null;
    this.reportTarget = null;
    this.requestUpdate();
  }

  private handleClose(e: Event) {
    e.stopPropagation();
    this.hide();
  }

  private handleAllianceClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.eventBus.emit(new SendAllianceRequestIntentEvent(myPlayer, other));
    this.hide();
  }

  private handleBreakAllianceClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.eventBus.emit(new SendBreakAllianceIntentEvent(myPlayer, other));
    this.hide();
  }

  private openSendTroops(target: PlayerView) {
    this.suppressNextHide = true;
    this.sendTarget = target;
    this.sendMode = "troops";
  }

  private openSendGold(target: PlayerView) {
    this.suppressNextHide = true;
    this.sendTarget = target;
    this.sendMode = "gold";
  }

  private handleDonateTroopClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.openSendTroops(other);
  }

  private handleDonateGoldClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.openSendGold(other);
  }

  private closeSend = () => {
    this.sendTarget = null;
    this.sendMode = "none";
  };

  private confirmSend = (
    e: CustomEvent<{ amount: number; closePanel?: boolean }>,
  ) => {
    this.closeSend();
    if (e.detail?.closePanel) this.hide();
  };

  private handleEmbargoClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.eventBus.emit(new SendEmbargoIntentEvent(other, "start"));
    this.hide();
  }

  private handleStopEmbargoClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.eventBus.emit(new SendEmbargoIntentEvent(other, "stop"));
    this.hide();
  }

  private onStopTradingEnemiesClick(e: Event) {
    e.stopPropagation();
    this.eventBus.emit(new SendEmbargoAllIntentEvent("start"));
  }

  private onStartTradingEnemiesClick(e: Event) {
    e.stopPropagation();
    this.eventBus.emit(new SendEmbargoAllIntentEvent("stop"));
  }

  private handleEmojiClick(e: Event, myPlayer: PlayerView, other: PlayerView) {
    e.stopPropagation();
    this.emojiTable.showTable((emoji: string) => {
      if (myPlayer === other) {
        this.eventBus.emit(
          new SendEmojiIntentEvent(
            AllPlayers,
            flattenedEmojiTable.indexOf(emoji as Emoji),
          ),
        );
      } else {
        this.eventBus.emit(
          new SendEmojiIntentEvent(
            other,
            flattenedEmojiTable.indexOf(emoji as Emoji),
          ),
        );
      }
      this.emojiTable.hideTable();
      this.hide();
    });
  }

  private handleChat(e: Event, sender: PlayerView, other: PlayerView) {
    e.stopPropagation();

    if (!this.ctModal) {
      console.warn("ChatModal element not found in DOM");
      return;
    }

    this.ctModal.open(sender, other);
    this.hide();
  }

  private handleTargetClick(e: Event, other: PlayerView) {
    e.stopPropagation();
    this.eventBus.emit(new SendTargetPlayerIntentEvent(other.id()));
    this.hide();
  }

  private openModeration(e: MouseEvent, other: PlayerView) {
    e.stopPropagation();
    this.suppressNextHide = true;
    this.moderationTarget = other;
  }

  private closeModeration = () => {
    this.moderationTarget = null;
  };

  private handleModerationKicked = (e: CustomEvent<{ playerId?: string }>) => {
    const playerId = e.detail?.playerId;
    if (playerId) this.kickedPlayerIDs.add(String(playerId));
    this.closeModeration();
    this.hide();
  };

  private openReport(e: MouseEvent, other: PlayerView) {
    e.stopPropagation();
    this.suppressNextHide = true;
    this.reportTarget = other;
  }

  private closeReport = () => {
    this.reportTarget = null;
  };

  // Anyone may report another human of a multiplayer game. Singleplayer
  // records are client-authored and the API ignores their reports; once the
  // game is decided the record has been archived and the server refuses.
  private canReport(my: PlayerView, other: PlayerView): boolean {
    return (
      this.g.config().gameConfig().gameType !== GameType.Singleplayer &&
      !this.g.config().isReplay() &&
      !this.g.gameOver() &&
      other !== my &&
      other.type() === PlayerType.Human &&
      !!other.clientID()
    );
  }

  private handleToggleRocketDirection(e: Event) {
    e.stopPropagation();
    const next = !this.uiState.rocketDirectionUp;
    this.eventBus.emit(new SwapRocketDirectionEvent(next));
  }

  private identityChipProps(type: PlayerType) {
    switch (type) {
      case PlayerType.Nation:
        return {
          labelKey: "player_type.nation",
          classes: "bg-indigo-500/15 text-indigo-200",
          icon: "landmark" as const,
        };
      case PlayerType.Bot:
        return {
          labelKey: "player_type.bot",
          classes: "bg-purple-500/15 text-purple-200",
          icon: "swords" as const,
        };
      case PlayerType.Human:
      default:
        return {
          labelKey: "player_type.player",
          classes: "bg-gray-800 text-gray-300",
          icon: "user" as const,
        };
    }
  }

  private getRelationClass(relation: Relation): string {
    const base = "inline-flex items-center gap-1 rounded-sm px-2 py-0.5";

    switch (relation) {
      case Relation.Hostile:
        return `${base} bg-red-500/15 text-red-200`;
      case Relation.Distrustful:
        return `${base} bg-red-300/15 text-red-300`;
      case Relation.Friendly:
        return `${base} bg-emerald-500/15 text-emerald-200`;
      case Relation.Neutral:
      default:
        return `${base} bg-gray-800 text-gray-200`;
    }
  }

  private getRelationName(relation: Relation): string {
    switch (relation) {
      case Relation.Hostile:
        return translateText("relation.hostile");
      case Relation.Distrustful:
        return translateText("relation.distrustful");
      case Relation.Friendly:
        return translateText("relation.friendly");
      case Relation.Neutral:
      default:
        return translateText("relation.neutral");
    }
  }

  private getExpiryColorClass(seconds: number | null): string {
    if (seconds === null) return "text-white"; // Default color

    if (seconds <= 30) return "text-red-400"; // Last 30 seconds: Red
    if (seconds <= 60) return "text-yellow-400"; // Last 60 seconds: Yellow
    return "text-emerald-400"; // More than 60 seconds: Green
  }

  private getTraitorRemainingSeconds(player: PlayerView): number | null {
    const ticksLeft = player.getTraitorRemainingTicks();
    if (!player.isTraitor() || ticksLeft <= 0) return null;
    return Math.ceil(ticksLeft / 10); // 10 ticks = 1 second
  }

  private renderTraitorBadge(other: PlayerView) {
    if (!other.isTraitor()) return html``;

    const secs = this.getTraitorRemainingSeconds(other);
    const label = secs !== null ? renderDuration(secs) : null;
    const dotCls =
      secs !== null ? "mx-1 size-1 rounded-full bg-red-400/70" : "";

    return html`
      <div class="mt-1" role="status" aria-live="polite" aria-atomic="true">
        <span
          class="inline-flex items-center gap-2 rounded-sm bg-red-500/15 px-2 py-0.5 text-sm font-medium text-red-200"
          title=${translateText("player_panel.traitor")}
        >
          <img src=${traitorIcon} alt="" aria-hidden="true" class="size-4.5" />
          <span>${translateText("player_panel.traitor")}</span>
          ${label
            ? html`<span class=${dotCls}></span>
                <span
                  class="tabular-nums font-medium text-red-100 whitespace-nowrap text-sm"
                >
                  ${label}
                </span>`
            : ""}
        </span>
      </div>
    `;
  }

  private renderModeration(
    my: PlayerView,
    other: PlayerView,
    isAdmin: boolean,
  ) {
    const canReport = this.canReport(my, other);
    // The host of a publicly listed game cannot kick (server-enforced), so
    // don't offer the panel; admins keep it for moderation.
    const canModerate =
      (my.isLobbyCreator() || isAdmin) && (!this.gameListed || isAdmin);
    if (!canReport && !canModerate) return html``;
    const reported = this.reportedClientIDs.has(other.clientID() ?? "");
    const reportTitle = reported
      ? translateText("player_panel.reported")
      : translateText("player_panel.report");
    const moderationTitle = translateText("player_panel.moderation");

    return html`
      <ui-divider></ui-divider>
      <div class="grid auto-cols-fr grid-flow-col gap-2">
        ${canReport
          ? actionButton({
              onClick: (e: MouseEvent) => this.openReport(e, other),
              icon: reportIcon,
              iconAlt: "Report",
              title: reportTitle,
              label: reportTitle,
              type: "red",
              disabled: reported,
            })
          : ""}
        ${canModerate
          ? actionButton({
              onClick: (e: MouseEvent) => this.openModeration(e, other),
              icon: shieldIcon,
              iconAlt: "Moderation",
              title: moderationTitle,
              label: moderationTitle,
              type: "red",
            })
          : ""}
      </div>
    `;
  }

  private renderRelationPillIfNation(other: PlayerView, my: PlayerView) {
    if (other.type() !== PlayerType.Nation) return html``;
    if (other.isTraitor()) return html``;
    if (my?.isAlliedWith && my.isAlliedWith(other)) return html``;
    if (!this.otherProfile || !my) return html``;

    const relation =
      this.otherProfile.relations?.[my.smallID()] ?? Relation.Neutral;
    const cls = this.getRelationClass(relation);
    const name = this.getRelationName(relation);

    return html`
      <div class="mt-1">
        <span class="text-xs font-medium ${cls}">${name}</span>
      </div>
    `;
  }

  private renderIdentityRow(other: PlayerView, my: PlayerView) {
    const flagPath = other.cosmetics.flag;
    const flagCode = flagPath?.match(/\/flags\/(.+)\.svg$/)?.[1];
    const country =
      typeof flagCode === "string"
        ? Countries.find((c) => c.code === flagCode)
        : undefined;

    const chip =
      other.type() === PlayerType.Human
        ? null
        : this.identityChipProps(other.type());

    return html`
      <div class="flex items-center gap-2.5 flex-wrap">
        ${flagPath
          ? html`<img
              src=${assetUrl(flagPath)}
              alt=${country?.name ?? translateText("cosmetics.type_flag")}
              title=${country?.name ?? translateText("cosmetics.type_flag")}
              class="h-10 w-10 rounded-full object-cover"
              @error=${(e: Event) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />`
          : ""}

        <div class="flex-1 min-w-0 flex items-center gap-2">
          <h2
            class="min-w-0 text-lg font-semibold text-gray-50 truncate"
            title=${other.displayName()}
          >
            ${other.displayName()}
          </h2>
        </div>
        ${chip
          ? html`<span
              class=${`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium ${chip.classes}`}
              role="status"
              aria-label=${translateText(chip.labelKey)}
              title=${translateText(chip.labelKey)}
            >
              ${menuIcon(chip.icon, "size-3.5")}
              <span>${translateText(chip.labelKey)}</span>
            </span>`
          : html``}
      </div>
      ${this.renderTraitorBadge(other)}
      ${this.renderRelationPillIfNation(other, my)}
    `;
  }

  private renderResources(other: PlayerView) {
    return html`
      <div class="mb-1 flex justify-between gap-2">
        <div
          class="inline-flex items-center gap-1.5 rounded-md bg-gray-800 px-3 py-2 shrink-0
                    text-white w-35"
        >
          ${menuIcon("coins", "size-4 mr-0.5 text-yellow-400")}
          <span translate="no" class="tabular-nums w-[5ch] font-medium">
            ${renderNumber(other.gold() || 0)}
          </span>
          <span class="text-gray-200 whitespace-nowrap">
            ${translateText("player_panel.gold")}</span
          >
        </div>

        <div
          class="inline-flex items-center gap-1.5 rounded-md bg-gray-800 px-3 py-2
                    text-white w-35 shrink-0"
        >
          ${menuIcon("shield", "size-4 mr-0.5 text-blue-400")}
          <span translate="no" class="tabular-nums w-[5ch] font-medium">
            ${renderTroops(other.troops() || 0)}
          </span>
          <span class="text-gray-200 whitespace-nowrap">
            ${translateText("player_panel.troops")}</span
          >
        </div>
      </div>
    `;
  }

  private renderRocketDirectionToggle() {
    return html`
      <ui-divider></ui-divider>
      <button
        class="flex w-full items-center justify-between rounded-md bg-gray-800 px-3 py-2 text-left text-white hover:bg-gray-700 transition-colors"
        @click=${(e: Event) => this.handleToggleRocketDirection(e)}
      >
        <div class="flex flex-col">
          <span class="text-sm font-medium">
            ${translateText("player_panel.flip_rocket_trajectory")}
          </span>
          <span class="text-xs text-gray-300" translate="no">
            ${this.uiState.rocketDirectionUp
              ? translateText("player_panel.arc_up")
              : translateText("player_panel.arc_down")}
          </span>
        </div>
        ${menuIcon("shuffle", "size-5")}
      </button>
    `;
  }

  private renderStats(other: PlayerView, my: PlayerView) {
    return html`
      <!-- Betrayals -->
      <div class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        <div
          class="flex items-center gap-2 text-sm font-medium text-gray-100 leading-snug"
        >
          ${menuIcon("triangle-alert", "size-4 text-amber-400")}
          <span>${translateText("player_panel.betrayals")}</span>
        </div>
        <div class="text-right text-sm font-medium tabular-nums text-gray-200">
          ${other.betrayals()}
        </div>
      </div>

      <!-- Trading / Embargo -->
      <div class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        <div
          class="flex items-center gap-2 text-sm font-medium text-gray-100 leading-snug"
        >
          ${menuIcon("anchor", "size-4 text-blue-400")}
          <span>${translateText("player_panel.trading")}</span>
        </div>
        <div class="flex items-center justify-end gap-2 text-sm font-medium">
          ${other.hasEmbargoAgainst(my)
            ? html`<span class="text-amber-400"
                >${translateText("player_panel.stopped")}</span
              >`
            : html`<span class="text-blue-400"
                >${translateText("player_panel.active")}</span
              >`}
        </div>
      </div>
    `;
  }

  private renderAlliances(other: PlayerView) {
    const allies = other.allies();

    // Map ally PlayerID → expiry tick so each ally shows its own remaining time.
    const expiryByAlly = new Map<string, number>();
    for (const alliance of other.alliances()) {
      expiryByAlly.set(alliance.other, alliance.expiresAt);
    }
    const remainingSecondsFor = (ally: PlayerView): number | null => {
      const expiresAt = expiryByAlly.get(ally.id());
      if (expiresAt === undefined) return null;
      const remainingTicks = expiresAt - this.g.ticks();
      return Math.max(0, Math.floor(remainingTicks / 10)); // 10 ticks per second
    };

    // Soonest-expiring alliances first; ties (and no-expiry allies) by name.
    const nameCollator = new Intl.Collator(undefined, { sensitivity: "base" });
    const alliesSorted = [...allies].sort((a, b) => {
      const remainingA = remainingSecondsFor(a) ?? Infinity;
      const remainingB = remainingSecondsFor(b) ?? Infinity;
      if (remainingA !== remainingB) return remainingA - remainingB;
      return nameCollator.compare(a.displayName(), b.displayName());
    });

    return html`
      <div class="select-none">
        <div class="flex items-center justify-between mb-2">
          <div id="alliances-title" class="text-sm font-medium text-gray-200">
            ${translateText("player_panel.alliances")}
          </div>
          <span
            aria-labelledby="alliances-title"
            class="inline-flex items-center justify-center min-w-5 h-5 px-2 rounded-sm
                 text-xs tabular-nums text-gray-100 bg-gray-700"
          >
            ${allies.length}
          </span>
        </div>

        <div class="rounded-lg bg-gray-800 w-full min-w-0">
          <ul
            class="max-h-48 overflow-y-auto p-2
                 flex flex-wrap gap-2
                 scrollbar-thin scrollbar-thumb-gray-600 hover:scrollbar-thumb-gray-500 scrollbar-track-gray-800"
            role="list"
            aria-labelledby="alliances-title"
            translate="no"
          >
            ${alliesSorted.length === 0
              ? html`<li class="text-gray-400 text-sm px-1">
                  ${translateText("common.none")}
                </li>`
              : alliesSorted.map((p) => {
                  const remainingSeconds = remainingSecondsFor(p);
                  return html`<li
                    class="max-w-full inline-flex items-center gap-1.5
                           rounded-sm bg-gray-700
                           px-2 py-1 text-sm text-gray-100
                           hover:bg-gray-600 transition-colors"
                    title=${p.displayName()}
                  >
                    <span class="truncate">${p.displayName()}</span>
                    ${remainingSeconds !== null
                      ? html`<span
                          class="text-xs font-medium leading-none tabular-nums ${this.getExpiryColorClass(
                            remainingSeconds,
                          )}"
                          >${renderDuration(remainingSeconds)}</span
                        >`
                      : ""}
                  </li>`;
                })}
          </ul>
        </div>
      </div>
    `;
  }

  private renderAllianceExpiry() {
    if (this.allianceExpiryText === null) return html``;
    return html`
      <div class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <div class="font-medium text-gray-300">
          ${translateText("player_panel.alliance_time_remaining")}
        </div>
        <div class="text-right font-medium">
          <span
            class="inline-flex items-center rounded-sm px-2 py-0.5 text-sm font-medium tabular-nums ${this.getExpiryColorClass(
              this.allianceExpirySeconds,
            )}"
            >${this.allianceExpiryText}</span
          >
        </div>
      </div>
    `;
  }

  private renderActions(my: PlayerView, other: PlayerView) {
    const myPlayer = this.g.myPlayer();
    const canDonateGold = this.actions?.interaction?.canDonateGold;
    const canDonateTroops = this.actions?.interaction?.canDonateTroops;
    const canSendAllianceRequest =
      this.actions?.interaction?.canSendAllianceRequest;
    const canSendEmoji =
      other === myPlayer
        ? this.actions?.canSendEmojiAllPlayers
        : this.actions?.interaction?.canSendEmoji;
    const canBreakAlliance = this.actions?.interaction?.canBreakAlliance;
    const canTarget = this.actions?.interaction?.canTarget;
    const canEmbargo = this.actions?.interaction?.canEmbargo;

    return html`
      <div class="flex flex-col gap-2">
        <div class="grid auto-cols-fr grid-flow-col gap-2">
          ${actionButton({
            onClick: (e: MouseEvent) => this.handleChat(e, my, other),
            icon: chatIcon,
            iconAlt: "Chat",
            title: translateText("player_panel.chat"),
            label: translateText("player_panel.chat"),
          })}
          ${canSendEmoji
            ? actionButton({
                onClick: (e: MouseEvent) => this.handleEmojiClick(e, my, other),
                icon: emojiIcon,
                iconAlt: "Emoji",
                title: translateText("player_panel.emotes"),
                label: translateText("player_panel.emotes"),
                type: "normal",
              })
            : ""}
          ${canTarget
            ? actionButton({
                onClick: (e: MouseEvent) => this.handleTargetClick(e, other),
                icon: targetIcon,
                iconAlt: "Target",
                title: translateText("player_panel.target"),
                label: translateText("player_panel.target"),
                type: "normal",
              })
            : ""}
          ${canDonateTroops
            ? actionButton({
                onClick: (e: MouseEvent) =>
                  this.handleDonateTroopClick(e, my, other),
                icon: donateTroopIcon,
                iconAlt: "Troops",
                title: translateText("player_panel.send_troops"),
                label: translateText("player_panel.troops"),
                type: "normal",
              })
            : ""}
          ${canDonateGold
            ? actionButton({
                onClick: (e: MouseEvent) =>
                  this.handleDonateGoldClick(e, my, other),
                icon: donateGoldIcon,
                iconAlt: "Gold",
                title: translateText("player_panel.send_gold"),
                label: translateText("player_panel.gold"),
                type: "normal",
              })
            : ""}
        </div>
        <ui-divider></ui-divider>
        ${other === my
          ? html``
          : html`
              <div class="grid auto-cols-fr grid-flow-col gap-2">
                ${canEmbargo
                  ? actionButton({
                      onClick: (e: MouseEvent) =>
                        this.handleEmbargoClick(e, my, other),
                      icon: stopTradingIcon,
                      iconAlt: "Stop Trading",
                      title: translateText("player_panel.stop_trade"),
                      label: translateText("player_panel.stop_trade"),
                      type: "yellow",
                    })
                  : actionButton({
                      onClick: (e: MouseEvent) =>
                        this.handleStopEmbargoClick(e, my, other),
                      icon: startTradingIcon,
                      iconAlt: "Start Trading",
                      title: translateText("player_panel.start_trade"),
                      label: translateText("player_panel.start_trade"),
                      type: "green",
                    })}
                ${canBreakAlliance
                  ? actionButton({
                      onClick: (e: MouseEvent) =>
                        this.handleBreakAllianceClick(e, my, other),
                      icon: breakAllianceIcon,
                      iconAlt: "Break Alliance",
                      title: translateText("player_panel.break_alliance"),
                      label: translateText("player_panel.break_alliance"),
                      type: "red",
                    })
                  : ""}
                ${canSendAllianceRequest
                  ? actionButton({
                      onClick: (e: MouseEvent) =>
                        this.handleAllianceClick(e, my, other),
                      icon: allianceIcon,
                      iconAlt: "Alliance",
                      title: translateText("player_panel.send_alliance"),
                      label: translateText("player_panel.send_alliance"),
                      type: "indigo",
                    })
                  : ""}
              </div>
            `}
        ${other === my
          ? html`<div class="grid auto-cols-fr grid-flow-col gap-2">
              ${actionButton({
                onClick: (e: MouseEvent) => this.onStopTradingEnemiesClick(e),
                icon: stopTradingIcon,
                iconAlt: "Stop Trading With Enemies",
                title: !this.actions?.canEmbargoAll
                  ? `${translateText("player_panel.stop_trade_enemies")} - ${translateText("cooldown")}`
                  : translateText("player_panel.stop_trade_enemies"),
                label: !this.actions?.canEmbargoAll
                  ? `${translateText("player_panel.stop_trade_enemies")} ⏳`
                  : translateText("player_panel.stop_trade_enemies"),
                type: "yellow",
                disabled: !this.actions?.canEmbargoAll,
              })}
              ${actionButton({
                onClick: (e: MouseEvent) => this.onStartTradingEnemiesClick(e),
                icon: startTradingIcon,
                iconAlt: "Start Trading With Enemies",
                title: !this.actions?.canEmbargoAll
                  ? `${translateText("player_panel.start_trade_enemies")} - ${translateText("cooldown")}`
                  : translateText("player_panel.start_trade_enemies"),
                label: !this.actions?.canEmbargoAll
                  ? `${translateText("player_panel.start_trade_enemies")} ⏳`
                  : translateText("player_panel.start_trade_enemies"),
                type: "green",
                disabled: !this.actions?.canEmbargoAll,
              })}
            </div>`
          : ""}
        ${this.renderModeration(my, other, this.isAdminRole)}
      </div>
    `;
  }

  render() {
    if (!this.isVisible) return html``;

    const my = this.g.myPlayer();
    const isSpectator = this.g.isSpectator();
    if (!my && !isSpectator) return html``;
    if (!this.tile) return html``;

    const owner = this.g.owner(this.tile);
    if (!owner || !owner.isPlayer()) {
      this.hide();
      console.warn("Tile is not owned by a player");
      return html``;
    }
    const other = owner as PlayerView;
    // Spectators (replay viewers, dead, or pre-spawn) have no live player; use other as a read-only stand-in
    const viewer = my ?? other;
    const myGoldNum = viewer.gold();
    const myTroopsNum = Number(viewer.troops());

    return html`
      <style>
        .traitor-ring {
          outline: 2px solid rgba(239, 68, 68, 0.6);
          outline-offset: -2px;
        }
      </style>

      <div
        class="fixed inset-0 z-10001 flex items-center justify-center overflow-auto
               bg-black/15 pointer-events-auto"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
        @wheel=${(e: MouseEvent) => e.stopPropagation()}
        @click=${() => this.hide()}
      >
        <div
          class="pointer-events-auto max-h-[90vh] min-w-75 max-w-100 px-4 py-2"
          @click=${(e: MouseEvent) => e.stopPropagation()}
        >
          <div class="relative">
            <div class="absolute inset-2 -z-10 rounded-lg bg-black/25"></div>
            <div
              class=${`relative w-full bg-gray-900 rounded-lg text-gray-100
                 ${other.isTraitor() ? "traitor-ring" : ""}`}
            >
              <div class="overflow-visible">
                <div
                  class="overflow-auto [-webkit-overflow-scrolling:touch] resize-y max-h-[calc(100vh-120px-env(safe-area-inset-bottom))]"
                >
                  <div class="sticky top-0 z-20 flex justify-end p-2">
                    <button
                      @click=${this.handleClose}
                      class="absolute right-3 top-3 z-20 flex h-7 w-7 items-center justify-center rounded-md bg-gray-800 text-white hover:bg-gray-700 transition-colors"
                      aria-label=${translateText("common.close") || "Close"}
                      title=${translateText("common.close") || "Close"}
                    >
                      ${menuIcon("x", "size-4")}
                    </button>
                  </div>

                  <div
                    class="p-6 flex flex-col gap-3 font-sans antialiased text-sm leading-relaxed"
                  >
                    <!-- Identity (flag, name, type, traitor, relation) -->
                    <div class="mb-1">
                      ${this.renderIdentityRow(other, viewer)}
                    </div>

                    <!-- Cosmetics the player has equipped -->
                    <equipped-cosmetics-row
                      .cosmetics=${other.cosmetics}
                    ></equipped-cosmetics-row>

                    ${this.sendTarget && !isSpectator
                      ? html`
                          <send-resource-modal
                            .open=${this.sendMode !== "none"}
                            .mode=${this.sendMode}
                            .total=${this.sendMode === "troops"
                              ? myTroopsNum
                              : myGoldNum}
                            .uiState=${this.uiState}
                            .myPlayer=${viewer}
                            .target=${this.sendTarget}
                            .gameView=${this.g}
                            .eventBus=${this.eventBus}
                            .format=${this.sendMode === "troops"
                              ? renderTroops
                              : renderNumber}
                            @confirm=${this.confirmSend}
                            @close=${this.closeSend}
                          ></send-resource-modal>
                        `
                      : ""}
                    ${this.moderationTarget
                      ? html`
                          <player-moderation-modal
                            .open=${true}
                            .myPlayer=${viewer}
                            .target=${this.moderationTarget}
                            .eventBus=${this.eventBus}
                            .isAdmin=${this.isAdminRole}
                            .alreadyKicked=${this.kickedPlayerIDs.has(
                              String(this.moderationTarget.id()),
                            )}
                            @close=${this.closeModeration}
                            @kicked=${this.handleModerationKicked}
                          ></player-moderation-modal>
                        `
                      : ""}
                    ${this.reportTarget
                      ? html`
                          <player-report-modal
                            .open=${true}
                            .target=${this.reportTarget}
                            .eventBus=${this.eventBus}
                            @close=${this.closeReport}
                          ></player-report-modal>
                        `
                      : ""}

                    <ui-divider></ui-divider>

                    <!-- Resources -->
                    ${this.renderResources(other)}

                    <!-- Rocket direction toggle -->
                    ${other === viewer && !isSpectator
                      ? this.renderRocketDirectionToggle()
                      : ""}

                    <ui-divider></ui-divider>

                    <!-- Stats: betrayals / trading -->
                    ${this.renderStats(other, viewer)}

                    <ui-divider></ui-divider>

                    <!-- Alliances list -->
                    ${this.renderAlliances(other)}

                    <!-- Alliance time remaining -->
                    ${this.renderAllianceExpiry()}
                    ${!isSpectator
                      ? html`
                          <ui-divider></ui-divider>
                          <!-- Actions -->
                          ${this.renderActions(viewer, other)}
                        `
                      : my
                        ? // Dead (or not yet spawned) players still get to
                          // report and, as host/admin, moderate.
                          this.renderModeration(my, other, this.isAdminRole)
                        : ""}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
