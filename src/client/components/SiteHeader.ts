import { assetUrl } from "@openfront/shared/AssetUrls";
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { translateText } from "../Utils";
import "./NavAccountMenu";
import "./NavUtilityIcons";
import { menuIcon } from "./ui/MenuIcon";

/**
 * The top navigation bar. It sits outside every page, so it stays in place
 * while the player moves between the home page, settings, the leaderboard and
 * the rest.
 */
@customElement("site-header")
export class SiteHeader extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <!-- Fixed on phones; in the page flow on desktop. -->
      <header class="menu-topbar">
        <div class="menu-topbar__inner">
          <button
            id="hamburger-btn"
            class="lg:hidden shrink-0 size-9 flex items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10"
            data-i18n-aria-label="main.menu"
            aria-expanded="false"
            aria-controls="sidebar-menu"
            aria-haspopup="dialog"
            data-i18n-title="main.menu"
          >
            ${menuIcon("menu")}
          </button>

          <a
            href="/"
            class="nav-menu-item shrink-0"
            data-page="page-play"
            @click=${(e: Event) => e.preventDefault()}
          >
            <span class="menu-brand lg:ml-2">
              <img src=${assetUrl("images/CleoLogo.svg")} alt="" />
              <span class="menu-brand__name">cleo</span>
            </span>
          </a>

          <!-- Utilities, account, and language stay available on every page. -->
          <div class="menu-topbar__actions">
            <nav-utility-icons
              class="menu-utility-desktop"
              size="desktop"
            ></nav-utility-icons>
            <details class="menu-mobile-more lg:hidden">
              <summary aria-label=${translateText("main.menu")}>
                ${menuIcon("ellipsis")}
              </summary>
              <div class="menu-mobile-more__panel">
                <nav-utility-icons size="mobile"></nav-utility-icons>
              </div>
            </details>
            <nav-account-menu
              variant="mobile"
              class="lg:hidden"
            ></nav-account-menu>
            <nav-account-menu
              variant="desktop"
              class="hidden lg:block"
            ></nav-account-menu>
            <lang-selector></lang-selector>
          </div>
        </div>
      </header>

      <!-- Keeps page content below the fixed full-width header. -->
      <div class="menu-topbar-spacer"></div>
    `;
  }
}
