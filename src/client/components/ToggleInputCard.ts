import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../Utils";

@customElement("toggle-input-card")
export class ToggleInputCard extends LitElement {
  @property({ attribute: false }) labelKey = "";
  @property({ type: Boolean, attribute: false }) checked = false;
  @property({ attribute: false }) inputId?: string;
  @property({ attribute: false }) inputType = "number";
  @property({ attribute: false }) inputMin?: number | string;
  @property({ attribute: false }) inputMax?: number | string;
  @property({ attribute: false }) inputStep?: number | string;
  @property({ attribute: false }) inputValue?: number | string;
  @property({ attribute: false }) inputAriaLabel?: string;
  @property({ attribute: false }) inputPlaceholder?: string;
  @property({ attribute: false }) zeroLabel?: string;
  @property({ attribute: false }) defaultInputValue?: number | string;
  @property({ attribute: false }) minValidOnEnable?: number;
  @property({ attribute: false }) onToggle?: (
    checked: boolean,
    value: number | string | undefined,
  ) => void;
  @property({ attribute: false }) onInput?: (e: Event) => void;
  @property({ attribute: false }) onChange?: (e: Event) => void;
  @property({ attribute: false }) onKeyDown?: (e: KeyboardEvent) => void;
  @state() private draft = "";
  @state() private editing = false;
  @state() private invalid = false;
  createRenderRoot() {
    return this;
  }
  private handleInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    this.draft = input.value;
    if (this.inputType !== "number") return;
    const value = input.valueAsNumber;
    const valid =
      input.value.trim() !== "" &&
      input.validity.valid &&
      Number.isFinite(value) &&
      (this.minValidOnEnable === undefined || value >= this.minValidOnEnable);
    this.invalid = input.validity.badInput || (input.value !== "" && !valid);
    this.onToggle?.(valid, valid ? value : undefined);
  };
  render() {
    return html`<div class="setup-number-field">
      <label class="setup-number-row ${this.checked ? "is-active" : ""}"
        ><span
          >${translateText(this.labelKey)}${this.checked &&
          Number(this.inputValue) === 0 &&
          this.zeroLabel
            ? html`<small>${this.zeroLabel}</small>`
            : nothing}</span
        ><input
          type=${this.inputType}
          id=${this.inputId ?? nothing}
          min=${this.inputMin ?? nothing}
          max=${this.inputMax ?? nothing}
          step=${this.inputStep ?? 1}
          .value=${this.editing || this.invalid
            ? this.draft
            : this.checked
              ? String(this.inputValue ?? "")
              : ""}
          aria-label=${this.inputAriaLabel ?? translateText(this.labelKey)}
          aria-invalid=${this.invalid}
          placeholder=${this.inputPlaceholder ?? "—"}
          @focus=${(e: FocusEvent) => {
            this.draft = (e.target as HTMLInputElement).value;
            this.editing = true;
          }}
          @input=${this.handleInput}
          @change=${(e: Event) => {
            if (this.inputType === "number") return;
            this.onChange?.(e);
            const value = (e.target as HTMLInputElement).value;
            this.onToggle?.(value.trim() !== "", value);
          }}
          @blur=${() => {
            this.editing = false;
          }}
          @keydown=${this.onKeyDown} /></label
      >${this.invalid
        ? html`<p class="field-error" role="alert">
            ${translateText(
              this.inputMin !== undefined && this.inputMax !== undefined
                ? "landwar_ui.valid_range"
                : this.inputMin !== undefined
                  ? "landwar_ui.valid_min"
                  : "landwar_ui.valid_number",
              { min: this.inputMin ?? "", max: this.inputMax ?? "" },
            )}
          </p>`
        : nothing}
    </div>`;
  }
}
