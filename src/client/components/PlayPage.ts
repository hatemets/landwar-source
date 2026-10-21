import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { currentSourceCodeUrl } from "../GameVersion";
import { setMenuMap } from "../MenuBackdrop";
import { translateText } from "../Utils";
import "./NavAccountMenu";
import "./NavUtilityIcons";
import { menuIcon } from "./ui/MenuIcon";

@customElement("play-page")
export class PlayPage extends LitElement {
  connectedCallback() {
    super.connectedCallback();
    if (!document.documentElement.style.getPropertyValue("--menu-active-map"))
      setMenuMap(GameMapType.World);
  }

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        id="page-play"
        class="menu-experience"
        style=${`--menu-map-image: url("${assetUrl("images/TerrainMapFrontPage.png")}")`}
      >
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

            <img
              src=${assetUrl("images/LandWarLogoDark.svg")}
              alt="LandWar"
              class="h-5 w-auto shrink-0 lg:h-7 lg:ml-2"
            />

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

        <section class="menu-player-identity" aria-label="Player name">
          <username-input class="block w-full"></username-input>
        </section>

        <game-mode-selector></game-mode-selector>

        <!-- Copyright notice and source link required by the AGPL terms. -->
        <p class="menu-legal mt-2 mb-1 text-center text-[11px] text-white/35">
          ${translateText("main.copyright")} ·
          <a
            href=${currentSourceCodeUrl()}
            target="_blank"
            rel="noopener noreferrer"
            class="text-inherit underline hover:text-white/60"
            >${translateText("main.source_code")}</a
          >
        </p>
      </div>
    `;
  }
}
