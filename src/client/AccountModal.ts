import { PlayerStatsTree, UserMeResponse } from "@openfront/shared/ApiSchemas";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import eyeOffIcon from "lucide-static/icons/eye-off.svg?raw";
import eyeIcon from "lucide-static/icons/eye.svg?raw";
import { ClientEnv } from "src/client/ClientEnv";
import { hasLinkedIdentity } from "./AccountIdentity";
import { fetchPlayerById, getUserMe } from "./Api";
import { linkDiscord, linkGoogle } from "./Auth";
import "./components/baseComponents/stats/PlayerGameHistoryView";
import type { PlayerGameHistoryCache } from "./components/baseComponents/stats/PlayerGameHistoryView";
import "./components/baseComponents/stats/PlayerStatsTable";
import "./components/baseComponents/stats/PlayerStatsTree";
import { BaseModal } from "./components/BaseModal";
import "./components/CopyButton";
import "./components/CurrencyDisplay";
import "./components/Difficulties";
import "./components/FriendsList";
import { googleLinkButton } from "./components/ui/GoogleLinkButton";
import { menuIcon } from "./components/ui/MenuIcon";
import { modalHeader } from "./components/ui/ModalHeader";
import "./GameStatsModal";
import { showInGameAlert } from "./InGameModal";
import { consumeLinkResult } from "./LinkResult";
import "./PlayerProfileModal";
import { playerProfileUrl } from "./utilities/PlayerProfileUrl";
import { UserSettings } from "./UserSettings";
import { currentPagePath, translateText } from "./Utils";

const EMAIL_MASK = "•".repeat(10);

@customElement("account-modal")
export class AccountModal extends BaseModal {
  protected routerName = "account";

  @state() private isLoadingUser: boolean = false;
  // Counts openings, so a slow /users/@me read from an earlier opening can't
  // finish a later one.
  private openCount = 0;
  // The tab a link or caller asked for. BaseModal picks it when the tab is
  // listed at open, but the tabs wait for the account: an opening lists none
  // while it reads /users/@me. Picked once that lands.
  private requestedTab: string | null = null;
  private userMeResponse: UserMeResponse | null = null;
  private userSettings = new UserSettings();
  private statsTree: PlayerStatsTree | null = null;
  // Preserves the Games tab's accumulated list + cursor across tab switches.
  private gameHistoryCache: PlayerGameHistoryCache | null = null;
  private gamesScrollTop = 0;
  private restoreGamesScrollAfterOpen = false;

