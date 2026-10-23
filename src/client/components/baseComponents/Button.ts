import { LitElement, TemplateResult, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../Utils";

type ButtonVariant = "primary" | "secondary" | "danger" | "warning" | "ghost";
type ButtonSize = "xs" | "sm" | "md" | "lg";
type ButtonWidth = "auto" | "block" | "blockDesktop" | "fill";
type IconPosition = "left" | "right" | "only";

@customElement("o-button")
export class OButton extends LitElement {
  @property() title = "";
  @property() translationKey = "";
  @property() variant: ButtonVariant = "primary";
  @property() size: ButtonSize = "md";
  @property() width: ButtonWidth = "auto";
  @property() iconPosition: IconPosition = "left";
  @property({ attribute: false }) icon?: TemplateResult;
  @property({ type: Boolean }) disable = false;
  @property({ type: Boolean }) submit = false;
  @property({ type: Boolean }) uppercase = false;

  createRenderRoot() {
    return this;
  }

  private readonly BASE =
    "font-medium rounded-md border border-transparent " +
    "transition-colors duration-150 " +
    "outline-none focus-visible:ring-2 focus-visible:ring-malibu-blue focus-visible:ring-offset-2 focus-visible:ring-offset-transparent " +
    "text-center whitespace-normal break-words leading-tight overflow-hidden relative " +
    "disabled:cursor-not-allowed";

  private variantClasses(): string {
    switch (this.variant) {
      case "primary":
        return "bg-malibu-blue hover:bg-aquarius text-white disabled:bg-white/[0.06] disabled:text-white/35";
      case "secondary":
        return "bg-[var(--field-raised)] hover:bg-[var(--field-hover)] text-[var(--field-paper)] disabled:bg-white/[0.04] disabled:text-white/35";
      case "danger":
        return "bg-red-600 hover:bg-red-500 text-white disabled:bg-white/[0.06] disabled:text-white/35";
      case "warning":
        return "bg-amber-400 hover:bg-amber-300 text-gray-900 disabled:bg-white/[0.06] disabled:text-white/35";
      case "ghost":
        return "bg-transparent hover:bg-white/[0.07] text-white disabled:text-white/35 disabled:hover:bg-transparent";
    }
  }

  private sizeClasses(): string {
    if (this.iconPosition === "only") {
      switch (this.size) {
        case "xs":
          return "w-6 h-6 text-xs";
        case "sm":
          return "w-8 h-8 text-sm";
        case "md":
          return "w-11 h-11 text-base";
        case "lg":
          return "w-12 h-12 text-lg";
      }
    }
    switch (this.size) {
      case "xs":
        return "py-1 px-2 text-xs";
      case "sm":
        return "py-1.5 px-3 text-sm";
      case "md":
        return "min-h-9 py-2 px-4 text-sm";
      case "lg":
        return "py-3 px-5 text-base";
    }
  }

  private widthClasses(): string {
    switch (this.width) {
      case "auto":
        return "inline-flex items-center justify-center gap-2";
      case "block":
        return "flex w-full items-center justify-center gap-2";
      case "blockDesktop":
        return "flex w-full items-center justify-center gap-2 lg:w-1/2 lg:mx-auto";
      case "fill":
        return "flex w-full h-full items-center justify-center gap-2";
    }
  }

  render() {
    const label =
      this.translationKey === ""
        ? this.title
        : translateText(this.translationKey);
    const iconOnly = this.iconPosition === "only";
    // Design.md: sentence case only. `uppercase` is kept for callers.
    const casing = "normal-case";
    const classes = `${this.BASE} ${casing} ${this.variantClasses()} ${this.sizeClasses()} ${this.widthClasses()}`;

    return html`
      <button
        class=${classes}
        ?disabled=${this.disable}
        type=${this.submit ? "submit" : "button"}
        aria-label=${iconOnly ? label : nothing}
      >
        ${this.icon && this.iconPosition !== "right" ? this.icon : nothing}
        ${iconOnly ? nothing : html`<span class="min-w-0">${label}</span>`}
        ${this.icon && this.iconPosition === "right" ? this.icon : nothing}
      </button>
    `;
  }
}
