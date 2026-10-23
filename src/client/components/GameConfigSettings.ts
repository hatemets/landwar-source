import {
  Difficulty,
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { TeamCountConfig } from "@openfront/engine-api/Schemas";
import {
  DOOMSDAY_CLOCK_SPEEDS,
  DoomsdayClockSpeed,
} from "@openfront/engine-lib/game/DoomsdayClock";
import { LitElement, TemplateResult, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { setMenuMap } from "../MenuBackdrop";
import { translateText } from "../Utils";
import "./FluentSlider";
import "./map/MapPicker";
import { menuIcon } from "./ui/MenuIcon";

const DIFFICULTY_OPTIONS = Object.entries(Difficulty).filter(([key]) =>
  isNaN(Number(key)),
) as Array<[string, Difficulty]>;
const TEAM_COUNT_OPTIONS: TeamCountConfig[] = [
  2,
  3,
  4,
  5,
  6,
  7,
  Quads,
  Trios,
  Duos,
  HumansVsNations,
];
let nextSettingsId = 0;
function section(
  title: string,
  content: TemplateResult,
  action?: TemplateResult,
) {
  return html`<section class="setup-section">
    <header class="setup-section__header">
      <h3>${translateText(title)}</h3>
      ${action ?? nothing}
    </header>
    ${content}
  </section>`;
}
function toggle(label: string, checked: boolean, onChange: () => void) {
  return html`<label class="setup-switch-row"
    ><span>${label}</span
    ><span class="setup-switch"
      ><input
        type="checkbox"
        role="switch"
        .checked=${checked}
        @change=${onChange}
        aria-label=${label} /><span
        class="setup-switch__track"
        aria-hidden="true"
      ></span></span
  ></label>`;
}
const unitOptions: { type: UnitType; translationKey: string }[] = [
  { type: UnitType.City, translationKey: "unit_type.city" },
  { type: UnitType.DefensePost, translationKey: "unit_type.defense_post" },
  { type: UnitType.Port, translationKey: "unit_type.port" },
  { type: UnitType.Warship, translationKey: "unit_type.warship" },
  { type: UnitType.TransportShip, translationKey: "unit_type.boat" },
  { type: UnitType.MissileSilo, translationKey: "unit_type.missile_silo" },
  { type: UnitType.SAMLauncher, translationKey: "unit_type.sam_launcher" },
  { type: UnitType.AtomBomb, translationKey: "unit_type.atom_bomb" },
  { type: UnitType.HydrogenBomb, translationKey: "unit_type.hydrogen_bomb" },
  { type: UnitType.MIRV, translationKey: "unit_type.mirv" },
  { type: UnitType.Factory, translationKey: "unit_type.factory" },
];

export interface ToggleOptionConfig {
  labelKey: string;
  checked: boolean;
  hidden?: boolean;
  // When set, this toggle's card expands to a pace dropdown while it is checked.
  doomsdayClockSpeed?: DoomsdayClockSpeed;
}

export interface GameConfigSettingsData {
  map: {
    selected: GameMapType;
    showMedals?: boolean;
    mapWins?: Map<GameMapType, Set<Difficulty>>;
  };
  difficulty: {
    selected: Difficulty;
    disabled: boolean;
  };
  gameMode: {
    selected: GameMode;
  };
  teamCount: {
    selected: TeamCountConfig;
  };
  options: {
    titleKey: string;
    bots: {
      value: number;
      labelKey: string;
      disabledKey: string;
    };
    nations?: {
      value: number;
      defaultValue?: number;
      labelKey: string;
      disabledKey: string;
      hidden?: boolean;
    };
    toggles: ToggleOptionConfig[];
    inputCards: TemplateResult[];
  };
  hostCheats?: {
    titleKey: string;
    visible: boolean;
    toggles: ToggleOptionConfig[];
    inputCards: TemplateResult[];
  };
  unitTypes: {
    titleKey: string;
    disabledUnits: UnitType[];
  };
}

@customElement("game-config-settings")
export class GameConfigSettings extends LitElement {
  @property({ attribute: false }) settings?: GameConfigSettingsData;
  @property({ attribute: false }) sectionGapClass = "";
  @state() private mapSearchQuery = "";
  private backdropMap?: GameMapType;
  private readonly modeGroupName = `setup-mode-${nextSettingsId++}`;
  createRenderRoot() {
    return this;
  }
  protected updated() {
    if (this.settings && this.backdropMap !== this.settings.map.selected) {
      this.backdropMap = this.settings.map.selected;
      setMenuMap(this.backdropMap);
    }
  }
  private emit<T>(name: string, detail: T) {
    this.dispatchEvent(
      new CustomEvent(name, { detail, bubbles: true, composed: true }),
    );
  }
  private renderMapSearch() {
    return html`<input
      class="setup-search"
      type="search"
      aria-label=${translateText("map_component.search_maps")}
      placeholder=${translateText("map_component.search_maps")}
      .value=${this.mapSearchQuery}
      @input=${(e: Event) => {
        this.mapSearchQuery = (e.target as HTMLInputElement).value;
      }}
    />`;
  }
  private renderDifficulty() {
    const setting = this.settings!.difficulty;
    const selected = Math.max(
      0,
      DIFFICULTY_OPTIONS.findIndex(([, value]) => value === setting.selected),
    );
    const choose = (index: number) => {
      if (!setting.disabled)
        this.emit("difficulty-selected", {
          difficulty: DIFFICULTY_OPTIONS[index][1],
        });
    };
    return html`<div
      class="setup-segmented ${setting.disabled ? "is-disabled" : ""}"
      role="group"
      aria-label=${translateText("difficulty.difficulty")}
    >
      ${DIFFICULTY_OPTIONS.map(
        ([key], index) =>
          html`<button
            type="button"
            class="setup-segmented__option ${selected === index
              ? "is-selected"
              : ""}"
            aria-pressed=${selected === index}
            ?disabled=${setting.disabled}
            @click=${() => choose(index)}
          >
            ${translateText(`difficulty.${key.toLowerCase()}`)}
          </button>`,
      )}
    </div>`;
  }
  private renderMode() {
    const settings = this.settings!;
    return html`<div
        class="setup-mode"
        role="radiogroup"
        aria-label=${translateText("host_modal.mode")}
      >
        ${[GameMode.FFA, GameMode.Team].map(
          (mode) =>
            html`<label class="setup-mode__option"
              ><input
                type="radio"
                name=${this.modeGroupName}
                .checked=${settings.gameMode.selected === mode}
                @change=${() => this.emit("game-mode-selected", { mode })}
              /><span
                >${translateText(
                  mode === GameMode.FFA ? "game_mode.ffa" : "game_mode.teams",
                )}</span
              ></label
            >`,
        )}
      </div>
      ${settings.gameMode.selected === GameMode.Team
        ? html`<label class="setup-number-row"
            ><span>${translateText("host_modal.team_count")}</span
            ><select
              aria-label=${translateText("host_modal.team_count")}
              @change=${(e: Event) => {
                const value = (e.target as HTMLSelectElement).value;
                this.emit("team-count-selected", {
                  count: TEAM_COUNT_OPTIONS.find((o) => String(o) === value)!,
                });
              }}
            >
              ${TEAM_COUNT_OPTIONS.map(
                (o) =>
                  html`<option
                    value=${String(o)}
                    ?selected=${settings.teamCount.selected === o}
                  >
                    ${typeof o === "string"
                      ? o === HumansVsNations
                        ? translateText("public_lobby.teams_hvn")
                        : translateText(`host_modal.teams_${o}`)
                      : translateText("public_lobby.teams", { num: o })}
                  </option>`,
              )}
            </select></label
          >`
        : nothing}`;
  }
  private renderOption(
    option: ToggleOptionConfig,
    host = false,
  ): TemplateResult | typeof nothing {
    if (option.hidden) return nothing;
    return html`<div class="setup-option">
      ${toggle(translateText(option.labelKey), option.checked, () =>
        this.emit(
          host ? "host-cheat-toggle-changed" : "option-toggle-changed",
          { labelKey: option.labelKey, checked: !option.checked },
        ),
      )}
      ${option.doomsdayClockSpeed !== undefined && option.checked
        ? html`<select
            class="setup-clock-speed"
            aria-label=${translateText(option.labelKey)}
            @change=${(e: Event) =>
              this.emit("doomsday-clock-speed-selected", {
                speed: (e.target as HTMLSelectElement)
                  .value as DoomsdayClockSpeed,
              })}
          >
            ${DOOMSDAY_CLOCK_SPEEDS.map(
              (speed) =>
                html`<option
                  value=${speed}
                  ?selected=${option.doomsdayClockSpeed === speed}
                >
                  ${translateText(`doomsday_clock_speed.${speed}`)}
                </option>`,
            )}
          </select>`
        : nothing}
    </div>`;
  }
  render() {
    const settings = this.settings;
    if (!settings) return nothing;
    return html`<div class="setup-form">
      ${section(
        "map.map",
        html`<map-picker
          .selectedMap=${settings.map.selected}
          .showMedals=${settings.map.showMedals ?? false}
          .mapWins=${settings.map.mapWins ?? new Map()}
          .onSelectMap=${(map: GameMapType) =>
            this.emit("map-selected", { map })}
          .searchQuery=${this.mapSearchQuery}
        ></map-picker>`,
        this.renderMapSearch(),
      )}
      <div class="setup-essentials">
        ${section("difficulty.difficulty", this.renderDifficulty())}
        ${section("host_modal.mode", this.renderMode())}
      </div>
      ${section(
        settings.options.titleKey,
        html`<div class="setup-population">
            <fluent-slider
              min="0"
              max="400"
              step="1"
              .value=${settings.options.bots.value}
              labelKey=${settings.options.bots.labelKey}
              disabledKey=${settings.options.bots.disabledKey}
              @value-changed=${(e: CustomEvent) =>
                this.emit("bots-changed", e.detail)}
            ></fluent-slider
            >${settings.options.nations && !settings.options.nations.hidden
              ? html`<fluent-slider
                  min="0"
                  max="400"
                  step="1"
                  .value=${settings.options.nations.value}
                  .defaultValue=${settings.options.nations.defaultValue}
                  defaultLabelKey="common.map_default"
                  labelKey=${settings.options.nations.labelKey}
                  disabledKey=${settings.options.nations.disabledKey}
                  @value-changed=${(e: CustomEvent) =>
                    this.emit("nations-changed", e.detail)}
                ></fluent-slider>`
              : nothing}
          </div>
          <div class="setup-switch-list">
            ${settings.options.toggles.map((o) => this.renderOption(o))}
          </div>
          <details class="setup-disclosure">
            <summary>
              <span>${translateText("landwar_ui.advanced_settings")}</span
              >${menuIcon("chevron-down")}
            </summary>
            <p class="setup-helper">
              ${translateText("landwar_ui.blank_default")}
            </p>
            <div class="setup-number-list">${settings.options.inputCards}</div>
          </details>`,
      )}
      ${settings.hostCheats?.visible
        ? section(
            settings.hostCheats.titleKey,
            html`<div class="setup-switch-list">
                ${settings.hostCheats.toggles.map((o) =>
                  this.renderOption(o, true),
                )}
              </div>
              <div class="setup-number-list">
                ${settings.hostCheats.inputCards}
              </div>`,
          )
        : nothing}
      <details class="setup-disclosure">
        <summary>
          <span>${translateText(settings.unitTypes.titleKey)}</span
          ><span class="setup-disclosure__detail"
            >${settings.unitTypes.disabledUnits.length
              ? translateText("landwar_ui.units_disabled", {
                  count: settings.unitTypes.disabledUnits.length,
                })
              : translateText("landwar_ui.all_units_available")}</span
          >${menuIcon("chevron-down")}
        </summary>
        <div class="setup-switch-list">
          ${unitOptions.map(({ type, translationKey }) =>
            toggle(
              translateText(translationKey),
              !settings.unitTypes.disabledUnits.includes(type),
              () =>
                this.emit("unit-toggle-changed", {
                  unit: type,
                  checked: !settings.unitTypes.disabledUnits.includes(type),
                }),
            ),
          )}
        </div>
      </details>
    </div>`;
  }
}
