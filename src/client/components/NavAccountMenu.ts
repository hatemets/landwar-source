import { UserMeResponse } from "@openfront/shared/ApiSchemas";
import {
  html,
  LitElement,
  nothing,
  PropertyValues,
  render,
  TemplateResult,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { hasLinkedIdentity } from "../AccountIdentity";
import { logOut } from "../Auth";
import { showInGameConfirm } from "../InGameModal";
import {
  latestUserMeResponse,
  updateAccountNavButton,
} from "../NavAccountButton";
import { closeMobileSidebar } from "../Navigation";
import { playerProfileUrl } from "../utilities/PlayerProfileUrl";
import { copyToClipboard, showToast, translateText } from "../Utils";
import { menuIcon } from "./ui/MenuIcon";

type MenuItem = {
  key: string;
  labelKey: string;
  icon: TemplateResult;
  onSelect: () => void;
  danger?: boolean;
};

/**
 * The nav profile control: the account avatar/sign-in trigger plus, once signed
 * in, a chevron that opens the account menu (username, log out). Game settings are a top-level nav item, not a menu
 * entry.
 *
 * The trigger keeps `nav-menu-item[data-page="page-account"]`, so the signed-out
 * state still falls through to Navigation's delegated router and opens the
 * account modal. Signed in, the click is intercepted here and toggles the menu
 * instead.
 *
 * `variant="desktop"` also carries the legacy element ids the imperative
 * updaters (NavAccountButton) drive; every instance
 * additionally exposes `data-account-*` hooks so both trigger layouts stay in
 * sync from one update call.
 */
@customElement("nav-account-menu")
export class NavAccountMenu extends LitElement {
  @property({ type: String }) variant: "desktop" | "mobile" = "desktop";

  @state() private menuOpen = false;
  @state() private userMeResponse: UserMeResponse | false = false;

  // The panel is rendered into document.body, not into the nav: the nav bar
  // owns a stacking context, so anything inside it can be painted under the
  // page's overlays (modals) or paint over ones that should win (toasts).
  private panel: HTMLDivElement | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
    document.addEventListener("click", this.handleDocumentClick);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("showPage", this.closeMenu);
    // The panel is positioned from the trigger's box, so a resize would leave
    // it stranded — close instead of tracking.
    window.addEventListener("resize", this.closeMenu);

    // Auth resolves once, early. A menu created after that (a re-rendered play
    // page, a reconnected element) would otherwise sit on its initial
    // signed-out state forever, so seed from the cached response instead.

    const cached = latestUserMeResponse();
    if (cached !== null) {
      this.userMeResponse = cached;
      // The trigger's avatar/badge state is imperative, so re-apply it to this
      // instance's freshly-rendered markup too.
      void this.updateComplete.then(() => updateAccountNavButton(cached));
    }
  }

  disconnectedCallback() {
    document.removeEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
    document.removeEventListener("click", this.handleDocumentClick);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("showPage", this.closeMenu);
    window.removeEventListener("resize", this.closeMenu);
    this.removePanel();
    super.disconnectedCallback();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("userMeResponse") && this.isSignedIn())
      updateAccountNavButton(this.userMeResponse);
    if (!this.menuOpen) {
      this.removePanel();
      return;
    }
    const trigger = this.querySelector<HTMLElement>("[data-account-trigger]");
    if (!trigger) return;

    if (this.panel === null) {
      this.panel = document.createElement("div");
      this.panel.style.position = "fixed";
      this.panel.style.zIndex = "41000";
      document.body.appendChild(this.panel);
    }
    const rect = trigger.getBoundingClientRect();
    this.panel.style.top = `${rect.bottom + 8}px`;
    this.panel.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    render(this.renderMenu(), this.panel);
  }

  private removePanel(): void {
    if (this.panel === null) return;
    render(nothing, this.panel);
    this.panel.remove();
    this.panel = null;
  }

  private handleUserMeResponse = (
    event: CustomEvent<UserMeResponse | false>,
  ) => {
    this.userMeResponse = event.detail;
  };

  /**
   * Signed in for menu purposes. An anonymous session still resolves to a
   * UserMeResponse, so a linked identity is what counts.
   */
  private isSignedIn(): boolean {
    if (this.userMeResponse === false) return false;
    return hasLinkedIdentity(this.userMeResponse.user);
  }

  private closeMenu = () => {
    this.menuOpen = false;
  };

  private handleDocumentClick = (e: MouseEvent) => {
    if (!this.menuOpen) return;
    const path = e.composedPath();
    if (path.includes(this)) return;
    if (this.panel !== null && path.includes(this.panel)) return;
    this.menuOpen = false;
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.menuOpen) {
      this.menuOpen = false;
    }
  };

  private handleTriggerClick = (e: MouseEvent) => {
    // The menu is the account affordance in every state, so the delegated nav
    // router never gets this click — the "View account" / "Sign in" items open
    // the modal instead.
    e.preventDefault();
    e.stopPropagation();
    this.menuOpen = !this.menuOpen;
  };

  private items(): MenuItem[] {
    // Signed out there is only the sign-in route for this platform: settings
    // are reached from the navbar, in every signed-in state and out of it.
    if (!this.isSignedIn()) {
      return [
        {
          key: "sign-in",
          labelKey: "main.sign_in",
          icon: iconUser,
          onSelect: () => this.signIn(),
        },
      ];
    }

    const player =
      this.userMeResponse === false ? null : this.userMeResponse.player;
    const publicId = player?.publicId ?? "";

    const items: MenuItem[] = [];

    // Nothing to share without a publicId (older backend, or a session whose
    // player record hasn't resolved).
    if (publicId) {
      items.push({
        key: "copy-profile-url",
        labelKey: "nav_account_menu.copy_profile_url",
        icon: iconShare,
        onSelect: () => void this.copyProfileUrl(publicId),
      });
    }

    items.push(
      {
        key: "view-account",
        labelKey: "nav_account_menu.view_account",
        icon: iconUser,
        onSelect: () => {
          window.showPage?.("page-account");
        },
      },
      {
        key: "change-username",
        labelKey: "nav_account_menu.change_username",
        icon: iconTag,
        onSelect: () => this.openModal("change-username"),
      },
    );

    items.push({
      key: "log-out",
      labelKey: "nav_account_menu.log_out",
      icon: iconLogOut,
      onSelect: () => void this.handleLogOut(),
      danger: true,
    });

    return items;
  }

  private signIn(): void {
    window.showPage?.("page-account");
  }

  // Same copy + toast the account modal's share button gives.
  private async copyProfileUrl(publicId: string): Promise<void> {
    try {
      await copyToClipboard(playerProfileUrl(publicId));
      showToast(translateText("common.copied"), "green");
    } catch {
      showToast(translateText("common.failed_copy"), "red");
    }
  }

  // The profile-menu modals are popup (non-inline) modals registered with the
  // router, so the hash is what opens them.
  private openModal(name: string): void {
    window.location.hash = `modal=${name}`;
  }

  private async handleLogOut(): Promise<void> {
    const confirmed = await showInGameConfirm(
      translateText("nav_account_menu.log_out_confirm"),
      {
        heading: translateText("nav_account_menu.log_out"),
        confirmText: translateText("nav_account_menu.log_out"),
      },
    );
    if (!confirmed) return;
    await logOut();
    // Reload so every consumer of the session starts from a signed-out state.
    window.location.reload();
  }

  private selectItem(item: MenuItem): void {
    this.menuOpen = false;
    closeMobileSidebar();
    item.onSelect();
  }

  render(): TemplateResult {
    if (!this.isSignedIn()) {
      return html`<div class="menu-auth-actions">
        <button
          type="button"
          class="menu-auth-signin"
          @click=${() => this.openAuth("signin")}
        >
          ${translateText("main.sign_in")}</button
        ><button
          type="button"
          class="menu-auth-signup"
          @click=${() => this.openAuth("signup")}
        >
          ${translateText("main.sign_up")}
        </button>
      </div>`;
    }
    return html`
      <div class="relative" data-account-nav>
        ${this.variant === "mobile"
          ? this.renderMobileTrigger()
          : this.renderDesktopTrigger()}
      </div>
    `;
  }

  private openAuth(intent: "signin" | "signup") {
    closeMobileSidebar();
    window.location.hash = `modal=account&intent=${intent}`;
  }

  private renderMenu(): TemplateResult {
    return html`
      <!-- No vertical padding on the panel: items run edge to edge so a hovered
           row (the red Log out especially) fills the corner instead of leaving
           a dead strip under it. overflow-hidden clips them to the radius.

           Width grows to the longest label (translations run longer than the
           English) up to a cap, past which labels wrap instead of pushing the
           panel off-screen — the cap also tracks the viewport for narrow
           phones. -->
      <div
        role="menu"
        aria-label=${translateText("nav_account_menu.title")}
        class="w-max min-w-60 max-w-[min(20rem,calc(100vw-1rem))] rounded-xl border border-white/10 bg-zinc-900 shadow-xl overflow-hidden"
      >
        ${this.items().map(
          (item) => html`
            <button
              role="menuitem"
              data-menu-item=${item.key}
              @click=${() => this.selectItem(item)}
              class="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium normal-case tracking-normal cursor-pointer transition-colors ${item.danger
                ? "text-red-400 hover:bg-red-500/10 border-t border-white/10"
                : "text-white/80 hover:bg-white/10 hover:text-white"}"
            >
              <span class="w-4 h-4 shrink-0">${item.icon}</span>
              <span class="min-w-0 break-words"
                >${translateText(item.labelKey)}</span
              >
            </button>
          `,
        )}
      </div>
    `;
  }

  private renderChevron(): TemplateResult {
    return menuIcon("chevron-down", this.menuOpen ? "rotate-180" : "");
  }

  // Avatar / spinner / person icon / email badge, shared by both triggers.
  // `ids` is populated for the desktop instance only — NavAccountButton and
  // PortalAccountButton drive that one by id — while the data-account-*
  // hooks are what both instances are updated through.
  private renderIdentityIcons(opts: {
    ids: boolean;
    iconClass: string;
    badgeClass: string;
  }): TemplateResult {
    const id = (name: string) => (opts.ids ? name : undefined);
    return html`
      <img
        id=${ifDefined(id("nav-account-avatar"))}
        data-account-avatar
        class="hidden w-8 h-8 rounded-full object-cover"
        alt=""
        data-i18n-alt="main.discord_avatar_alt"
        referrerpolicy="no-referrer"
      />
      <span
        id=${ifDefined(id("nav-account-loading-spinner"))}
        data-account-spinner
        class="w-4 h-4 border-2 border-white/30 border-t-white/80 rounded-full animate-spin"
        aria-hidden="true"
      ></span>
      <span
        id=${ifDefined(id("nav-account-person-icon"))}
        data-account-person-icon
        class="hidden ${opts.iconClass}"
        >${menuIcon("user-round")}</span
      >
      <span
        id=${ifDefined(id("nav-account-email-badge"))}
        data-account-email-badge
        class="hidden ${opts.badgeClass} w-4 h-4 rounded-full bg-slate-900/80 border border-white/20 flex items-center justify-center"
        aria-hidden="true"
      >
        <svg
          class="w-2.5 h-2.5 text-white/80"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 6h16v12H4z" />
          <path d="m4 7 8 6 8-6" />
        </svg>
      </span>
    `;
  }

  // Desktop nav pill. Ids are load-bearing: NavAccountButton and
  // PortalAccountButton drive this instance by id.
  private renderDesktopTrigger(): TemplateResult {
    return html`
      <button
        id="nav-account-button"
        data-account-trigger
        data-account-border
        aria-haspopup="menu"
        aria-expanded=${this.menuOpen ? "true" : "false"}
        @click=${this.handleTriggerClick}
        class="nav-menu-item relative h-10 rounded-full flex items-center justify-center gap-2 px-3 bg-transparent border border-white/20 text-white/80 hover:text-white cursor-pointer transition-colors [&.active]:text-white"
        data-page="page-account"
        aria-label=${translateText("main.account")}
        data-i18n-title="main.account"
      >
        <!-- The avatar and icons inside are driven imperatively by
             NavAccountButton and must not be re-created. -->
        <span data-account-identity class="relative flex items-center gap-2">
          ${this.renderIdentityIcons({
            ids: true,
            iconClass: "w-5 h-5",
            badgeClass: "absolute -top-1 -right-1.5",
          })}
        </span>
        <span
          id="nav-account-signin-text"
          data-account-signin-text
          class="hidden text-xs font-bold tracking-widest"
          data-i18n="main.sign_in"
        >
        </span>
        ${this.renderChevron()}
      </button>
    `;
  }

  // Mobile top-bar trigger: avatar or person icon only, plus the chevron.
  private renderMobileTrigger(): TemplateResult {
    return html`
      <button
        data-account-trigger
        aria-haspopup="menu"
        aria-expanded=${this.menuOpen ? "true" : "false"}
        @click=${this.handleTriggerClick}
        class="nav-menu-item h-10 flex items-center justify-center gap-1 pl-1 pr-1.5 rounded-full text-white/90 cursor-pointer transition-colors"
        data-page="page-account"
        aria-label=${translateText("main.account")}
        data-i18n-title="main.account"
      >
        <span class="relative flex items-center justify-center w-8 h-8">
          ${this.renderIdentityIcons({
            ids: false,
            iconClass: "w-7 h-7",
            badgeClass: "absolute -bottom-0.5 -right-0.5",
          })}
        </span>
        <!-- The sign-in label is desktop-only; on the top bar the icon alone is
             the affordance, so keep the element (the shared updater toggles it)
             but never show text. -->
        <span data-account-signin-text class="hidden"></span>
        ${this.renderChevron()}
      </button>
    `;
  }
}

const iconShare = menuIcon("share-2");
const iconUser = menuIcon("user-round");
const iconTag = menuIcon("tag");
const iconLogOut = menuIcon("log-out");
