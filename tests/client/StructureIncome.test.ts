import { describe, expect, it } from "vitest";
import {
  STRUCTURE_INCOME_WINDOW_TICKS,
  StructureIncome,
} from "../../src/client/view/StructureIncome";

describe("StructureIncome", () => {
  it("averages a tile's payouts over the window, per minute", () => {
    const income = new StructureIncome();
    income.record(7, 60_000, 100);
    income.record(7, 60_000, 200);
    // 120k over a 2-minute window.
    expect(income.perMin(7, 300)).toBe(60_000);
    expect(income.perMin(8, 300)).toBe(0);
  });

  it("drops payouts older than the window but keeps the game total", () => {
    const income = new StructureIncome();
    income.record(7, 50_000, 100);
    income.record(7, 30_000, 500);
    expect(income.perMin(7, 100 + STRUCTURE_INCOME_WINDOW_TICKS)).toBe(15_000);
    expect(income.perMin(7, 500 + STRUCTURE_INCOME_WINDOW_TICKS)).toBe(0);
    expect(income.total(7)).toBe(80_000);
  });

  it("starts over when the clock goes back (replay seek)", () => {
    const income = new StructureIncome();
    income.record(7, 50_000, 900);
    income.record(9, 10_000, 100);
    expect(income.total(7)).toBe(0);
    expect(income.total(9)).toBe(10_000);
  });
});
