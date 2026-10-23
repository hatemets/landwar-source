import { html, nothing, TemplateResult } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import circleAlert from "lucide-static/icons/circle-alert.svg?raw";
import circleCheck from "lucide-static/icons/circle-check.svg?raw";
import info from "lucide-static/icons/info.svg?raw";
import triangleAlert from "lucide-static/icons/triangle-alert.svg?raw";
import close from "lucide-static/icons/x.svg?raw";

export type NoticeTone = "danger" | "warning" | "success" | "info";

const TONE_ICONS: Record<NoticeTone, string> = {
  danger: circleAlert,
  warning: triangleAlert,
  success: circleCheck,
  info,
};

/**
 * Inline notice per docs/Design.md: a flat soft status fill, primary text and
 * a small status icon. No border, no glow, no paragraph in a status colour.
 */
export function statusNotice(
  tone: NoticeTone,
  message: string | TemplateResult,
  options: { onDismiss?: () => void; dismissLabel?: string } = {},
): TemplateResult {
  return html`<div class="lw-notice lw-notice--${tone}" role="status">
    <span class="lw-notice__icon" aria-hidden="true"
      >${unsafeSVG(TONE_ICONS[tone])}</span
    >
    <p class="lw-notice__text">${message}</p>
    ${options.onDismiss
      ? html`<button
          type="button"
          class="lw-notice__dismiss"
          aria-label=${options.dismissLabel ?? ""}
          @click=${options.onDismiss}
        >
          ${unsafeSVG(close)}
        </button>`
      : nothing}
  </div>`;
}
