import { html, TemplateResult } from "lit";
import { menuIcon } from "./MenuIcon";

export interface ModalHeaderProps {
  title?: string | TemplateResult;
  titleContent?: TemplateResult;
  onBack: (event: MouseEvent) => void;
  ariaLabel?: string;
  rightContent?: TemplateResult;
  leftClassName?: string;
  buttonClassName?: string;
  titleClassName?: string;
  padded?: boolean;
  showDivider?: boolean;
}

const DEFAULT_WRAPPER_CLASS =
  "field-modal-header flex flex-wrap items-center gap-2 shrink-0";
const DEFAULT_DIVIDER_CLASS = "border-b border-white/10";
const DEFAULT_PADDING_CLASS = "p-4 lg:p-6";
const DEFAULT_LEFT_CLASS = "flex items-center gap-4 flex-1";
const DEFAULT_BUTTON_CLASS =
  "group flex items-center justify-center w-11 h-11 rounded-full shrink-0 " +
  "menu-back-button bg-transparent border-0 hover:opacity-70 transition-opacity";
// One title style for every page header (22px, weight 600: .field-modal-title).
export const DEFAULT_TITLE_CLASS =
  "field-modal-title normal-case break-words hyphens-auto";

const withClasses = (...classes: Array<string | undefined>) =>
  classes.filter(Boolean).join(" ");

export const modalHeader = ({
  title,
  titleContent,
  onBack,
  ariaLabel = "Back",
  rightContent,
  leftClassName,
  buttonClassName,
  titleClassName,
  padded = true,
  showDivider = true,
}: ModalHeaderProps): TemplateResult => {
  const wrapperClass = withClasses(
    DEFAULT_WRAPPER_CLASS,
    showDivider ? DEFAULT_DIVIDER_CLASS : undefined,
    padded ? DEFAULT_PADDING_CLASS : undefined,
  );
  const leftClass = withClasses(DEFAULT_LEFT_CLASS, leftClassName);
  const buttonClass = withClasses(DEFAULT_BUTTON_CLASS, buttonClassName);
  const resolvedTitleClass = withClasses(DEFAULT_TITLE_CLASS, titleClassName);

  return html`
    <div class="${wrapperClass}">
      <div class="${leftClass}">
        <button
          @click=${onBack}
          class="${buttonClass}"
          aria-label="${ariaLabel}"
        >
          ${menuIcon("arrow-left")}
        </button>
        ${titleContent ??
        html`<span class="${resolvedTitleClass}">${title}</span>`}
      </div>
      ${rightContent ?? ""}
    </div>
  `;
};
