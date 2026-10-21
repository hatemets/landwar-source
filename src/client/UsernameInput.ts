import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import {
  genAnonUsername,
  looksGenerated,
  resolvePlayerName,
  type ResolvedPlayerName,
} from "./PlayerName";
import {
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  validateUsername,
} from "./validations/username";

interface LangSelectorLike {
  currentLang?: string;
  translations?: Record<string, string>;
  defaultTranslations?: Record<string, string>;
}

const usernameKey: string = "username";
// "The stored username is one we generated, not one the player chose." Written
// alongside the name itself.
const usernameIsGeneratedKey: string = "usernameIsGenerated";

// Shared name styling keeps the editable name aligned with the rest of the menu.
const NAME_TEXT =
  "text-xl/[normal] sm:text-2xl/[normal] font-semibold tracking-tight";

@customElement("username-input")
export class UsernameInput extends LitElement {
  @state() private baseUsername: string = "";
  // Minted once so re-resolving is stable: the player must never watch their
  // placeholder name change under them.
  private readonly generatedName: string = genAnonUsername();
  // Whether the name in baseUsername is one we generated rather than one the
  // player chose. Persisted, because one localStorage string cannot tell the
  // two apart.
  private usernameIsGenerated: boolean = false;

  @property({ type: String }) validationError: string = "";
  private _isValid: boolean = true;
  private _lastValidatedLang: string | null = null;

  createRenderRoot() {
    // Disable shadow DOM to allow Tailwind classes to work
    return this;
  }

  /**
   * The name this player will play under. The single seam join paths read.
   */
  public resolvedName(): ResolvedPlayerName {
    return resolvePlayerName({
      storedName: this.baseUsername,
      generatedName: this.generatedName,
    });
  }

  public getUsername(): string {
    return this.resolvedName().name;
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadStoredUsername();
  }

  protected updated(): void {
    // Re-validate when translations become available or language changes,
    // since initial validation may run before translations are loaded.
    if (this.validationError) {
      const langSelector = document.querySelector<LangSelectorLike & Element>(
        "lang-selector",
      );
      const lang = langSelector?.currentLang;
      const hasTranslations =
        langSelector?.translations ?? langSelector?.defaultTranslations;
      if (hasTranslations && lang && lang !== this._lastValidatedLang) {
        this._lastValidatedLang = lang;
        this.validateAndStore();
      }
    }
  }

  private loadStoredUsername() {
    let storedUsername = localStorage.getItem(usernameKey);
    if (
      storedUsername &&
      /^Anon[A-Za-z]+\d?$/.test(storedUsername) &&
      looksGenerated(storedUsername) &&
      localStorage.getItem(usernameIsGeneratedKey) !== "false"
    ) {
      storedUsername = null;
    }
    const resolved = resolvePlayerName({
      storedName: storedUsername,
      generatedName: this.generatedName,
    });
    this.baseUsername = resolved.name;
    this.usernameIsGenerated = storedUsername
      ? this.storedNameIsGenerated()
      : resolved.source === "generated";
    this.validateAndStore();
  }

  // Whether the name already in localStorage is one we generated.
  //
  // Installs that predate the flag have no key to read, so fall back to the
  // name's shape: both legacy guest names and current callsigns are
  // recognisable.
  private storedNameIsGenerated(): boolean {
    const stored = localStorage.getItem(usernameKey);
    if (!stored) return true;
    const flag = localStorage.getItem(usernameIsGeneratedKey);
    return flag === null ? looksGenerated(stored) : flag === "true";
  }

  render() {
    return html`
      <div class="menu-player-identity__layout">
        <div class="menu-player-identity__value">${this.renderNameInput()}</div>
      </div>
      ${this.validationError
        ? html`<div
            class="absolute top-full left-0 z-50 w-full mt-2 flex flex-col gap-1"
          >
            <div
              id="username-validation-error"
              class="w-full py-2 text-sm font-medium text-red-200"
            >
              ${this.validationError}
            </div>
          </div>`
        : null}
    `;
  }

  private renderNameInput() {
    return html`
      <input
        id="player-username"
        type="text"
        .value=${this.baseUsername}
        @input=${this.handleUsernameChange}
        placeholder="${translateText("username.enter_username")}"
        minlength="${MIN_USERNAME_LENGTH}"
        maxlength="${MAX_USERNAME_LENGTH}"
        aria-label=${translateText("username.enter_username")}
        class="menu-player-identity__input text-white placeholder-white/45 transition-colors text-ellipsis focus:outline-none ${NAME_TEXT}"
      />
    `;
  }

  private handleUsernameChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const originalValue = input.value;
    const val = originalValue.replace(/[[\]]/g, "");
    if (originalValue !== val) {
      input.value = val;
      // Show toast when brackets are removed
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("username.invalid_chars"),
            color: "red",
            duration: 2000,
          },
        }),
      );
    }
    this.baseUsername = val;
    // Typed by the player, so no longer ours to regenerate.
    this.usernameIsGenerated = false;
    this.validateAndStore();
  }

  private validateAndStore() {
    // The field's own contents, not resolvedName(): resolution falls through
    // an emptied field to a generated name, and play must stay blocked until
    // the player puts a name back.
    const trimmedBase = this.baseUsername.trim();
    const result = validateUsername(trimmedBase);
    this._isValid = result.isValid;
    if (result.isValid) {
      localStorage.setItem(usernameKey, trimmedBase);
      // Written with the name, never separately: a stale flag would either
      // strand a player on a generated name or overwrite one they chose.
      localStorage.setItem(
        usernameIsGeneratedKey,
        String(this.usernameIsGenerated),
      );
      this.validationError = "";
    } else {
      this.validationError = result.error ?? "";
    }
    this.emitValidity();
  }

  // Broadcast play-eligibility so action buttons can disable themselves.
  private emitValidity() {
    window.dispatchEvent(
      new CustomEvent("username-validity-change", {
        detail: { isValid: this.canPlay() },
      }),
    );
  }

  // Play-eligibility: the name is syntax-valid.
  public canPlay(): boolean {
    return this._isValid;
  }
}
