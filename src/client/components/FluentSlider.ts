import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { translateText } from "../Utils";

@customElement("fluent-slider")
export class FluentSlider extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 400;
  @property({ type: Number }) step = 1;
  @property({ type: String }) labelKey = "";
  @property({ type: String }) disabledKey = "";
  @property({ type: Number }) defaultValue: number | undefined = undefined;
  @property({ type: String }) defaultLabelKey = "";

  @state() private isEditing = false;

  @query("input[type='number']") private numberInput!: HTMLInputElement;

  private dispatchValueChange() {
    this.dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleSliderInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.value = target.valueAsNumber;
  }

  private handleSliderChange(e: Event) {
    const target = e.target as HTMLInputElement;
    this.value = target.valueAsNumber;
    this.dispatchValueChange();
  }

  private handleNumberInput(e: Event) {
    const target = e.target as HTMLInputElement;
    let val = target.valueAsNumber;
    if (isNaN(val)) {
      val = this.min;
    }
    if (val < this.min) val = this.min;
    if (val > this.max) val = this.max;
    this.value = val;
    // Don't dispatch value change on every input - only on blur/enter
  }

  private handleNumberComplete() {
    // Dispatch the value change when editing is complete
    this.dispatchValueChange();
  }

  private handleNumberKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      this.isEditing = false;
      this.handleNumberComplete();
    }
  }

  private enableEditing() {
    this.isEditing = true;
    this.updateComplete.then(() => this.numberInput?.focus());
  }

  render() {
    const percentage =
      this.max === this.min
        ? 0
        : ((this.value - this.min) / (this.max - this.min)) * 100;
    // Some label strings end in ": " for older layouts; the row layout
    // separates label and value itself.
    const label = this.labelKey
      ? translateText(this.labelKey).replace(/:\s*$/, "")
      : "";
    const isDefault =
      this.defaultValue !== undefined &&
      this.value === this.defaultValue &&
      this.defaultLabelKey !== "" &&
      !(this.value === 0 && this.disabledKey);
    return html`
      <div class="lw-slider">
        <div class="lw-slider__head">
          <span class="lw-slider__label">${label}</span>
          ${isDefault && !this.isEditing
            ? html`<span class="lw-slider__hint"
                >${translateText(this.defaultLabelKey)}</span
              >`
            : null}
          ${this.isEditing
            ? html`<input
                type="number"
                .min=${this.min}
                .max=${this.max}
                .valueAsNumber=${this.value}
                class="lw-slider__input"
                aria-label=${label}
                @input=${this.handleNumberInput}
                @blur=${() => {
                  this.isEditing = false;
                  this.handleNumberComplete();
                }}
                @keydown=${this.handleNumberKeyDown}
              />`
            : html`<span
                class="lw-slider__value ${this.value > 0 ? "" : "is-off"}"
                role="button"
                tabindex="0"
                @click=${this.enableEditing}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    this.enableEditing();
                    e.preventDefault();
                  }
                }}
              >
                ${this.value === 0 && this.disabledKey
                  ? translateText(this.disabledKey)
                  : this.value}
              </span>`}
        </div>
        <input
          type="range"
          class="lw-slider__range"
          aria-label=${label}
          .min=${this.min}
          .max=${this.max}
          .step=${this.step}
          .valueAsNumber=${this.value}
          style="--range-progress: ${percentage}%"
          @input=${this.handleSliderInput}
          @change=${this.handleSliderChange}
        />
      </div>
    `;
  }
}
