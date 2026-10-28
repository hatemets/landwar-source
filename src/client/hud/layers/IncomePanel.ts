import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { renderNumber } from "@openfront/engine-lib/Format";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { translateText } from "../../Utils";
import { GameView } from "../../view";
import { GoldRateTracker } from "./lib/GoldRateTracker";
import { PanelDrag } from "./lib/PanelDrag";

const POS_KEY = "incomePanelPos";

interface Row {
  labelKey: string;
  // Units that earn this income, shown next to the label. null: no count.
  count: number | null;
  perMin: number;
  total: number;
}

// Draggable panel (below the bulk buy panel by default) that splits the local
// player's gold income by source: gold per minute, averaged over the last two
// in-game minutes, and the gold each source has made this game.
@customElement("income-panel")
export class IncomePanel extends LitElement implements Controller {
  public game: GameView;

  @state() private rows: Row[] = [];
  @state() private visible = false;

  private readonly tracker = new GoldRateTracker();
  private readonly drag = new PanelDrag(this, POS_KEY, ".income-panel");
  private mySmallID: number | null = null;
  private lastKey = "";

  createRenderRoot() {
    return this;
  }

  init() {}

  getTickIntervalMs() {
    return 500;
  }

  tick() {
    const me = this.game?.myPlayer();
    if (!me || !me.isAlive() || this.game.inSpawnPhase()) {
      this.visible = false;
      return;
    }
    const id = me.smallID();
    // A new game in the same page: the old samples are not this player's.
    if (id !== this.mySmallID) {
      this.tracker.resetAll();
      this.mySmallID = id;
    }
    const income = me.goldEarned();
    const trade = me.tradeGold();
    const train = me.trainGold();
    const piracy = me.piracyGold();
    const reactor = me.reactorGold();
    this.tracker.record(
      id,
      { income, trade, train, piracy, reactor },
      this.game.ticks(),
    );

    const t = this.tracker;
    const incomePerMin = t.goldIncomePerMin(id);
    const sourcesPerMin =
      t.shipTradeGoldPerMin(id) +
      t.trainTradeGoldPerMin(id) +
      t.piracyGoldPerMin(id) +
      t.reactorGoldPerMin(id);
    const count = (type: UnitType) =>
      me.units(type).filter((u) => !u.isUnderConstruction()).length;

    const rows: Row[] = [
      {
        labelKey: "income_panel.ports",
        count: count(UnitType.Port),
        perMin: t.shipTradeGoldPerMin(id),
        total: trade,
      },
      {
        labelKey: "income_panel.trains",
        count: count(UnitType.Factory),
        perMin: t.trainTradeGoldPerMin(id),
        total: train,
      },
      {
        labelKey: "income_panel.reactors",
        count: count(UnitType.Reactor),
        perMin: t.reactorGoldPerMin(id),
        total: reactor,
      },
      {
        labelKey: "income_panel.piracy",
        count: null,
        perMin: t.piracyGoldPerMin(id),
        total: piracy,
      },
      {
        // Workers, conquest and donations: whatever the other rows miss.
        labelKey: "income_panel.other",
        count: null,
        perMin: Math.max(0, incomePerMin - sourcesPerMin),
        total: Math.max(0, income - trade - train - piracy - reactor),
      },
    ];
    const config = this.game.config();
    const shown = rows.filter(
      (r) =>
        r.labelKey !== "income_panel.reactors" ||
        !config.isUnitDisabled(UnitType.Reactor),
    );
    shown.push({
      labelKey: "income_panel.total",
      count: null,
      perMin: incomePerMin,
      total: income,
    });

    this.visible = true;
    const key = shown
      .map((r) => `${r.count}:${fmt(r.perMin)}:${fmt(r.total)}`)
      .join("|");
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.rows = shown;
  }

  render() {
    if (!this.visible) return html``;
    const place = this.drag.style("left:12px;top:calc(50% + 140px);");
    const body = this.rows.slice(0, -1);
    const total = this.rows[this.rows.length - 1];
    return html`
      <div
        class="income-panel fixed z-[1000] w-60 rounded-lg bg-gray-900/95 text-sm text-gray-100 select-none"
        style=${place}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class="grid cursor-move grid-cols-[1fr_auto_auto] gap-x-3 px-4 pt-3 pb-2 touch-none"
          @pointerdown=${this.drag.handlers.pointerdown}
          @pointermove=${this.drag.handlers.pointermove}
          @pointerup=${this.drag.handlers.pointerup}
          @pointercancel=${this.drag.handlers.pointercancel}
        >
          <span class="font-semibold"
            >${translateText("income_panel.title")}</span
          >
          <span
            class="text-right text-xs text-gray-400"
            title=${translateText("income_panel.per_min_hint")}
            >${translateText("income_panel.per_min")}</span
          >
          <span class="text-right text-xs text-gray-400"
            >${translateText("income_panel.total_made")}</span
          >
        </div>
        <div
          class="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1.5 px-4 pb-3 tabular-nums"
        >
          ${body.map(
            (r) => html`
              <span class=${r.total > 0 ? "" : "text-gray-500"}
                >${translateText(r.labelKey)}${r.count !== null
                  ? html`<span class="text-xs text-gray-400">
                      · ${r.count}</span
                    >`
                  : ""}</span
              >
              <span class="text-right">${fmt(r.perMin)}</span>
              <span class="text-right text-gray-400">${fmt(r.total)}</span>
            `,
          )}
          <span class="mt-1 border-t border-gray-700 pt-1.5 font-semibold"
            >${translateText(total.labelKey)}</span
          >
          <span
            class="mt-1 border-t border-gray-700 pt-1.5 text-right font-semibold"
            >${fmt(total.perMin)}</span
          >
          <span
            class="mt-1 border-t border-gray-700 pt-1.5 text-right text-gray-400"
            >${fmt(total.total)}</span
          >
        </div>
      </div>
    `;
  }
}

function fmt(n: number): string {
  return renderNumber(Math.round(n));
}
