import { html, TemplateResult } from "lit";

export type ButtonVariant =
  | "normal"
  | "red"
  | "green"
  | "indigo"
  | "yellow"
  | "sky";
export interface ActionButtonProps {
  onClick: (e: MouseEvent) => void;
  type?: ButtonVariant;
  icon: string;
  iconAlt: string;
  title: string;
  label: string;
  disabled?: boolean;
}

const ICON_SIZE = "h-5 w-5 shrink-0";
const TEXT_SIZE = "text-sm leading-5 font-medium";

const getButtonStyles = () => {
  const btnBase =
    "group w-full min-w-[50px] select-none flex flex-col items-center justify-center " +
    "gap-1 rounded-md py-2 bg-gray-800 " +
    "transition-colors duration-150 " +
    "focus-visible:outline-2 focus-visible:outline-malibu-blue";

  return {
    normal: `${btnBase} text-gray-100 hover:bg-gray-700`,
    red: `${btnBase} text-red-300 hover:bg-gray-700`,
    green: `${btnBase} text-emerald-300 hover:bg-gray-700`,
    yellow: `${btnBase} text-amber-300 hover:bg-gray-700`,
    indigo: `${btnBase} text-indigo-300 hover:bg-gray-700`,
    sky: `${btnBase} text-sky-300 hover:bg-gray-700`,
  };
};

export const actionButton = (props: ActionButtonProps): TemplateResult => {
  const {
    onClick,
    type = "normal",
    icon,
    iconAlt,
    title,
    label,
    disabled = false,
  } = props;
  const buttonStyles = getButtonStyles();
  const buttonClass = buttonStyles[type];

  return html`
    <button
      @click=${onClick}
      class="${buttonClass}"
      title="${title}"
      type="button"
      aria-label="${title}"
      ?disabled=${disabled}
    >
      <img src=${icon} alt=${iconAlt} aria-hidden="true" class="${ICON_SIZE}" />
      <span class="${TEXT_SIZE}">${label}</span>
    </button>
  `;
};
