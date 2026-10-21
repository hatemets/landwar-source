import { html } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import icon11 from "lucide-static/icons/arrow-left.svg?raw";
import icon23 from "lucide-static/icons/backpack.svg?raw";
import icon0 from "lucide-static/icons/bell-ring.svg?raw";
import icon20 from "lucide-static/icons/check.svg?raw";
import icon10 from "lucide-static/icons/chevron-down.svg?raw";
import icon1 from "lucide-static/icons/circle-help.svg?raw";
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
import icon2 from "lucide-static/icons/sliders-horizontal.svg?raw";
import icon5 from "lucide-static/icons/sprout.svg?raw";
import icon14 from "lucide-static/icons/tag.svg?raw";
import icon21 from "lucide-static/icons/trophy.svg?raw";
import icon3 from "lucide-static/icons/user-round.svg?raw";
import icon4 from "lucide-static/icons/users-round.svg?raw";
import icon8 from "lucide-static/icons/zap.svg?raw";
const icons = {
  "bell-ring": icon0,
  "circle-help": icon1,
  "sliders-horizontal": icon2,
  "user-round": icon3,
  "users-round": icon4,
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
};
export type MenuIconName = keyof typeof icons;
/** Bundled Lucide SVGs only. No runtime markup or icon font download. */
export function menuIcon(name: MenuIconName, className = "") {
  return html`<span class="lw-icon ${className}" aria-hidden="true"
    >${unsafeSVG(icons[name])}</span
  >`;
}
