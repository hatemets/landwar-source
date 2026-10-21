import { PlayerStatsTree, UserMeResponse } from "@openfront/shared/ApiSchemas";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import { hasLinkedIdentity } from "./AccountIdentity";
import { fetchPlayerById, getUserMe } from "./Api";
import { googleLogin, linkGoogle } from "./Auth";
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
import { modalHeader } from "./components/ui/ModalHeader";
import "./GameStatsModal";
import { showInGameAlert } from "./InGameModal";
import { consumeLinkResult } from "./LinkResult";
import { consumeLoginResult, LoginResult } from "./LoginResult";
import "./PlayerProfileModal";
import { playerProfileUrl } from "./utilities/PlayerProfileUrl";
import { currentPagePath, translateText } from "./Utils";

// Each login refusal says its own thing. A player refused because their
// account is pending deletion must not be told their email is already in use.
const LOGIN_ERROR_KEYS: Record<LoginResult, string> = {
  email_exists: "account_modal.login_email_exists",
  deleted: "account_modal.login_deleted",
  error: "account_modal.login_error",
  no_account: "account_modal.login_no_account",
};

@customElement("account-modal")
export class AccountModal extends BaseModal {
  protected routerName = "account";

  @state() private authIntent: "signin" | "signup" = "signin";
  @state() private isLoadingUser: boolean = false;
  // Counts openings, so a slow /users/@me read from an earlier opening can't
  // finish a later one.
  private openCount = 0;
  // The tab a link or caller asked for. BaseModal picks it when the tab is
  // listed at open, but the tabs wait for the account: an opening lists none
  // while it reads /users/@me. Picked once that lands.
  private requestedTab: string | null = null;
  // One-shot outcome of a rejected sign-in, read from the `login=` router
  // arg on open. Reassigned on every open, so reopening clears it.
  @state() private loginError: LoginResult | undefined;

  private userMeResponse: UserMeResponse | null = null;
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
    const isAuthView = !this.isLinkedAccount();
    const publicId = this.userMeResponse?.player?.publicId ?? "";
    return modalHeader({
      title: translateText(
        isAuthView
          ? this.authIntent === "signup"
            ? "main.sign_up"
            : "main.sign_in"
          : "account_modal.title",
      ),
      titleClassName: "field-modal-title",
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
    if (!this.isLinkedAccount()) {
      return html`<div class="custom-scrollbar mr-1">
        ${this.renderLoginOptions()}
      </div>`;
    }
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
        : this.renderEmptyState("📊", translateText("account_modal.no_stats"))}
    `;
  }

  private renderGamesTab(): TemplateResult {
    const publicId = this.userMeResponse?.player?.publicId ?? "";
    if (!publicId) {
      return this.renderEmptyState(
        "🎮",
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

  private renderEmptyState(icon: string, message: string): TemplateResult {
    return html`
      <div
        class="bg-white/5 rounded-xl border border-white/10 p-12 flex flex-col items-center justify-center text-center"
      >
        <div class="text-4xl mb-3">${icon}</div>
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

  private renderLoggedInAs(): TemplateResult {
    const me = this.userMeResponse?.user;
    const accountName = me?.google?.email ?? me?.email;
    if (!accountName) return html``;
    return html`
      <div class="flex flex-col items-center gap-3 w-full">
        <div class="text-white text-lg font-medium">
          ${translateText("account_modal.linked_account", {
            account_name: accountName,
          })}
        </div>
        ${this.renderCurrency()} ${this.renderGoogleLink()}
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
            email: google.email,
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
    // Lets the user attach Google to their existing account (we never
    // auto-merge by email).
    return googleLinkButton(this.handleLinkGoogle, "account_modal.link_google");
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

  // Shown when a sign-in was rejected because the provider's verified email
  // already belongs to an account. We deliberately don't name which provider
  // that account uses — the visitor has only proven control of the email.
  private renderLoginError(): TemplateResult {
    if (this.loginError === undefined) return html``;
    return html`
      <div
        class="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4"
      >
        <span class="text-red-400 text-lg leading-none" aria-hidden="true">
          &#9888;
        </span>
        <p class="flex-1 text-sm text-red-200">
          ${translateText(LOGIN_ERROR_KEYS[this.loginError])}
        </p>
        <button
          class="text-red-200/60 hover:text-red-200 text-lg leading-none"
          aria-label=${translateText("common.close")}
          @click=${() => (this.loginError = undefined)}
        >
          &times;
        </button>
      </div>
    `;
  }

  private renderLoginOptions() {
    // Google is the only sign-in provider configured by LandWar's backend.
    return html`
      <div class="auth-experience">
        <div class="auth-form-column">
          <div class="auth-heading">
            <p class="auth-description">
              ${translateText(
                this.authIntent === "signup"
                  ? "account_modal.sign_up_desc"
                  : "account_modal.sign_in_desc",
              )}
            </p>
            ${this.renderCurrency()}
          </div>

          ${this.renderLoginError()}

          <div class="auth-options">
            <!-- Google Login Button (Google brand guidelines: white surface,
                 dark text, the multicolor "G" mark) -->
            <button
              @click="${this.handleGoogleLogin}"
              class="auth-provider-button auth-provider-google w-full px-6 py-4 text-[#1f1f1f] bg-white hover:bg-[#f7f8f8] border border-[#dadce0] rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#4285F4] transition-colors duration-200 flex items-center justify-center gap-3 group relative overflow-hidden shadow-lg"
            >
              <img
                src=${assetUrl("images/GoogleLogo.svg")}
                alt=${translateText("account_modal.google_alt")}
                class="w-6 h-6 relative z-10"
              />
              <span class="font-bold relative z-10 tracking-wide"
                >${translateText("main.login_google")}</span
              >
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private handleGoogleLogin() {
    googleLogin();
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

  protected onOpen(args?: Record<string, unknown>): void {
    this.authIntent = args?.intent === "signup" ? "signup" : "signin";
    const opening = ++this.openCount;
    this.isLoadingUser = true;
    this.requestedTab = typeof args?.tab === "string" ? args.tab : null;
    consumeLinkResult(args);
    this.loginError = consumeLoginResult(args);

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
