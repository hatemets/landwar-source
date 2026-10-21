import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { NavNotificationsController } from "./NavNotificationsController";
import { menuIcon, type MenuIconName } from "./ui/MenuIcon";

@customElement("nav-utility-icons")
export class NavUtilityIcons extends LitElement {
  @property({ type: String }) size: "desktop" | "mobile" = "desktop";
  private notifications = new NavNotificationsController(this);
  createRenderRoot() {
    return this;
  }
  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this.refresh);
  }
  disconnectedCallback() {
    window.removeEventListener("showPage", this.refresh);
    super.disconnectedCallback();
  }
  private refresh = () => this.requestUpdate();
  private item(
    page: string,
    key: string,
    icon: MenuIconName,
    onClick?: () => void,
    unread = false,
  ) {
    return html`<button
      class="nav-menu-item menu-utility-button ${window.currentPageId === page
        ? "active"
        : ""}"
      data-page=${page}
      data-i18n-aria-label=${key}
      data-i18n-title=${key}
      @click=${onClick}
    >
      ${menuIcon(icon)}${unread
        ? html`<span class="menu-notification-dot" aria-hidden="true"></span>`
        : ""}
    </button>`;
  }
  render() {
    return html`<div class="flex items-center gap-1">
      ${this.item("page-leaderboard", "main.leaderboard", "trophy")}${this.item(
        "page-clan",
        "main.clans",
        "users-round",
      )}${this.item(
        "page-news",
        "main.news",
        "bell-ring",
        this.notifications.onNewsClick,
        this.notifications.showNewsDot(),
      )}${this.item(
        "page-help",
        "main.help",
        "circle-help",
        this.notifications.onHelpClick,
        this.notifications.showHelpDot(),
      )}${this.item("page-settings", "main.settings", "sliders-horizontal")}
    </div>`;
  }
}
