import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";

@customElement("input-card")
export class InputCard extends LitElement {
  @property({ attribute: false }) labelKey = "";
  @property({ attribute: false }) inputId?: string;
  @property({ attribute: false }) inputType = "number";
  @property({ attribute: false }) inputMin?: number | string;
  @property({ attribute: false }) inputMax?: number | string;
  @property({ attribute: false }) inputStep?: number | string;
  @property({ attribute: false }) inputValue?: number | string;
  @property({ attribute: false }) inputAriaLabel?: string;
  @property({ attribute: false }) inputPlaceholder?: string;
  @property({ attribute: false }) onInput?: (e: Event) => void;
  @property({ attribute: false }) onChange?: (e: Event) => void;
  @property({ attribute: false }) onKeyDown?: (e: KeyboardEvent) => void;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <label class="setup-number-row is-active">
        <span>${translateText(this.labelKey)}</span>
        <input
          type=${this.inputType}
          id=${this.inputId ?? nothing}
          min=${this.inputMin ?? nothing}
          max=${this.inputMax ?? nothing}
          step=${this.inputStep ?? nothing}
          .value=${String(this.inputValue ?? "")}
          aria-label=${this.inputAriaLabel ?? translateText(this.labelKey)}
          placeholder=${this.inputPlaceholder ?? nothing}
          @input=${this.onInput}
          @change=${this.onChange}
          @keydown=${this.onKeyDown}
        />
      </label>
    `;
  }
}