  constructor() {
    super();

    document.addEventListener("userMeResponse", (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        const previousPublicId = this.userMeResponse?.player?.publicId;
        this.userMeResponse = customEvent.detail as UserMeResponse;
        // Reset whenever the player identity changes (login, or switching to a
        // different account) so stats/history from the previous player don't
        // linger.
        if (this.userMeResponse?.player?.publicId !== previousPublicId) {
          this.resetPlayerData();
          this.requestUpdate();
        }
      } else {
        this.resetPlayerData();
        this.requestUpdate();
      }
    });
  }

  private hasAnyStats(): boolean {
    if (!this.statsTree) return false;
    // Check if statsTree has any data
    return (
      Object.keys(this.statsTree).length > 0 &&
      Object.values(this.statsTree).some(
        (gameTypeStats) =>
          gameTypeStats && Object.keys(gameTypeStats).length > 0,
      )
    );
  }

  protected renderHeaderSlot() {
    const isLoggedIn = !!this.userMeResponse?.user;
    const publicId = this.userMeResponse?.player?.publicId ?? "";
    return modalHeader({
      title: translateText("account_modal.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      rightContent:
        isLoggedIn && !this.isLoadingUser && publicId
          ? html`
              <copy-button
                class="shrink-0"
                .copyText=${playerProfileUrl(publicId)}
                .displayText=${translateText("player_profile.share")}
                .showVisibilityToggle=${false}
              ></copy-button>
            `
          : undefined,
    });
  }

  private isLinkedAccount(): boolean {
    return hasLinkedIdentity(this.userMeResponse?.user);
  }

  protected modalConfig() {
    const appearance = { appearance: "field" as const };
    if (this.isLoadingUser || !this.isLinkedAccount()) {
      return appearance;
    }
    return {
      ...appearance,
      tabs: [
        { key: "account", label: translateText("account_modal.tab_account") },
        { key: "stats", label: translateText("account_modal.tab_stats") },
        { key: "games", label: translateText("account_modal.tab_games") },
        { key: "friends", label: translateText("account_modal.tab_friends") },
      ],
    };
  }

  protected renderBody(tab: string) {
    if (this.isLoadingUser) {
      return this.renderLoadingSpinner(
        translateText("account_modal.fetching_account"),
      );
    }
    if (!this.isLinkedAccount()) return html``;
    return html`
      <div class="custom-scrollbar mr-1">
        <div class="p-6">${this.renderTab(tab)}</div>
      </div>
    `;
  }

  private renderTab(tab: string): TemplateResult {
    switch (tab) {
      case "stats":
        return this.renderStatsTab();
      case "games":
        return this.renderGamesTab();
      case "friends":
        return this.renderFriendsTab();
      default:
        return this.renderAccountTab();
    }
  }

  private renderFriendsTab(): TemplateResult {
    const myPublicId = this.userMeResponse?.player?.publicId ?? "";
    return html`<friends-list
      .myPublicId=${myPublicId}
      @view-profile=${(e: CustomEvent<{ publicId: string }>) =>
        this.openPlayerProfile(e.detail.publicId)}
    ></friends-list>`;
  }

  private openPlayerProfile(publicId: string): void {
    const profileModal = document.querySelector<
      HTMLElement & { openFromAccount(publicId: string): void }
    >("player-profile-modal");
    profileModal?.openFromAccount(publicId);
  }

  public returnToFriends(): void {
    this.open({ tab: "friends" });
  }

  private renderAccountTab(): TemplateResult {
    return html`
      <div class="flex flex-col gap-6">
        ${this.renderPlayerName()}
        <div class="bg-white/5 rounded-xl border border-white/10 p-6">
          <div class="flex flex-col items-center gap-4">
            <div
              class="text-xs text-white/40 uppercase tracking-widest font-bold border-b border-white/5 pb-2 px-8"
            >
              ${translateText("account_modal.connected_as")}
            </div>
            <div class="flex items-center gap-8 justify-center flex-wrap">
              ${this.renderLoggedInAs()}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderStatsTab(): TemplateResult {
    return html`
      ${this.hasAnyStats()
        ? html`<player-stats-tree-view
            .statsTree=${this.statsTree}
          ></player-stats-tree-view>`
        : this.renderEmptyState(
            menuIcon("chart-column", "size-10"),
            translateText("account_modal.no_stats"),
          )}
    `;
  }

  private renderGamesTab(): TemplateResult {
    const publicId = this.userMeResponse?.player?.publicId ?? "";
    if (!publicId) {
      return this.renderEmptyState(
        menuIcon("gamepad-2", "size-10"),
        translateText("account_modal.no_games"),
      );
    }
    return html`
      <player-game-history-view
        .publicId=${publicId}
        .cachedState=${this.gameHistoryCache?.publicId === publicId
          ? this.gameHistoryCache
          : null}
        @history-updated=${(e: CustomEvent<PlayerGameHistoryCache>) => {
          this.gameHistoryCache = e.detail;
        }}
        @view-stats=${(e: CustomEvent<{ gameId: string }>) =>
          this.openGameStats(e.detail.gameId)}
        @view-game=${(e: CustomEvent<{ gameId: string }>) =>
          void this.viewGame(e.detail.gameId)}
      ></player-game-history-view>
    `;
  }

  private renderEmptyState(
    icon: TemplateResult,
    message: string,
  ): TemplateResult {
    return html`
      <div
        class="bg-white/5 rounded-xl border border-white/10 p-12 flex flex-col items-center justify-center text-center"
      >
        <div class="mb-3 text-white/40">${icon}</div>
        <p class="text-white/60 text-sm">${message}</p>
      </div>
    `;
  }

  private renderCurrency(): TemplateResult {
    const currency = this.userMeResponse?.player?.currency;
    if (!currency) return html``;

    return html`
      <currency-display
        .hard=${currency.hard}
        .soft=${currency.soft}
      ></currency-display>
    `;
  }

  // The name other players see, with the way to change it. A Google sign-in
  // seeds it with the real name.
  private renderPlayerName(): TemplateResult {
    const username = this.userMeResponse?.player?.username;
    if (!username) return html``;
    return html`
      <div
        class="bg-white/5 rounded-xl border border-white/10 p-6 flex items-center justify-between gap-4 flex-wrap"
      >
        <div class="flex flex-col gap-1 min-w-0">
          <div
            class="text-xs text-white/40 uppercase tracking-widest font-bold"
          >
            ${translateText("account_modal.player_name")}
          </div>
          <div
            class="text-white text-lg font-medium truncate"
            data-account-username
          >
            ${username}
          </div>
        </div>
        <button
          type="button"
          class="shrink-0 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
          @click=${() => {
            window.location.hash = "modal=change-username";
          }}
        >
          ${translateText("nav_account_menu.change_username")}
        </button>
      </div>
    `;
  }

  private toggleEmailVisible = () => {
    this.userSettings.setAccountEmailVisible(
      !this.userSettings.accountEmailVisible(),
    );
    this.requestUpdate();
  };

  // The email as shown: masked unless the player chose to reveal it.
  private shownEmail(email: string): string {
    return this.userSettings.accountEmailVisible() ? email : EMAIL_MASK;
  }

  private renderEmailToggle(): TemplateResult {
    const visible = this.userSettings.accountEmailVisible();
    const label = translateText(
      visible ? "account_modal.hide_email" : "account_modal.show_email",
    );
    return html`
      <button
        type="button"
        class="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
        title=${label}
        aria-label=${label}
        aria-pressed=${visible ? "true" : "false"}
        @click=${this.toggleEmailVisible}
      >
        <span class="lw-icon w-4 h-4" aria-hidden="true"
          >${unsafeSVG(visible ? eyeOffIcon : eyeIcon)}</span
        >
      </button>
    `;
  }

  private renderLoggedInAs(): TemplateResult {
    const me = this.userMeResponse?.user;
    const accountName = me?.google?.email ?? me?.email;
    if (!accountName) return html``;
    return html`
      <div class="flex flex-col items-center gap-3 w-full">
        <div class="flex items-center gap-2 text-white text-lg font-medium">
          <span data-account-email
            >${translateText("account_modal.linked_account", {
              account_name: this.shownEmail(accountName),
            })}</span
          >
          ${this.renderEmailToggle()}
        </div>
        ${this.renderCurrency()} ${this.renderGoogleLink()}
        ${this.renderDiscordLink()}
      </div>
    `;
  }

  // Show the Google link state: a confirmation line when a Google account is
  // already linked, otherwise the button to link one.
  private renderGoogleLink(): TemplateResult {
    const google = this.userMeResponse?.user?.google;
    if (google) {
      const label = google.email
        ? translateText("account_modal.linked_to_google_email", {
            email: this.shownEmail(google.email),
          })
        : translateText("account_modal.linked_to_google");
      return html`
        <div class="flex items-center gap-2 text-white/70 text-sm">
          <img
            src=${assetUrl("images/GoogleLogo.svg")}
            alt=${translateText("account_modal.google_alt")}
            class="w-4 h-4"
          />
          <span>${label}</span>
        </div>
      `;
    }
    // Lets the user attach Google to their existing account. The server also
    // joins a sign-in whose verified email matches the account.
    return googleLinkButton(this.handleLinkGoogle, "account_modal.link_google");
  }

  // The same for Discord: a confirmation line, or the button to link it.
  private renderDiscordLink(): TemplateResult {
    if (this.userMeResponse?.user?.discord) {
      return html`
        <div class="flex items-center gap-2 text-white/70 text-sm">
          <img
            src=${assetUrl("images/DiscordLogo.svg")}
            alt=${translateText("account_modal.discord_alt")}
            class="w-4 h-4"
          />
          <span>${translateText("account_modal.linked_to_discord")}</span>
        </div>
      `;
    }
    return html`
      <button
        @click=${this.handleLinkDiscord}
        class="w-full px-6 py-3 text-white bg-[#5865F2] hover:bg-[#4752C4] rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#5865F2] transition-colors duration-200 flex items-center justify-center gap-3 shadow-lg"
      >
        <img
          src=${assetUrl("images/DiscordLogo.svg")}
          alt=${translateText("account_modal.discord_alt")}
          class="w-5 h-5"
        />
        <span class="font-bold tracking-wide"
          >${translateText("account_modal.link_discord")}</span
        >
      </button>
    `;
  }

  private async viewGame(gameId: string): Promise<void> {
    this.close();
    const encodedGameId = encodeURIComponent(gameId);
    const newUrl = currentPagePath(ClientEnv.gamePath(gameId));

    history.pushState({ join: gameId }, "", newUrl);
    window.dispatchEvent(
      new CustomEvent("join-changed", { detail: { gameId: encodedGameId } }),
    );
  }

  private openGameStats(gameId: string): void {
    this.gamesScrollTop = this.modalEl?.getScrollTop() ?? 0;
    const statsModal = document.querySelector<
      HTMLElement & { openFromAccount(gameId: string): void }
    >("game-stats-modal");
    statsModal?.openFromAccount(gameId);
  }

  public returnToGames(): void {
    this.restoreGamesScrollAfterOpen = true;
    this.open({ tab: "games" });
  }

  private async restoreGamesScroll(): Promise<void> {
    await this.updateComplete;
    await this.modalEl?.updateComplete;
    const historyView = this.querySelector<
      HTMLElement & { updateComplete?: Promise<boolean> }
    >("player-game-history-view");
    await historyView?.updateComplete;
    this.modalEl?.setScrollTop(this.gamesScrollTop);
  }

  private finishLoadingUser(opening: number): void {
    if (opening !== this.openCount) return;
    this.isLoadingUser = false;
    this.requestUpdate();
    // Signing in has a page of its own: a visitor with no account goes there.
    if (!this.isLinkedAccount() && this.isOpen()) {
      this.close();
      window.showPage?.("page-signin");
      return;
    }
    // The tabs are listed now: pick the one asked for. The modal can have been
    // closed meanwhile; the tab is then left for the next opening to decide.
    const tab = this.requestedTab;
    this.requestedTab = null;
    if (tab !== null && this.isOpen()) this.setActiveTab(tab);
    if (this.restoreGamesScrollAfterOpen) {
      this.restoreGamesScrollAfterOpen = false;
      void this.restoreGamesScroll();
    }
  }

  private resetPlayerData(): void {
    this.statsTree = null;
    this.gameHistoryCache = null;
    this.gamesScrollTop = 0;
    this.restoreGamesScrollAfterOpen = false;
  }

  private handleLinkGoogle = async (): Promise<void> => {
    // On success linkGoogle navigates to Google; the result comes back as a
    // `link=...` router arg handled by consumeLinkResult. A false return
    // means we couldn't start it.
    const started = await linkGoogle();
    if (!started) {
      await showInGameAlert(translateText("account_modal.link_google_failed"));
    }
  };

  private handleLinkDiscord = async (): Promise<void> => {
    const started = await linkDiscord();
    if (!started) {
      await showInGameAlert(translateText("account_modal.link_discord_failed"));
    }
  };

  protected onOpen(args?: Record<string, unknown>): void {
    const opening = ++this.openCount;
    this.isLoadingUser = true;
    this.requestedTab = typeof args?.tab === "string" ? args.tab : null;
    consumeLinkResult(args);

    void getUserMe()
      .then((userMe) => {
        if (userMe) {
          this.userMeResponse = userMe;
          if (this.userMeResponse?.player?.publicId) {
            this.loadPlayerProfile(this.userMeResponse.player.publicId);
          }
        }
        this.finishLoadingUser(opening);
      })
      .catch((err) => {
        console.warn("Failed to fetch user info in AccountModal.open():", err);
        this.finishLoadingUser(opening);
      });
    this.requestUpdate();
  }

  protected onClose(): void {
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  }

  private async loadPlayerProfile(publicId: string): Promise<void> {
    try {
      const data = await fetchPlayerById(publicId);
      if (!data) {
        this.requestUpdate();
        return;
      }

      this.statsTree = data.stats;

      this.requestUpdate();
    } catch (err) {
      console.warn("Failed to load player data:", err);
      this.requestUpdate();
    }
  }
}
