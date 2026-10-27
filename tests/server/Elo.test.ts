import { describe, expect, it } from "vitest";
import {
  eloDeltas,
  START_ELO,
  teamEloDeltas,
} from "../../src/server/stats/elo";

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

describe("teamEloDeltas", () => {
  const m = (id: string, won: boolean, elo = START_ELO) => ({ id, won, elo });

  it("gives every member of even sides sixteen points", () => {
    const d = teamEloDeltas([
      m("a1", true),
      m("a2", true),
      m("a3", true),
      m("b1", false),
      m("b2", false),
      m("b3", false),
    ]);
    for (const id of ["a1", "a2", "a3"]) expect(d.get(id)).toBe(16);
    for (const id of ["b1", "b2", "b3"]) expect(d.get(id)).toBe(-16);
  });

  it("rates the sides by their mean Elo", () => {
    // Side a averages 1200 and side b 1000: an upset moves more points.
    const favourite = teamEloDeltas([
      m("a1", true, 1400),
      m("a2", true, 1000),
      m("b1", false),
      m("b2", false),
    ]);
    const upset = teamEloDeltas([
      m("a1", false, 1400),
      m("a2", false, 1000),
      m("b1", true),
      m("b2", true),
    ]);
    expect(favourite.get("a1")).toBe(favourite.get("a2"));
    expect(upset.get("b1")!).toBeGreaterThan(favourite.get("a1")!);
    expect(upset.get("a1")).toBe(-upset.get("b1")!);
  });

  it("rates nothing without a winner and a loser", () => {
    expect(teamEloDeltas([m("a", false), m("b", false)]).size).toBe(0);
    expect(teamEloDeltas([m("a", true), m("b", true)]).size).toBe(0);
  });
});
