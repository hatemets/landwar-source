import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { PublicGameInfo } from "@openfront/shared/WireSchemas";
import { html, nothing, TemplateResult } from "lit";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import { notableLobbySettings } from "../utilities/LobbySettingsSummary";
import {
  getActiveModifiers,
  getMapName,
  ModifierInfo,
  translateText,
} from "../Utils";
import { hideFloatingTooltip, showFloatingTooltip } from "./FloatingTooltip";

/**
 * Aspect ratios keyed by map, loaded lazily from each map's manifest. Shared
 * so the second component to render a map doesn't refetch it.
 */
class MapAspectRatioCache {
  private ratios = new Map<GameMapType, number>();
  private pending = new Set<GameMapType>();

  get(mapType: GameMapType | undefined): number | undefined {
    return mapType === undefined ? undefined : this.ratios.get(mapType);
  }

  /**
   * Fetch the ratio for `mapType` if it isn't known yet, calling `onLoaded`
   * once it lands so the caller can re-render. Safe to call every render.
   */
  ensure(mapType: GameMapType | undefined, onLoaded: () => void): void {
    if (mapType === undefined) return;
    if (this.ratios.has(mapType) || this.pending.has(mapType)) return;
    this.pending.add(mapType);
    terrainMapFileLoader
      .getMapData(mapType)
      .manifest()
      .then((manifest: any) => {
        if (manifest?.map?.width && manifest?.map?.height) {
          this.ratios.set(mapType, manifest.map.width / manifest.map.height);
          onLoaded();
        }
      })
      .catch((e) => console.warn(`Failed to load manifest for ${mapType}`, e))
      .finally(() => this.pending.delete(mapType));
  }
}

export const mapAspectRatios = new MapAspectRatioCache();

export interface LobbyCardOptions {
  lobby: PublicGameInfo;
  /** Bottom-bar subtitle: the game mode, e.g. "FFA" or "5 teams of 20". */
  subtitle: string | TemplateResult;
  /** Right-hand pill: countdown, "Starting…", or a status word. */
  timeDisplay: string;
  timeDisplayUppercase?: boolean;
  onClick: () => void;
  disabled?: boolean;
  /**
   * Gated rather than disabled: the card dims and reports `aria-disabled` but
   * stays clickable, so `onClick` still runs and can refuse the action itself.
   * `disabled` would swallow the click (it also sets pointer-events-none).
   */
  blocked?: boolean;
  /** Card height; defaults to the homepage's fill-the-grid-cell sizing. */
  heightClass?: string;
  /** Extra setting tags after the modifiers, e.g. a hosted lobby's settings. */
  tags?: (string | LobbyCardIconTag)[];
}

/** A setting drawn as an icon and a short value; `label` is its tooltip. */
export interface LobbyCardIconTag {
  icon: "immunity";
  text: string;
  label: string;
}

/**
 * One class for both of the top row's pills so they can't drift apart. Keep
 * them direct flex children of the row: wrapped in a block, a pill picks up a
 * line box and renders short and low.
 */
const BADGE = "rounded-full bg-black/70";

/** Extreme aspect ratios (Amazon River is ~20:1) show whole rather than cropped. */
function fitsByContain(mapType: GameMapType): boolean {
  const ratio = mapAspectRatios.get(mapType);
  return ratio !== undefined && (ratio > 4 || ratio < 0.25);
}

/**
 * The compact lobby row used on the homepage and in the More Games browser.
 */
