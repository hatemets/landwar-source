import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

const STYLE_ID = "plutonium-icon-styles";
if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // Only compositor-animatable properties (transform/opacity) may appear in
  // these keyframes: animating filter/drop-shadow here re-rasterizes every
  // icon each frame and forces the store's backdrop-blur surfaces to redraw,
  // which stutters the whole packs menu (see #4816 follow-up).
  style.textContent = `
    @keyframes plutonium-rotate {
      0%   { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

@customElement("plutonium-icon")
export class PlutoniumIcon extends LitElement {
  @property({ type: Number })
  size: number = 48;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        class="relative inline-flex items-center justify-center"
        style="width:${this.size}px; height:${this.size}px;"
      >
        <img
          src=${assetUrl("images/PlutoniumIcon.svg")}
          alt="Plutonium"
          style="position:relative; width:${this.size}px; height:${this
            .size}px; animation: plutonium-rotate 7s linear infinite; will-change: transform;"
          draggable="false"
        />
      </div>
    `;
  }
}
