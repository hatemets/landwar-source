import {
  Difficulty,
  GameMapSize,
  GameMode,
  GameType,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfig } from "@openfront/engine-api/Schemas";
import { html, TemplateResult } from "lit";
import { renderDuration, translateText } from "../../client/Utils";

const DISABLED_UNIT_KEYS: Record<string, string> = {
  City: "unit_type.city",
  Port: "unit_type.port",
  "Defense Post": "unit_type.defense_post",
  "SAM Launcher": "unit_type.sam_launcher",
  "Missile Silo": "unit_type.missile_silo",
  Warship: "unit_type.warship",
  Factory: "unit_type.factory",
  "Atom Bomb": "unit_type.atom_bomb",
  "Hydrogen Bomb": "unit_type.hydrogen_bomb",
  MIRV: "unit_type.mirv",
  "Trade Ship": "player_stats_table.unit.trade",
  Transport: "player_stats_table.unit.trans",
  "MIRV Warhead": "player_stats_table.unit.mirvw",
};

const millions = (gold: number) =>
  `${parseFloat((gold / 1_000_000).toPrecision(12))}M`;

// Non-default settings worth surfacing, shared by the join modal (post-join
// config view and open-lobby rows), the in-game menu and the custom-lobby
// info tooltip on lobby cards. Pass null nationCount to skip the
// numeric-nations default comparison (it needs the map's nation list).
export function notableLobbySettings(
  c: GameConfig,
  nationCount: number | null,
): { label: string; value: string }[] {
  const isTeam = c.gameMode === GameMode.Team;
  const enabled = translateText("common.enabled");
  const disabled = translateText("common.disabled");
  const pm = c.publicGameModifiers;
  const items: { label: string; value: string }[] = [];
  if (pm?.isCrowded)
    items.push({
      label: translateText("host_modal.crowded"),
      value: enabled,
    });
  if (
    pm?.isHardNations ||
    (c.gameType === GameType.Private && c.difficulty !== Difficulty.Easy) ||
    // Gold rush rolls its nations from Medium to Impossible.
    (c.gameType === GameType.Public &&
      c.nations !== "disabled" &&
      c.difficulty !== Difficulty.Medium)
  )
    items.push({
      label: translateText("difficulty.difficulty"),
      value: translateText(`difficulty.${c.difficulty.toLowerCase()}`),
    });
  if (c.infiniteTroops)
    items.push({
      label: translateText("game_settings.infinite_troops"),
      value: enabled,
    });
  if (c.infiniteGold)
    items.push({
      label: translateText("game_settings.infinite_gold"),
      value: enabled,
    });
  if (c.instantBuild)
    items.push({
      label: translateText("game_settings.instant_build"),
      value: enabled,
    });
  if (c.randomSpawn)
    items.push({
      label: translateText("game_settings.random_spawn"),
      value: enabled,
    });
  if (c.maxTimerValue)
    items.push({
      label: translateText("private_lobby.game_length"),
      value: renderDuration(c.maxTimerValue * 60),
    });
  if (
    c.spawnImmunityDuration &&
    Math.round(c.spawnImmunityDuration / 10) !== 5
  ) {
    items.push({
      label: translateText("private_lobby.pvp_immunity"),
      value: renderDuration(Math.round(c.spawnImmunityDuration / 10)),
    });
  }
  if (c.startingGold)
    items.push({
      label: translateText("private_lobby.starting_gold"),
      value: millions(c.startingGold),
    });
  if (c.goldMultiplier)
    items.push({
      label: translateText("game_settings.gold_multiplier"),
      value: `x${c.goldMultiplier}`,
    });
  if (c.customAllianceDuration === 0 || c.disableAlliances)
    items.push({
      label: translateText("public_game_modifier.disable_alliances_label"),
      value: disabled,
    });
  else if (
    typeof c.customAllianceDuration === "number" &&
    // 5 minutes is the sim fallback (Config.allianceDuration), so an
    // explicit 5 changes nothing worth surfacing.
    c.customAllianceDuration !== 5
  )
    items.push({
      label: translateText("public_game_modifier.disable_alliances_label"),
      value: renderDuration(c.customAllianceDuration * 60),
    });
  if (c.waterNukes)
    items.push({
      label: translateText("game_settings.water_nukes"),
      value: enabled,
    });
  if (c.doomsdayClock?.enabled)
    items.push({
      label: translateText("game_settings.doomsday_clock"),
      value: translateText(
        `doomsday_clock_speed.${c.doomsdayClock.speed ?? "normal"}`,
      ),
    });
  if (c.overtime?.enabled)
    items.push({
      label: translateText("overtime.title"),
      value: renderDuration((c.overtime.startMinutes ?? 30) * 60),
    });
  if (c.anonymizeNames)
    items.push({
      label: translateText("host_modal.anonymous_players"),
      value: enabled,
    });
  if ((isTeam && !c.donateGold) || (!isTeam && c.donateGold))
    items.push({
      label: translateText("host_modal.donate_gold"),
      value: c.donateGold ? enabled : disabled,
    });
  if ((isTeam && !c.donateTroops) || (!isTeam && c.donateTroops))
    items.push({
      label: translateText("host_modal.donate_troops"),
      value: c.donateTroops ? enabled : disabled,
    });
  const isCompact =
    c.gameMapSize === GameMapSize.Compact || c.publicGameModifiers?.isCompact;
  if (isCompact)
    items.push({
      label: translateText("game_settings.compact_map"),
      value: enabled,
    });
  {
    const defaultBots = isCompact ? 100 : 400;
    if (c.bots !== defaultBots)
      items.push({
        label: translateText("game_settings.bots"),
        value: String(c.bots),
      });
  }
  if (nationCount !== null) {
    const defaultNations = isCompact
      ? Math.max(0, Math.floor(nationCount * 0.25))
      : nationCount;
    if (typeof c.nations === "number" && c.nations !== defaultNations)
      items.push({
        label: translateText("game_settings.nations"),
        value: String(c.nations),
      });
  }
  if (c.nations === "disabled" && !(c.gameType === GameType.Public && isTeam))
    items.push({
      label: translateText("game_settings.nations"),
      value: disabled,
    });
  return items;
}

