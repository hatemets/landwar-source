import { TileRef } from "@openfront/engine-api/game/GameMap";

/**
 * Gold the local player earned at each of their structures, from the
 * simulation's BonusEvents: a trade ship arriving at a port or a train
 * stopping at a station pays out at that structure's tile. The hover panel
 * reads it, so a player can see which port or station earns and which is
 * dead, without guessing at the trade formula.
 *
 * Time is in game ticks (10 per second), like GoldRateTracker, so a paused
 * game reads the same rate instead of decaying.
 */

const TICKS_PER_MINUTE = 10 * 60;
/** The rate window, the same 2 in-game minutes as the income panel. */
export const STRUCTURE_INCOME_WINDOW_TICKS = 2 * TICKS_PER_MINUTE;

interface Payout {
  tick: number;
  gold: number;
}

interface TileIncome {
  total: number;
  recent: Payout[];
}

export class StructureIncome {
  private readonly tiles = new Map<TileRef, TileIncome>();
  private lastTick = -1;

  record(tile: TileRef, gold: number, tick: number): void {
    // The clock went back (the replay viewer seeked backward): the payouts
    // recorded so far are from a later point in the game.
    if (tick < this.lastTick) this.tiles.clear();
    this.lastTick = tick;
    let income = this.tiles.get(tile);
    if (income === undefined) {
      income = { total: 0, recent: [] };
      this.tiles.set(tile, income);
    }
    income.total += gold;
    income.recent.push({ tick, gold });
    this.evict(income, tick);
  }

  /** Gold per minute earned at the tile, averaged over the window. */
  perMin(tile: TileRef, tick: number): number {
    const income = this.tiles.get(tile);
    if (income === undefined) return 0;
    this.evict(income, tick);
    let sum = 0;
    for (const p of income.recent) sum += p.gold;
    return (sum * TICKS_PER_MINUTE) / STRUCTURE_INCOME_WINDOW_TICKS;
  }

  /** Gold earned at the tile since it was first recorded this game. */
  total(tile: TileRef): number {
    return this.tiles.get(tile)?.total ?? 0;
  }

  reset(): void {
    this.tiles.clear();
    this.lastTick = -1;
  }

  private evict(income: TileIncome, tick: number): void {
    const cutoff = tick - STRUCTURE_INCOME_WINDOW_TICKS;
    let drop = 0;
    while (drop < income.recent.length && income.recent[drop].tick <= cutoff) {
      drop++;
    }
    if (drop > 0) income.recent.splice(0, drop);
  }
}
