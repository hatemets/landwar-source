import {
  Difficulty,
  GameMapType,
  MapCategory,
  mapCategoryOrder,
  MapInfo,
  maps,
} from "@openfront/engine-api/game/GameTypes";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { translateText } from "../../Utils";
import "./MapDisplay";

type MapTab = "featured" | "all";

// Featured grid order: ranked maps first (1 = first), unranked alphabetical.
const featuredMaps: MapInfo[] = maps
  .filter((m) => m.categories.includes("featured"))
  .sort(
    (a, b) =>
      (a.featuredRank ?? Number.MAX_SAFE_INTEGER) -
      (b.featuredRank ?? Number.MAX_SAFE_INTEGER),
  );

function mapsInCategory(category: MapCategory): MapInfo[] {
  return maps.filter((m) => m.categories.includes(category));
}

@customElement("map-picker")
export class MapPicker extends LitElement {
  @property({ type: String }) selectedMap: GameMapType = GameMapType.World;
  @property({ type: Boolean }) showMedals = false;
  @property({ type: String }) searchQuery = "";
  @property({ attribute: false }) mapWins: Map<GameMapType, Set<Difficulty>> =
    new Map();
  @property({ attribute: false }) onSelectMap?: (map: GameMapType) => void;
  @state() private activeTab: MapTab = "featured";
  @state() private expandedCategories: Set<string> = new Set();

  createRenderRoot() {
    return this;
  }

  private handleMapSelection(mapValue: GameMapType) {
    this.onSelectMap?.(mapValue);
  }

  private toggleCategory(categoryKey: string) {
    const expanded = new Set(this.expandedCategories);
    if (expanded.has(categoryKey)) {
      expanded.delete(categoryKey);
    } else {
      expanded.add(categoryKey);
    }
    this.expandedCategories = expanded;
  }

  private get allCategories(): MapCategory[] {
    return mapCategoryOrder.filter((categoryKey) => categoryKey !== "featured");
  }

  private toggleExpandAll() {
    this.expandedCategories =
      this.expandedCategories.size > 0
        ? new Set()
        : new Set(this.allCategories);
  }

  private get filteredMaps(): MapInfo[] {
    if (!this.searchQuery.trim()) return [];
    const query = this.searchQuery.trim().toLowerCase();
    return maps.filter((m) => {
      const name = translateText(m.translationKey).toLowerCase();
      const id = m.id.toLowerCase();
      return name.includes(query) || id.includes(query);
    });
  }

  private getWins(mapValue: GameMapType): Set<Difficulty> {
    return this.mapWins?.get(mapValue) ?? new Set();
  }

  private renderMapCard(map: MapInfo) {
    return html`
      <div
        @click=${() => this.handleMapSelection(map.type)}
        class="cursor-pointer"
      >
        <map-display
          .mapKey=${map.id}
          .selected=${this.selectedMap === map.type}
          .showMedals=${this.showMedals}
          .wins=${this.getWins(map.type)}
          .translation=${translateText(map.translationKey)}
        ></map-display>
      </div>
    `;
  }

  private renderMapGrid(mapList: MapInfo[]) {
    // Keyed by map so cards keep their identity when the list shifts
    // (e.g. the selected map gets prepended to the featured grid) —
    // positional reuse would leave stale thumbnails behind.
    return html`<div class="setup-map-grid">
      ${repeat(
        mapList,
        (map) => map.id,
        (map) => this.renderMapCard(map),
      )}
    </div>`;
  }

  private renderSectionHeading(label: string) {
    return html`<h4
      class="text-xs font-medium text-white/50 normal-case tracking-normal mb-2"
    >
      ${label}
    </h4>`;
  }

  private renderCategoryBar(categoryKey: MapCategory, mapList: MapInfo[]) {
    const expanded = this.expandedCategories.has(categoryKey);
    return html`<div class="w-full">
      <button
        type="button"
        aria-expanded=${expanded}
        @click=${() => this.toggleCategory(categoryKey)}
        class="w-full flex items-center justify-between gap-3 min-h-10 px-3 rounded-md transition-colors duration-150 ${expanded
          ? "bg-[var(--field-hover)]"
          : "bg-[var(--field-raised)] hover:bg-[var(--field-hover)]"}"
      >
        <span
          class="flex items-center gap-3 text-sm font-medium text-white normal-case tracking-normal"
        >
          <svg
            class="w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${expanded
              ? "rotate-90"
              : ""}"
            viewBox="0 0 12 12"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M4 2l5 4-5 4z" />
          </svg>
          ${translateText(`map_categories.${categoryKey}`)}
        </span>
        <span class="text-xs font-medium text-white/40">${mapList.length}</span>
      </button>
      ${expanded
        ? html`<div class="mt-3">${this.renderMapGrid(mapList)}</div>`
        : null}
    </div>`;
  }

