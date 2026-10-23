import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { formatKeyForDisplay, translateText } from "../../../../client/Utils";

@customElement("setting-keybind")
export class SettingKeybind extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property({ type: String, reflect: true }) action = "";
  @property({ type: String }) defaultKey = "";
  @property({ type: String }) value = "";
  @property({ type: String }) display = "";
  @property({ type: Boolean }) easter = false;

  createRenderRoot() {
    return this;
  }

  private listening = false;

  render() {
    const currentValue = this.value === "" ? "" : this.value || this.defaultKey;
    const canReset = this.value !== undefined && this.value !== this.defaultKey;
    const displayValue = this.display || currentValue;
    const rainbowClass = this.easter
      ? "bg-[linear-gradient(270deg,#990033,#996600,#336600,#008080,#1c3f99,#5e0099,#990033)] bg-[length:1400%_1400%] animate-rainbow-bg text-white hover:bg-[linear-gradient(270deg,#990033,#996600,#336600,#008080,#1c3f99,#5e0099,#990033)]"
      : "";

    return html`
      <div
        class="flex flex-row items-center justify-between w-full px-3 py-2 rounded-lg hover:bg-white/[0.04] transition-all gap-4 ${rainbowClass}"
      >
        <div class="flex flex-col flex-1 min-w-0 mr-4">
          <label class="text-white font-medium text-sm block"
            >${this.label}</label
          >
          <div class="text-white/50 text-xs leading-snug">
            ${this.description}
          </div>
        </div>

        <div class="flex items-center gap-3 shrink-0">
          <div
            class="relative h-9 min-w-[72px] px-3 flex items-center justify-center bg-white/[0.06] border border-transparent rounded-md text-sm font-medium font-mono hover:bg-white/[0.1] focus:border-[var(--field-accent)] transition-all cursor-pointer select-none text-white
            ${this.listening
              ? "border-[var(--field-accent)] text-[var(--field-accent-text)]"
              : ""}"
            role="button"
            aria-label="${translateText("user_setting.press_a_key")}"
            tabindex="0"
            @keydown=${this.handleKeydown}
            @click=${this.startListening}
            @blur=${this.handleBlur}
          >
            ${this.listening ? "..." : this.displayKey(displayValue)}
          </div>

          <div class="flex flex-col gap-1">
            <button
              class="text-xs font-medium bg-white/[0.06] hover:bg-white/[0.12] px-3 py-1 rounded text-white/60 hover:text-white transition-colors ${canReset
                ? ""
                : "opacity-50 cursor-not-allowed pointer-events-none"}"
              @click=${this.resetToDefault}
              ?disabled=${!canReset}
            >
              ${translateText("user_setting.reset")}
            </button>
            <button
              class="text-xs font-medium bg-white/[0.06] hover:bg-red-500/20 px-3 py-1 rounded text-white/60 hover:text-red-200 transition-colors"
              @click=${this.unbindKey}
            >
              ${translateText("user_setting.unbind")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private displayKey(key: string): string {
    if (!key || key === "Null") return translateText("common.none");
    return formatKeyForDisplay(key);
  }

  private startListening() {
    this.listening = true;
    this.requestUpdate();
  }

  private handleKeydown(e: KeyboardEvent) {
    if (!this.listening) return;

    if (e.key === "Escape") {
      // Cancel listening on Escape without bubbling to close parent modals
      e.preventDefault();
      e.stopPropagation();
      this.listening = false;
      this.requestUpdate();
      return;
    }

    // Allow Tab to work normally (don't trap focus)
    if (e.key === "Tab") {
      return;
    }

    // Don't capture lone modifier keys — wait for the actual key
    if (
      e.code === "ShiftLeft" ||
      e.code === "ShiftRight" ||
      e.code === "ControlLeft" ||
      e.code === "ControlRight" ||
      e.code === "AltLeft" ||
      e.code === "AltRight" ||
      e.code === "MetaLeft" ||
      e.code === "MetaRight"
    ) {
      return;
    }

    // Prevent default only for keys we're actually capturing
    e.preventDefault();

    const code = e.shiftKey ? `Shift+${e.code}` : e.code;
    const displayKey = e.shiftKey ? `Shift+${e.key.toUpperCase()}` : e.key;
    const prevValue = this.value;

    // Temporarily set the value to the new code for validation in parent
    this.value = code;

    const event = new CustomEvent("change", {
      detail: { action: this.action, value: code, key: displayKey, prevValue },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);

    // If parent rejects (restores value), this.value will be set back externally
    // Otherwise, keep the new value
    this.listening = false;
    this.requestUpdate();
  }

  private handleBlur() {
    this.listening = false;
    this.requestUpdate();
  }

  private resetToDefault() {
    this.value = this.defaultKey;
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: {
          action: this.action,
          value: this.defaultKey,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private unbindKey() {
    this.value = "Null";
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: {
          action: this.action,
          value: "Null",
          key: "",
        },
        bubbles: true,
        composed: true,
      }),
    );
    this.requestUpdate();
  }
}
