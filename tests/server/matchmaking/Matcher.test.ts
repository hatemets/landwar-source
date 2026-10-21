import { describe, expect, it } from "vitest";
import {
  BASE_WINDOW,
  findMatches,
  MAX_WINDOW,
  type Ticket,
  windowFor,
} from "../../../src/server/matchmaking/matcher";

const t = (id: string, elo: number, joinedAt = 0): Ticket => ({
  userId: id,
  publicId: `pub-${id}`,
  elo,
  joinedAt,
});
const ids = (players: Ticket[]) => players.map((p) => p.userId).sort();

describe("windowFor", () => {
  it("starts tight, widens with the wait, and stops at a cap", () => {
    expect(windowFor(0)).toBe(BASE_WINDOW);
    expect(windowFor(10_000)).toBeGreaterThan(windowFor(5_000));
    expect(windowFor(10 * 60_000)).toBe(MAX_WINDOW);
    expect(windowFor(-5_000)).toBe(BASE_WINDOW);
  });
});

describe("findMatches 1v1", () => {
  it("pairs two players inside the window", () => {
    const m = findMatches([t("a", 1000), t("b", 1050)], "1v1", 0);
    expect(m).toHaveLength(1);
    expect(ids(m[0]!.players)).toEqual(["a", "b"]);
  });

  it("makes no match for one player", () => {
    expect(findMatches([t("a", 1000)], "1v1", 0)).toEqual([]);
  });

  it("keeps players far apart waiting, then lets the window grow", () => {
    const far = [t("a", 1000, 0), t("b", 1400, 0)];
    expect(findMatches(far, "1v1", 0)).toEqual([]);
    // 400 apart needs a window of 400: 100 + 20 per second, so 15 seconds.
    expect(findMatches(far, "1v1", 14_000)).toEqual([]);
    expect(findMatches(far, "1v1", 16_000)).toHaveLength(1);
  });

  it("pairs the nearest ratings and leaves the odd one out", () => {
    const m = findMatches(
      [t("a", 1000, 0), t("b", 1090, 1), t("c", 1010, 2)],
      "1v1",
      0,
    );
    expect(m).toHaveLength(1);
    // a is the longest waiter. c is nearer to a than b is.
    expect(ids(m[0]!.players)).toEqual(["a", "c"]);
  });

  it("never uses one player in two matches", () => {
    const m = findMatches(
      [t("a", 1000), t("b", 1010), t("c", 1020), t("d", 1030), t("e", 1040)],
      "1v1",
      0,
    );
    expect(m).toHaveLength(2);
    const all = m.flatMap((x) => ids(x.players));
    expect(new Set(all).size).toBe(4);
  });

  it("serves the longest waiter first", () => {
    const m = findMatches(
      [t("late", 1000, 5_000), t("early", 1000, 0), t("mid", 1000, 2_000)],
      "1v1",
      5_000,
    );
    expect(ids(m[0]!.players)).toEqual(["early", "mid"]);
  });
});
