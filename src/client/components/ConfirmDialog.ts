import { html, LitElement, render as litRender } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../Utils";

/**
 * A reusable inline confirmation / acknowledgement dialog.
 *
 * Usage:
 * ```html
 * <confirm-dialog
 *   .message=${"Are you sure?"}
 *   variant="danger"
 *   @confirm=${() => doThing()}
 *   @cancel=${() => {}}
 * ></confirm-dialog>
 * ```
 *
 * For ban-style flows, add a textarea:
 * ```html
 * <confirm-dialog
 *   .message=${"Ban this player?"}
 *   variant="warning"
 *   textareaPlaceholder="Reason (optional)"
 *   @confirm=${(e) => ban(e.detail.text)}
 *   @cancel=${() => {}}
 * ></confirm-dialog>
 * ```
 */
@customElement("confirm-dialog")
export class ConfirmDialog extends LitElement {
  @property() heading = "";
  @property() message = "";
  @property() variant: "danger" | "warning" = "danger";
  @property() textareaPlaceholder = "";
  @property() confirmText = "";
  @property() cancelText = "";
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) showClose = false;
  @property({ type: Boolean }) wide = false;
  @property() buttons: "confirmCancel" | "confirmOnly" | "none" =
    "confirmCancel";

  @state() private text = "";

  private portal: HTMLDivElement | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.portal = document.createElement("div");
    document.body.appendChild(this.portal);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.portal) {
      litRender(html``, this.portal);
      this.portal.remove();
      this.portal = null;
    }
  }

  render() {
    if (this.portal) {
      litRender(this.renderOverlay(), this.portal);
    }
    return html``;
  }

  private renderOverlay() {
    // One dialog look for every variant (Google-style): flat raised surface,
    // no coloured border or glow, body in the text tokens, right-aligned
    // sentence-case buttons. The variant no longer changes the colours.
    return html`
      <div
        class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/60"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.handleCancel();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          class="relative mx-4 w-full ${this.wide
            ? "max-w-md"
            : "max-w-sm"} rounded-lg bg-[var(--field-raised)] p-6 text-[var(--field-paper)]"
        >
          ${this.showClose
            ? html`<button
                @click=${() => this.handleCancel()}
                aria-label=${translateText("common.close")}
                class="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-md text-xl leading-none text-[var(--field-muted)] hover:bg-[var(--field-hover)] hover:text-[var(--field-paper)] transition-colors"
              >
                ×
              </button>`
            : ""}
          ${this.heading
            ? html`<h2
                class="mb-4 pr-8 text-xl font-semibold leading-7 text-[var(--field-paper)]"
              >
                ${this.heading}
              </h2>`
            : ""}
          <!-- A property binding, so the template's own line breaks around
               it never reach pre-line. -->
          <p
            class="mb-6 text-sm leading-5 text-[var(--field-muted)] whitespace-pre-line"
            .textContent=${this.message}
          ></p>
          ${this.textareaPlaceholder
            ? html`<textarea
                .value=${this.text}
                @input=${(e: Event) =>
                  (this.text = (e.target as HTMLTextAreaElement).value)}
                maxlength="200"
                rows="2"
                placeholder="${this.textareaPlaceholder}"
                class="mb-6 w-full resize-none rounded-md border border-[var(--field-line)] bg-[var(--field-surface)] px-3 py-2 text-sm text-[var(--field-paper)] placeholder:text-[var(--field-faint)] focus:outline-2 focus:outline-[var(--field-accent)]"
              ></textarea>`
            : ""}
          ${this.buttons === "none"
            ? ""
            : html`<div class="flex justify-end gap-2">
                ${this.buttons === "confirmCancel"
                  ? html`<button
                      @click=${() => this.handleCancel()}
                      ?disabled=${this.disabled}
                      class="h-9 rounded-md px-4 text-sm font-medium text-[var(--field-accent-text)] hover:bg-[var(--field-accent-soft)] transition-colors disabled:opacity-50 disabled:pointer-events-none border-0 bg-transparent"
                    >
                      ${this.cancelText || translateText("common.cancel")}
                    </button>`
                  : ""}
                <button
                  @click=${() => this.handleConfirm()}
                  ?disabled=${this.disabled}
                  class="h-9 rounded-md px-4 text-sm font-medium bg-[var(--field-accent)] text-white hover:bg-[var(--field-accent-hover)] transition-colors disabled:opacity-50 disabled:pointer-events-none border-0"
                >
                  ${this.confirmText || translateText("common.confirm")}
                </button>
              </div>`}
        </div>
      </div>
    `;
  }

  private handleConfirm() {
    this.dispatchEvent(
      new CustomEvent("confirm", { detail: { text: this.text } }),
    );
    this.text = "";
  }

  private handleCancel() {
    this.dispatchEvent(new CustomEvent("cancel"));
    this.text = "";
  }
}
