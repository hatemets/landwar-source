import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("setting-slider")
export class SettingSlider extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  // Graphics options tune fractional values (opacities, scale factors), which
  // a whole-number slider cannot express.
  @property({ type: Number }) step = 1;
  @property({ type: Boolean }) easter = false;
  @property() unit = "%";
  @property({ attribute: false }) formatValue?: (value: number) => string;

  createRenderRoot() {
    return this;
  }

  private handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.value = Number(input.value);
    this.updateSliderStyle(input);

    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private updateSliderStyle(slider: HTMLInputElement) {
    const percent = ((this.value - this.min) / (this.max - this.min)) * 100;
    const clamped = Math.max(0, Math.min(100, percent));
    slider.style.setProperty("--fill", `${clamped}%`);
  }

  /**
   * The filled part of the track is a CSS custom property, which `handleInput`
   * sets during a drag. Setting `.value` from outside — "Reset to defaults",
   * or reopening the tab — moves the thumb but left the fill where it was.
   */
  protected updated(changed: PropertyValues) {
    if (!changed.has("value") && !changed.has("min") && !changed.has("max")) {
      return;
    }
    const slider = this.renderRoot.querySelector(
      "input[type=range]",
    ) as HTMLInputElement | null;
    if (slider) this.updateSliderStyle(slider);
  }

  firstUpdated() {
    const slider = this.renderRoot.querySelector(
      "input[type=range]",
    ) as HTMLInputElement;
    if (slider) this.updateSliderStyle(slider);
  }

  render() {
    const rainbowClass = this.easter
      ? "bg-[linear-gradient(270deg,#990033,#996600,#336600,#008080,#1c3f99,#5e0099,#990033)] bg-[length:1400%_1400%] animate-rainbow-bg text-white hover:bg-[linear-gradient(270deg,#990033,#996600,#336600,#008080,#1c3f99,#5e0099,#990033)]"
      : "";

    return html`
      <div
        class="flex flex-col w-full px-3 py-2 gap-1 rounded-lg transition-colors duration-150 ${rainbowClass}"
      >
        <div class="flex items-center gap-2 min-h-6">
          <label class="flex-1 min-w-0 text-white text-sm font-medium"
            >${this.label}</label
          >
          <span
            class="shrink-0 min-w-[3ch] text-right text-sm font-medium tabular-nums text-white"
            >${this.formatValue
              ? this.formatValue(this.value)
              : `${this.value}${this.unit}`}</span
          >
        </div>
        ${this.description
          ? html`<div class="text-white/50 text-xs leading-snug">
              ${this.description}
            </div>`
          : null}
        <input
          type="range"
          class="lw-range"
          aria-label=${this.label}
          min=${this.min}
          max=${this.max}
          step=${this.step}
          .value=${String(this.value)}
          @input=${this.handleInput}
        />
      </div>
    `;
  }
}
