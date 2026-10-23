import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("setting-toggle")
export class SettingToggle extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property() id = "";
  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: Boolean }) easter = false;
  /** Dependent settings use this while their parent setting is off. */
  @property({ type: Boolean, reflect: true }) disabled = false;

  createRenderRoot() {
    return this;
  }

  // `.checked` is a property binding, not `?checked`: once the player has
  // clicked the box, its dirty checkedness flag makes the attribute inert, so
  // an attribute binding could never un-check it again — "Reset to defaults"
  // would leave the box showing the old state.
  private handleChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.checked = input.checked;
  }

  render() {
    const rainbowClass = this.easter
      ? "bg-[linear-gradient(270deg,#990033,#996600,#336600,#008080,#1c3f99,#5e0099,#990033)] bg-[length:1400%_1400%] animate-rainbow-bg text-white hover:bg-[linear-gradient(270deg,#990033,#996600,#336600,#008080,#1c3f99,#5e0099,#990033)]"
      : "";

    return html`
      <label
        class="flex flex-row items-center justify-between w-full min-h-10 px-3 py-2 rounded-lg transition-colors duration-150 gap-3 ${this
          .disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:bg-white/[0.04] cursor-pointer"} ${rainbowClass}"
      >
        <div class="flex flex-col flex-1 min-w-0">
          <div class="text-white text-sm font-medium">${this.label}</div>
          ${this.description
            ? html`<div class="text-white/50 text-xs leading-snug">
                ${this.description}
              </div>`
            : null}
        </div>

        <span class="setup-switch">
          <input
            type="checkbox"
            role="switch"
            id=${this.id}
            .checked=${this.checked}
            ?disabled=${this.disabled}
            @change=${this.handleChange}
          /><span class="setup-switch__track" aria-hidden="true"></span>
        </span>
      </label>
    `;
  }
}
