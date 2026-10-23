import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { menuIcon, type MenuIconName } from "./ui/MenuIcon";

@customElement("nav-utility-icons")
export class NavUtilityIcons extends LitElement {
  @property({ type: String }) size: "desktop" | "mobile" = "desktop";
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
  private item(page: string, key: string, icon: MenuIconName) {
    return html`<button
      class="nav-menu-item menu-utility-button ${window.currentPageId === page
        ? "active"
        : ""}"
      data-page=${page}
      data-i18n-aria-label=${key}
      data-i18n-title=${key}
    >
      ${menuIcon(icon)}
    </button>`;
  }
  render() {
    return html`<div class="flex items-center gap-1">
      ${this.item("page-leaderboard", "main.leaderboard", "trophy")}${this.item(
        "page-settings",
        "main.settings",
        "settings",
      )}
    </div>`;
  }
}
