import {
  BULK_UPGRADE_TYPES,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { renderNumber } from "@openfront/engine-lib/Format";
import { EventBus } from "@openfront/shared/EventBus";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { SendMaxUpgradeIntentEvent } from "../../Transport";
import { GameView } from "../../view";
import { PanelDrag } from "./lib/PanelDrag";

const POS_KEY = "bulkBuyPanelPos";
const LABELS: Partial<Record<UnitType, string>> = {
  [UnitType.City]: "Cities",
  [UnitType.Port]: "Ports",
  [UnitType.Factory]: "Factories",
  [UnitType.SAMLauncher]: "SAMs",
  [UnitType.MissileSilo]: "Missile silos",
};
// A buy shows "no gold" if no level lands within this many ms.
const RESULT_TIMEOUT_MS = 3000;

interface Row {
  type: UnitType;
  count: number;
  levels: number;
  enabled: boolean;
}

interface Pending {
  types: readonly UnitType[];
  levels: number;
  sentAt: number;
}

// Draggable panel (center left by default) that spends all gold on upgrades
// in one max_upgrade intent. The engine prices and applies every level, so a
// click costs one message and one tick, whatever the amount.
@customElement("bulk-buy-panel")
export class BulkBuyPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state() private rows: Row[] = [];
  @state() private gold = 0n;
  @state() private visible = false;
  @state() private message = "";

  private pending: Pending | null = null;
  private lastKey = "";
  private readonly drag = new PanelDrag(this, POS_KEY, ".bulk-buy-panel");

  createRenderRoot() {
    return this;
  }

  init() {}

  getTickIntervalMs() {
    return 250;
  }

  tick() {
    const me = this.game?.myPlayer();
    const visible = !!me && me.isAlive() && !this.game.inSpawnPhase();
    if (!visible || !me) {
      this.visible = false;
      return;
    }
    const config = this.game.config();
    const units = me.units(...BULK_UPGRADE_TYPES);
    const rows = BULK_UPGRADE_TYPES.map((type) => {
      let count = 0;
      let levels = 0;
      for (const u of units) {
        if (u.type() !== type || u.isUnderConstruction()) continue;
        count++;
        levels += u.level();
      }
      return { type, count, levels, enabled: !config.isUnitDisabled(type) };
    });
    this.resolvePending(rows);

    // Re-render only when something shown has changed.
    const gold = me.gold();
    const key = `${gold}|${rows.map((r) => `${r.count}:${r.levels}`).join(",")}`;
    this.visible = true;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.rows = rows;
    this.gold = gold;
  }

  private resolvePending(rows: Row[]) {
    const p = this.pending;
    if (p === null) return;
    const now = sumLevels(rows, p.types);
    if (now > p.levels) {
      this.message = `+${now - p.levels} levels`;
      this.pending = null;
    } else if (performance.now() - p.sentAt > RESULT_TIMEOUT_MS) {
      this.message = "Not enough gold";
      this.pending = null;
    }
  }

  private buy(types: readonly UnitType[]) {
    const owned = types.filter((t) =>
      this.rows.some((r) => r.type === t && r.enabled && r.count > 0),
    );
    if (owned.length === 0) {
      this.message = "Nothing to upgrade";
      return;
    }
    this.pending = {
      types: owned,
      levels: sumLevels(this.rows, owned),
      sentAt: performance.now(),
    };
    this.message = "Buying…";
    this.eventBus.emit(new SendMaxUpgradeIntentEvent(owned));
  }

  render() {
    if (!this.visible) return html``;
    // Default: center of the left edge.
    const place = this.drag.style(
      "left:12px;top:50%;transform:translateY(-50%);",
    );
    const anyOwned = this.rows.some((r) => r.enabled && r.count > 0);
    return html`
      <div
        class="bulk-buy-panel fixed z-[1000] w-60 rounded-lg bg-gray-900/95 text-sm text-gray-100 select-none"
        style=${place}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class="flex cursor-move items-center justify-between px-4 pt-3 pb-2 font-semibold touch-none"
          @pointerdown=${this.drag.handlers.pointerdown}
          @pointermove=${this.drag.handlers.pointermove}
          @pointerup=${this.drag.handlers.pointerup}
          @pointercancel=${this.drag.handlers.pointercancel}
        >
          <span>Bulk buy</span>
          <span class="font-normal tabular-nums text-gray-400"
            >${renderNumber(this.gold)} gold</span
          >
        </div>
        <div class="flex flex-col px-2 pb-3">
          ${this.rows
            .filter((r) => r.enabled)
            .map(
              (r) => html`
                <button
                  class="flex h-9 items-center justify-between rounded-md px-2 text-left transition-colors duration-150 hover:bg-gray-800 disabled:cursor-not-allowed disabled:text-gray-500 disabled:hover:bg-transparent"
                  ?disabled=${r.count === 0}
                  title="Spend all gold on ${LABELS[
                    r.type
                  ]} upgrades, spread equally"
                  @click=${() => this.buy([r.type])}
                >
                  <span>Max ${LABELS[r.type]}</span>
                  <span class="text-xs tabular-nums text-gray-400"
                    >${r.count} · L${r.levels}</span
                  >
                </button>
              `,
            )}
          <button
            class="mx-2 mt-2 h-9 rounded-md bg-malibu-blue px-4 font-medium text-white transition-colors duration-150 hover:bg-aquarius disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500"
            ?disabled=${!anyOwned}
            title="Spend all gold on upgrades, spread equally over every building you own"
            @click=${() => this.buy(BULK_UPGRADE_TYPES)}
          >
            Max all, equal
          </button>
          ${this.message
            ? html`<div class="px-2 pt-2 text-xs text-gray-400">
                ${this.message}
              </div>`
            : ""}
        </div>
      </div>
    `;
  }
}

function sumLevels(rows: Row[], types: readonly UnitType[]): number {
  return rows.reduce((a, r) => (types.includes(r.type) ? a + r.levels : a), 0);
}
