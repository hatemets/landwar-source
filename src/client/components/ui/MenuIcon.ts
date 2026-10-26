import { html } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import icon11 from "lucide-static/icons/arrow-left.svg?raw";
import icon23 from "lucide-static/icons/backpack.svg?raw";
import icon20 from "lucide-static/icons/check.svg?raw";
import icon10 from "lucide-static/icons/chevron-down.svg?raw";
import icon16 from "lucide-static/icons/credit-card.svg?raw";
import icon19 from "lucide-static/icons/ellipsis.svg?raw";
import icon7 from "lucide-static/icons/flame.svg?raw";
import icon12 from "lucide-static/icons/log-out.svg?raw";
import icon9 from "lucide-static/icons/menu.svg?raw";
import icon6 from "lucide-static/icons/mountain.svg?raw";
import icon17 from "lucide-static/icons/power.svg?raw";
import icon13 from "lucide-static/icons/settings-2.svg?raw";
import icon15 from "lucide-static/icons/share-2.svg?raw";
import icon22 from "lucide-static/icons/shopping-bag.svg?raw";
import icon18 from "lucide-static/icons/shuffle.svg?raw";
import icon2 from "lucide-static/icons/settings.svg?raw";
import icon5 from "lucide-static/icons/sprout.svg?raw";
import icon14 from "lucide-static/icons/tag.svg?raw";
import icon21 from "lucide-static/icons/trophy.svg?raw";
import icon3 from "lucide-static/icons/user-round.svg?raw";
import icon8 from "lucide-static/icons/zap.svg?raw";
import icon24 from "lucide-static/icons/anchor.svg?raw";
import icon25 from "lucide-static/icons/chart-column.svg?raw";
import icon26 from "lucide-static/icons/coins.svg?raw";
import icon27 from "lucide-static/icons/eye.svg?raw";
import icon28 from "lucide-static/icons/gamepad-2.svg?raw";
import icon29 from "lucide-static/icons/info.svg?raw";
import icon30 from "lucide-static/icons/landmark.svg?raw";
import icon31 from "lucide-static/icons/mail.svg?raw";
import icon32 from "lucide-static/icons/shield.svg?raw";
import icon33 from "lucide-static/icons/skull.svg?raw";
import icon34 from "lucide-static/icons/sparkle.svg?raw";
import icon35 from "lucide-static/icons/swords.svg?raw";
import icon36 from "lucide-static/icons/triangle-alert.svg?raw";
import icon37 from "lucide-static/icons/user.svg?raw";
import icon38 from "lucide-static/icons/user-plus.svg?raw";
import icon39 from "lucide-static/icons/users.svg?raw";
import icon40 from "lucide-static/icons/x.svg?raw";
const icons = {
  settings: icon2,
  "user-round": icon3,
  sprout: icon5,
  mountain: icon6,
  flame: icon7,
  zap: icon8,
  menu: icon9,
  "chevron-down": icon10,
  "arrow-left": icon11,
  "log-out": icon12,
  "settings-2": icon13,
  tag: icon14,
  "share-2": icon15,
  "credit-card": icon16,
  power: icon17,
  shuffle: icon18,
  ellipsis: icon19,
  check: icon20,
  trophy: icon21,
  "shopping-bag": icon22,
  backpack: icon23,
  anchor: icon24,
  "chart-column": icon25,
  coins: icon26,
  eye: icon27,
  "gamepad-2": icon28,
  info: icon29,
  landmark: icon30,
  mail: icon31,
  shield: icon32,
  skull: icon33,
  sparkle: icon34,
  swords: icon35,
  "triangle-alert": icon36,
  user: icon37,
  "user-plus": icon38,
  users: icon39,
  x: icon40,
};
export type MenuIconName = keyof typeof icons;
/**
 * Bundled Lucide SVGs only. No runtime markup or icon font download.
 * With no className the SVG keeps its 24px size and the parent sizes it.
 * Pass size classes (e.g. "size-4") to size the icon itself; the SVG then
 * fills the span. Light DOM only: the classes are Tailwind utilities.
 */
export function menuIcon(name: MenuIconName, className = "") {
  const cls = className
    ? `lw-icon inline-flex shrink-0 items-center justify-center [&>svg]:size-full ${className}`
    : "lw-icon";
  return html`<span class=${cls} aria-hidden="true"
    >${unsafeSVG(icons[name])}</span
  >`;
}

/** Raw SVG markup, for shadow-DOM components that size it with own CSS. */
export function menuIconSvg(name: MenuIconName) {
  return unsafeSVG(icons[name]);
}
