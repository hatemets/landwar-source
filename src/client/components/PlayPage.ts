import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { currentSourceCodeUrl } from "../GameVersion";
import { translateText } from "../Utils";

@customElement("play-page")
export class PlayPage extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div id="page-play" class="menu-experience">
        <game-mode-selector></game-mode-selector>

        <!-- Copyright notice and source link required by the AGPL terms. -->
        <footer class="menu-legal text-center text-[11px] text-white/35">
          ${translateText("main.copyright")} ·
          <a
            href=${currentSourceCodeUrl()}
            target="_blank"
            rel="noopener noreferrer"
            class="text-inherit underline hover:text-white/60"
            >${translateText("main.source_code")}</a
          >
          ·
          <a href="/maps" class="text-inherit underline hover:text-white/60"
            >${translateText("main.maps_link")}</a
          >
          ·
          <a
            href="/openfront-alternative"
            class="text-inherit underline hover:text-white/60"
            >${translateText("main.openfront_alternative_link")}</a
          >
        </footer>
      </div>
    `;
  }
}
