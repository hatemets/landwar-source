import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  migrateLegacyGraphicsSettings,
  parseGraphicsOverridesJson,
} from "../GraphicsPresets";
import { UserSettings } from "../UserSettings";
import { translateText } from "../Utils";

// Match the `setting-*` rows: borderless tinted fields, quiet buttons.
const FIELD_CLASS =
  "px-3 border border-transparent rounded-md bg-white/[0.06] text-white text-sm placeholder:text-white/40 focus:outline-none focus:border-[var(--field-accent)] transition-all";
const BUTTON_CLASS =
  "shrink-0 h-9 px-3 text-sm font-medium rounded-md border border-white/10 text-white bg-white/5 hover:bg-white/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

/**
 * Save / copy / import for the whole graphics configuration.
 *
 * Sits at the top level of the Graphics tab, beside the preset dropdown rather
 * than inside the Advanced fold: saving what you just tuned is not itself a
 * tuning control, and a player who never expands Advanced should still find it.
 *
 * Self-contained like `graphics-preset-selector`: it reads and writes
 * `UserSettings` directly. A write to the graphics key is what a running game
 * follows, so an import applies live with no renderer reference here.
 */
@customElement("graphics-preset-tools")
export class GraphicsPresetTools extends LitElement {
  private readonly userSettings = new UserSettings();

  @state() private presetName = "";
  @state() private importText = "";
  @state() private importError = false;
  @state() private copiedJson = false;

  private copyResetTimer: ReturnType<typeof setTimeout> | undefined;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // Snapshot pre-preset custom settings before an import can overwrite them
    // wholesale. Idempotent, and a no-op once done.
    migrateLegacyGraphicsSettings(this.userSettings);
  }

  disconnectedCallback() {
    clearTimeout(this.copyResetTimer);
    super.disconnectedCallback();
  }

  private onPresetNameInput(event: Event) {
    this.presetName = (event.target as HTMLInputElement).value;
  }

  private onSavePreset() {
    const name = this.presetName.trim();
    if (!name) return;
    this.userSettings.setGraphicsPresets({
      ...this.userSettings.graphicsPresets(),
      [name]: this.userSettings.graphicsOverrides(),
    });
    this.presetName = "";
  }

  private async onCopyJson() {
    const json = JSON.stringify(this.userSettings.graphicsOverrides(), null, 2);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      return; // clipboard unavailable (permissions / insecure context)
    }
    this.copiedJson = true;
    clearTimeout(this.copyResetTimer);
    this.copyResetTimer = setTimeout(() => (this.copiedJson = false), 1500);
  }

  private onImportTextInput(event: Event) {
    this.importText = (event.target as HTMLTextAreaElement).value;
    this.importError = false;
  }

  private onImportApply() {
    // The text is whatever the player pasted, so the parse is guarded as well
    // as checked. Deeply nested input survives JSON.parse and the schema (which
    // strips what it does not know) only to overflow the stack in the
    // structural comparison behind it — a RangeError, not a parse failure.
    // Either way the answer to the player is the same: that is not settings
    // JSON.
    try {
      const parsed = parseGraphicsOverridesJson(this.importText);
      if (parsed === null) {
        this.importError = true;
        return;
      }
      this.userSettings.setGraphicsOverrides(parsed);
    } catch {
      this.importError = true;
      return;
    }
    this.importText = "";
  }

  render() {
    return html`
      <div class="flex flex-col gap-2">
        <div class="flex flex-col w-full px-3 py-2 gap-3">
          <div class="flex flex-col min-w-0">
            <label
              class="text-white font-medium text-sm"
              for="graphics-preset-name"
              >${translateText("graphics_setting.save_preset_label")}</label
            >
          </div>
          <div class="flex gap-2 items-center w-full">
            <input
              type="text"
              id="graphics-preset-name"
              .value=${this.presetName}
              placeholder=${translateText(
                "graphics_setting.preset_name_placeholder",
              )}
              spellcheck="false"
              maxlength="40"
              @input=${this.onPresetNameInput}
              class="${FIELD_CLASS} flex-1 min-w-0 h-9"
            />
            <button
              id="graphics-save-preset"
              class=${BUTTON_CLASS}
              ?disabled=${this.presetName.trim() === ""}
              @click=${this.onSavePreset}
            >
              ${translateText("graphics_setting.save_preset_label")}
            </button>
          </div>
        </div>

        <div class="flex flex-row items-center w-full px-3 py-2 gap-3">
          <div class="flex flex-col flex-1 min-w-0">
            <div class="text-white font-medium text-sm">
              ${translateText("graphics_setting.copy_json_label")}
            </div>
            <div class="text-white/50 text-xs leading-snug">
              ${translateText("graphics_setting.copy_json_desc")}
            </div>
          </div>
          <button
            id="graphics-copy-json"
            class=${BUTTON_CLASS}
            @click=${this.onCopyJson}
          >
            ${this.copiedJson
              ? translateText("common.copied")
              : translateText("graphics_setting.copy_json_button")}
          </button>
        </div>

        <div class="flex flex-col w-full px-3 py-2 gap-3">
          <div class="flex flex-col min-w-0">
            <label
              class="text-white font-medium text-sm"
              for="graphics-import-json"
              >${translateText("graphics_setting.import_json_label")}</label
            >
            <div class="text-white/50 text-xs leading-snug">
              ${translateText("graphics_setting.import_json_desc")}
            </div>
          </div>
          <textarea
            id="graphics-import-json"
            rows="3"
            .value=${this.importText}
            spellcheck="false"
            @input=${this.onImportTextInput}
            class="${FIELD_CLASS} w-full py-2 font-mono ${this.importError
              ? "!border-red-500"
              : ""}"
          ></textarea>
          ${this.importError
            ? html`<div id="graphics-import-error" class="text-xs text-red-400">
                ${translateText("graphics_setting.import_json_invalid")}
              </div>`
            : nothing}
          <button
            id="graphics-import-apply"
            class="${BUTTON_CLASS} self-start"
            ?disabled=${this.importText.trim() === ""}
            @click=${this.onImportApply}
          >
            ${translateText("graphics_setting.import_json_apply")}
          </button>
        </div>
      </div>
    `;
  }
}
