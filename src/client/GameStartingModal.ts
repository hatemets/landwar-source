import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./components/ConquestGlobe";
import {
  CONQUEST_NATION_COLORS,
  type ConquestGlobe,
} from "./components/ConquestGlobe";
import { translateText } from "./Utils";

/** Full-screen loading screen shown while a game starts. */
@customElement("game-starting-modal")
export class GameStartingModal extends LitElement {
  @state()
  isVisible = false;

  @state()
  private shares = [0, 0, 0];

  private shareTimer = 0;

  createRenderRoot() {
    return this;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.shareTimer);
  }

  render() {
    const isVisible = this.isVisible;
    return html`
      <div
        class="fixed inset-0 z-[9998] bg-[var(--field-ink)] text-[var(--field-paper)] transition-opacity duration-150 ${isVisible
          ? "opacity-100 visible"
          : "opacity-0 invisible"}"
        role="status"
        aria-live="polite"
      >
        ${isVisible
          ? html`<conquest-globe
              class="absolute inset-0"
              stars
              exclusive
              fill="0.62"
              lift="0.06"
            ></conquest-globe>`
          : nothing}
        <div
          class="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-4 pb-[calc(32px+env(safe-area-inset-bottom,0px))] text-center pointer-events-none"
        >
          <p class="text-xl font-semibold">
            ${translateText("game_starting_modal.title")}
          </p>
          <div
            class="flex h-1 w-60 max-w-full overflow-hidden rounded-sm bg-[var(--field-line)]"
            aria-hidden="true"
          >
            ${this.shares.map(
              (share, i) =>
                html`<span
                  class="block h-full"
                  style="width: ${share *
                  100}%; background: ${CONQUEST_NATION_COLORS[i]}"
                ></span>`,
            )}
          </div>
          <p class="mt-3 text-xs text-[var(--field-faint)] pointer-events-auto">
            ${translateText("main.copyright")} ·
            <a
              href="https://github.com/openfrontio/OpenFrontIO/blob/main/CREDITS.md"
              target="_blank"
              rel="noopener noreferrer"
              class="text-[var(--field-muted)] underline"
              >${translateText("game_starting_modal.credits")}</a
            >
            · ${translateText("game_starting_modal.code_license")}
          </p>
        </div>
      </div>
    `;
  }

  show() {
    this.isVisible = true;
    clearInterval(this.shareTimer);
    this.shareTimer = window.setInterval(() => {
      const globe = this.querySelector<ConquestGlobe>("conquest-globe");
      if (globe) this.shares = globe.shares();
    }, 150);
  }

  hide() {
    this.isVisible = false;
    clearInterval(this.shareTimer);
    this.shares = [0, 0, 0];
  }
}
