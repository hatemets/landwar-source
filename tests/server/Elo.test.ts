import { describe, expect, it } from "vitest";
import { eloDeltas, START_ELO } from "../../src/server/stats/elo";

const p = (id: string, placement: number, elo = START_ELO) => ({
  id,
  placement,
  elo,
});

describe("eloDeltas", () => {
  it("gives a duel between equals sixteen points", () => {
    const d = eloDeltas([p("a", 1), p("b", 2)]);
    expect(d.get("a")).toBe(16);
    expect(d.get("b")).toBe(-16);
  });

  it("is zero-sum before rounding for any lobby", () => {
    const d = eloDeltas([p("a", 1), p("b", 2), p("c", 3), p("d", 4)]);
    const total = [...d.values()].reduce((x, y) => x + y, 0);
    expect(Math.abs(total)).toBeLessThanOrEqual(2);
    expect(d.get("a")!).toBeGreaterThan(d.get("b")!);
    expect(d.get("b")!).toBeGreaterThan(d.get("c")!);
    expect(d.get("c")!).toBeGreaterThan(d.get("d")!);
  });

  it("rewards an upset more than an expected win", () => {
    const upset = eloDeltas([p("low", 1, 800), p("high", 2, 1200)]);
    const expected = eloDeltas([p("high", 1, 1200), p("low", 2, 800)]);
    expect(upset.get("low")!).toBeGreaterThan(expected.get("high")!);
  });

  it("does not move a tie between equals", () => {
    const d = eloDeltas([p("a", 1), p("b", 1)]);
    expect(d.get("a")).toBe(0);
    expect(d.get("b")).toBe(0);
  });

  it("does nothing for one player", () => {
    expect(eloDeltas([p("a", 1)]).get("a")).toBe(0);
  });
});