/**
 * One setting as a single tag: a switched-on setting is just its name, any
 * other value follows it ("Bots: 100").
 */
export function lobbySettingTagText(setting: {
  label: string;
  value: string;
}): string {
  // Some labels (e.g. game_settings.bots) already end with ": " or "：".
  const label = setting.label.replace(/[:\uFF1A\s]+$/u, "");
  return setting.value === translateText("common.enabled")
    ? label
    : `${label}: ${setting.value}`;
}

/**
 * The notable settings as a two-column table, one row each: name on the
 * left, value on the right.
 */
export function lobbySettingsTable(
  settings: { label: string; value: string }[],
): TemplateResult {
  return html`
    <table class="w-full text-sm">
      <tbody>
        ${settings.map(
          (s) => html`
            <tr class="border-b border-[var(--field-line)] last:border-b-0">
              <th
                scope="row"
                class="py-1.5 pr-4 text-left font-normal text-[var(--field-muted)]"
              >
                ${s.label.replace(/[:：\s]+$/u, "")}
              </th>
              <td class="py-1.5 text-right text-[var(--field-paper)]">
                ${s.value}
              </td>
            </tr>
          `,
        )}
      </tbody>
    </table>
  `;
}

/** Disabled units in the join view, beside the game settings. */
export function disabledUnitsTable(c: GameConfig): TemplateResult | null {
  if (!c.disabledUnits?.length) return null;
  return html`
    <table data-disabled-units class="lobby-briefing__units w-full text-sm">
      <caption>
        ${translateText("private_lobby.disabled_units")}<span
          >${c.disabledUnits.length}</span
        >
      </caption>
      <tbody>
        ${c.disabledUnits.map(
          (unit) => html`
            <tr>
              <th scope="row">
                ${DISABLED_UNIT_KEYS[unit]
                  ? translateText(DISABLED_UNIT_KEYS[unit])
                  : unit}
              </th>
              <td>${translateText("common.disabled")}</td>
            </tr>
          `,
        )}
      </tbody>
    </table>
  `;
}

/** The units the lobby turned off, as a red box; null when none are. */
export function disabledUnitsBox(
  c: GameConfig,
  className: string,
): TemplateResult | null {
  if (!c.disabledUnits?.length) return null;
  return html`
    <div
      data-disabled-units
      class="${className} p-3 bg-[var(--field-danger-soft)] rounded-md"
    >
      <div class="mb-2 text-xs font-medium text-[var(--field-danger)]">
        ${translateText("private_lobby.disabled_units")}
      </div>
      <div class="flex flex-wrap gap-2">
        ${c.disabledUnits.map((unit) => {
          const key = DISABLED_UNIT_KEYS[unit];
          return html`<span
            class="rounded-sm bg-[var(--field-raised)] px-2 py-1 text-xs text-[var(--field-paper)]"
            >${key ? translateText(key) : unit}</span
          >`;
        })}
      </div>
    </div>
  `;
}

/** The lobby host's cheats, as a yellow box; null when there are none. */
export function hostCheatsBox(
  c: GameConfig,
  className: string,
): TemplateResult | null {
  const hc = c.hostCheats;
  if (!hc) return null;
  const cheats: string[] = [];
  if (hc.infiniteGold)
    cheats.push(translateText("game_settings.infinite_gold"));
  if (hc.infiniteTroops)
    cheats.push(translateText("game_settings.infinite_troops"));
  if (hc.goldMultiplier)
    cheats.push(
      `${translateText("game_settings.gold_multiplier")}: x${hc.goldMultiplier}`,
    );
  if (hc.startingGold)
    cheats.push(
      `${translateText("private_lobby.starting_gold")}: ${millions(hc.startingGold)}`,
    );
  if (cheats.length === 0) return null;
  return html`
    <div
      data-host-cheats
      class="${className} p-3 bg-[var(--field-warning-soft)] rounded-md"
    >
      <div class="mb-2 text-xs font-medium text-[var(--field-warning)]">
        ${translateText("private_lobby.host_cheats")}
      </div>
      <div class="flex flex-wrap gap-2">
        ${cheats.map(
          (cheat) =>
            html`<span
              class="rounded-sm bg-[var(--field-raised)] px-2 py-1 text-xs text-[var(--field-paper)]"
              >${cheat}</span
            >`,
        )}
      </div>
    </div>
  `;
}