  private renderFeaturedTab() {
    let featuredMapList = featuredMaps.slice(0, 3);
    const selected = maps.find((m) => m.type === this.selectedMap);
    if (selected !== undefined && !featuredMapList.includes(selected)) {
      featuredMapList = [selected, ...featuredMaps];
    }
    featuredMapList = featuredMapList.slice(0, 3);
    return html`<div class="w-full">
      ${this.renderSectionHeading(translateText("map_categories.featured"))}
      ${this.renderMapGrid(featuredMapList)}
    </div>`;
  }

  private renderAllTab() {
    return html`<div class="space-y-2">
      ${this.allCategories.map((categoryKey) =>
        this.renderCategoryBar(categoryKey, mapsInCategory(categoryKey)),
      )}
    </div>`;
  }

  private renderExpandToggle() {
    const anyExpanded = this.expandedCategories.size > 0;
    return html`<div class="shrink-0">
      <button
        type="button"
        aria-expanded=${anyExpanded}
        title=${anyExpanded
          ? translateText("common.collapse_all")
          : translateText("common.expand_all")}
        @click=${() => this.toggleExpandAll()}
        class="h-9 flex items-center gap-1.5 px-3 rounded-md bg-[var(--field-raised)] hover:bg-[var(--field-hover)] text-sm font-medium text-white/70 hover:text-white transition-colors duration-150"
      >
        <svg
          class="w-3 h-3 shrink-0 transition-transform duration-200 ${anyExpanded
            ? "rotate-180"
            : ""}"
          viewBox="0 0 12 12"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M2 4l4 5 4-5z" />
        </svg>
        <span class="hidden sm:inline">
          ${anyExpanded
            ? translateText("common.collapse_all")
            : translateText("common.expand_all")}
        </span>
      </button>
    </div>`;
  }

  private renderActiveTab() {
    switch (this.activeTab) {
      case "all":
        return this.renderAllTab();
      default:
        return this.renderFeaturedTab();
    }
  }

  private renderSearchResults() {
    const results = this.filteredMaps;
    if (results.length === 0) {
      return html`<div
        class="w-full flex flex-col items-center justify-center gap-3 py-12 px-4 text-center rounded-lg bg-[var(--field-raised)]"
      >
        <svg
          class="w-8 h-8 text-white/30"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
            clip-rule="evenodd"
          />
        </svg>
        <p class="text-sm text-white/50 leading-relaxed max-w-xs">
          ${translateText("map_component.no_results")}
        </p>
      </div>`;
    }
    return html`<div class="w-full">
      ${this.renderSectionHeading(
        `${translateText("map_component.search_results")} (${results.length})`,
      )}
      ${this.renderMapGrid(results)}
    </div>`;
  }

  private renderTabButton(tab: MapTab, label: string) {
    const isActive = this.activeTab === tab;
    return html`<button
      type="button"
      role="tab"
      aria-selected=${isActive}
      class="transition-colors"
      @click=${() => (this.activeTab = tab)}
    >
      ${label}
    </button>`;
  }

  render() {
    const isSearching = this.searchQuery.trim().length > 0;
    return html`
      <div class="space-y-8">
        <div class="setup-map-toolbar">
          ${isSearching
            ? null
            : html`<div
                  role="tablist"
                  aria-label="${translateText("map.map")}"
                  class="setup-map-tabs"
                >
                  ${this.renderTabButton(
                    "featured",
                    translateText("map.featured"),
                  )}
                  ${this.renderTabButton("all", translateText("map.all"))}
                </div>
                ${this.activeTab === "all" ? this.renderExpandToggle() : null}`}
        </div>
        ${isSearching ? this.renderSearchResults() : this.renderActiveTab()}
      </div>
    `;
  }
}