export function lobbyCard({
  lobby,
  subtitle,
  timeDisplay,
  timeDisplayUppercase = false,
  onClick,
  disabled = false,
  blocked = false,
  tags = [],
}: LobbyCardOptions): TemplateResult {
  const mapType = lobby.gameConfig!.gameMap as GameMapType;
  const mapName = getMapName(lobby.gameConfig?.gameMap);
  // A featured lobby names itself; the map drops to the subtitle line.
  const title = (lobby.featured ? lobby.label : undefined) ?? mapName;
  const subtitleLine =
    title === mapName || mapName === undefined
      ? subtitle
      : subtitle
        ? html`${mapName} · ${subtitle}`
        : mapName;
  // Hosted lobbies don't always advertise a cap; "3/" reads as a missing number.
  const capacity = lobby.gameConfig?.maxPlayers;
  const playerCount =
    capacity === undefined
      ? String(lobby.numClients)
      : `${lobby.numClients}/${capacity}`;
  const active = getActiveModifiers(
    lobby.gameConfig?.publicGameModifiers,
    lobby.gameConfig?.doomsdayClock?.speed,
  );
  // Gold settings share one tag: a coin and short values ("10M · x5"). The
  // full labels are its tooltip.
  const goldKeys = new Set([
    "public_game_modifier.starting_gold",
    "public_game_modifier.gold_multiplier",
  ]);
  const gold = active.filter((m) => goldKeys.has(m.badgeKey));
  // A modifier with an icon shows as the icon alone. Any other feature
  // turned off shows as its name struck through ("Ports"); the full badge
  // text is the tooltip. Longest first, so on a short card the pills that
  // say the most stay legible.
  const iconModifiers = active.filter((m) => MODIFIER_ICONS[m.labelKey]);
  const modifiers = active
    .filter((m) => !goldKeys.has(m.badgeKey) && !MODIFIER_ICONS[m.labelKey])
    .map((m) => {
      const label = translateText(m.badgeKey, m.badgeParams);
      return {
        label,
        text: m.turnsOff ? translateText(m.labelKey) : label,
        struck: m.turnsOff === true,
      };
    })
    .sort((a, b) => b.text.length - a.text.length);
  const custom = lobby.custom === true;

  const state = disabled
    ? "opacity-50 cursor-not-allowed pointer-events-none"
    : blocked
      ? "opacity-50 cursor-not-allowed"
      : "";
  // The map fills the card. Hover only changes the frame.
  const image = fitsByContain(mapType)
    ? "object-contain menu-lobby-card__image--contain"
    : "object-cover";

  return html`
    <button
      @click=${onClick}
      ?disabled=${disabled}
      aria-disabled=${blocked}
      class="menu-lobby-card group @container relative block w-full text-left ${state}"
    >
      <img
        src=${terrainMapFileLoader.getMapData(mapType).webpPath}
        alt=${mapName ?? mapType}
        draggable="false"
        class="menu-lobby-card__image pointer-events-none select-none ${image}"
      />
      <span class="menu-lobby-card__name">${title}</span>
      <span class="menu-lobby-card__details">${subtitleLine}</span>
      <span class="menu-lobby-card__count"
        >${playerCount}<svg
          class="menu-lobby-card__count-icon"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.62 16.23a1.24 1.24 0 0 1-.7-1.29 6.1 6.1 0 0 1 12.16 0c.06.53-.22 1.04-.7 1.29A11.94 11.94 0 0 1 7 17.5c-1.93 0-3.75-.46-5.38-1.27ZM14.25 15.5h-.05c.03-.27.04-.55.02-.84a7.58 7.58 0 0 0-1.55-4.06 4.5 4.5 0 0 1 6.21 3.95 1 1 0 0 1-.5.9 9.92 9.92 0 0 1-4.13 1.05Z"
          /></svg
      ></span>
      ${timeDisplay
        ? html`<span
            class="menu-lobby-card__clock ${timeDisplayUppercase
              ? ""
              : "normal-case"}"
            >${timeDisplay}</span
          >`
        : nothing}
      <span class="menu-lobby-card__status">
        ${timeDisplay
          ? html`<span
              class="menu-lobby-card__time ${timeDisplayUppercase
                ? ""
                : "normal-case"}"
              >${timeDisplay}</span
            >`
          : nothing}
        ${custom
          ? html`<span class="menu-lobby-card__tag"
              >${translateText("public_lobby.custom")}</span
            >`
          : nothing}
        ${gold.length > 0 ? goldTag(gold) : nothing}
        ${iconModifiers.map((m) => {
          const label = translateText(m.badgeKey, m.badgeParams);
          return html`<span
            class="menu-lobby-card__tag menu-lobby-card__icon-tag"
            title=${label}
            aria-label=${label}
            >${MODIFIER_ICONS[m.labelKey]!()}</span
          >`;
        })}
        ${modifiers
          .slice(0, 2)
          .map(
            (m) =>
              html`<span
                class="menu-lobby-card__tag ${m.struck ? "line-through" : ""}"
                title=${m.label}
                aria-label=${m.label}
                >${m.text}</span
              >`,
          )}
        ${tags.map((t) =>
          typeof t === "string"
            ? html`<span class="menu-lobby-card__tag">${t}</span>`
            : html`<span
                class="menu-lobby-card__tag menu-lobby-card__icon-tag"
                title=${t.label}
                aria-label=${t.label}
                >${TAG_ICONS[t.icon]()}${t.text}</span
              >`,
        )}
        ${custom ? customInfoIcon(lobby) : nothing}
      </span>
    </button>
  `;
}

function goldTag(gold: ModifierInfo[]): TemplateResult {
  const label = gold
    .map((m) => translateText(m.badgeKey, m.badgeParams))
    .join(", ");
  return html`<span
    class="menu-lobby-card__tag menu-lobby-card__gold"
    title=${label}
    aria-label=${label}
    >${coinIcon()}${gold.map((m) => m.formattedValue).join(" · ")}</span
  >`;
}

/** A stack of gold coins, drawn before the gold tag's values. */
function coinIcon(): TemplateResult {
  return html`<svg
    class="menu-lobby-card__gold-icon"
    viewBox="0 0 20 20"
    aria-hidden="true"
  >
    <ellipse cx="10" cy="14.5" rx="7" ry="3" fill="#b8860b" />
    <rect x="3" y="10" width="14" height="4.5" fill="#b8860b" />
    <ellipse cx="10" cy="10" rx="7" ry="3" fill="#f5c542" />
    <ellipse cx="10" cy="8" rx="7" ry="3" fill="#d4a017" />
    <rect x="3" y="5" width="14" height="3" fill="#d4a017" />
    <ellipse cx="10" cy="5" rx="7" ry="3" fill="#ffd95a" />
    <ellipse cx="10" cy="5" rx="4" ry="1.5" fill="#e8b923" />
  </svg>`;
}

/** A red radiation symbol, struck through: nukes are off. */
function nukesOffIcon(): TemplateResult {
  return html`<svg
    class="menu-lobby-card__tag-icon"
    viewBox="0 0 20 20"
    fill="#f87171"
    aria-hidden="true"
  >
    <circle cx="10" cy="10" r="1.5" />
    <path
      d="M11.25 12.17 13 15.2a6 6 0 0 1-6 0l1.75-3.03a2.5 2.5 0 0 0 2.5 0ZM7.5 10H4a6 6 0 0 1 3-5.2l1.75 3.03A2.5 2.5 0 0 0 7.5 10Zm3.75-2.17L13 4.8a6 6 0 0 1 3 5.2h-3.5a2.5 2.5 0 0 0-1.25-2.17Z"
    />
    <circle
      cx="10"
      cy="10"
      r="8.6"
      fill="none"
      stroke="#ef4444"
      stroke-width="1.8"
    />
    <path d="m4 4 12 12" stroke="#ef4444" stroke-width="1.8" />
  </svg>`;
}

/** A blue shield: players can't attack each other for a while. */
function immunityIcon(): TemplateResult {
  return html`<svg
    class="menu-lobby-card__tag-icon"
    viewBox="0 0 20 20"
    fill="#60a5fa"
    aria-hidden="true"
  >
    <path d="M10 1.5 3 4.3v5.2c0 4.1 2.9 7.6 7 9 4.1-1.4 7-4.9 7-9V4.3Z" />
  </svg>`;
}

/** Modifiers shown as an icon alone, keyed by labelKey. */
const MODIFIER_ICONS: Record<string, (() => TemplateResult) | undefined> = {
  "public_game_modifier.nukes_disabled_label": nukesOffIcon,
};

const TAG_ICONS: Record<LobbyCardIconTag["icon"], () => TemplateResult> = {
  immunity: immunityIcon,
};

/**
 * Bottom-right info icon on a player's listed lobby. Hovering shows that a
 * player made it and the settings it runs with, since a custom lobby in a
 * public queue otherwise looks like a scheduled game.
 */
function customInfoIcon(lobby: PublicGameInfo): TemplateResult {
  const c = lobby.gameConfig;
  const enabled = translateText("common.enabled");
  const lines: string[] = [];
  if (c?.maxPlayers !== undefined) {
    lines.push(
      `${translateText("host_modal.list_lobby_max_players")}: ${c.maxPlayers}`,
    );
  }
  if (c) {
    for (const s of notableLobbySettings(c, null)) {
      // Some labels (e.g. game_settings.bots) already end with ": ".
      const label = s.label.replace(/[:\uFF1A\s]+$/u, "");
      lines.push(s.value === enabled ? label : `${label}: ${s.value}`);
    }
    if ((c.disabledUnits?.length ?? 0) > 0) {
      lines.push(
        `${translateText("private_lobby.disabled_units")}: ${c.disabledUnits!.length}`,
      );
    }
  }
  const title = translateText("public_lobby.custom_tooltip_title");
  const tooltip = html`<div class="flex flex-col gap-0.5">
    <span class="font-bold">${title}</span>
    ${lines.length > 0
      ? lines.map((l) => html`<span class="text-white/80">${l}</span>`)
      : html`<span class="text-white/80"
          >${translateText("public_lobby.custom_default_settings")}</span
        >`}
  </div>`;
  // Floats in <body> (FloatingTooltip): the card clips its overflow, and so
  // do the modal panels the cards sit in.
  const show = (e: Event) =>
    showFloatingTooltip(e.currentTarget as HTMLElement, tooltip);
  return html`<span
    class="${BADGE} absolute bottom-2 right-2 flex items-center px-1.5 py-1 text-orange-400"
    aria-label=${title}
    data-custom-info
    @mouseenter=${show}
    @mouseleave=${hideFloatingTooltip}
  >
    <svg
      class="size-4"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fill-rule="evenodd"
        d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
        clip-rule="evenodd"
      />
    </svg>
  </span>`;
}
