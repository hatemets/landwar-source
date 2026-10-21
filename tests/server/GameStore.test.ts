import { describe, expect, test } from "vitest";
import { summarizeRecord } from "../../src/server/GameStore";
import { sampleRecord } from "./GameStore.fixture";

const WINNER = "0b0f6d52-2d2e-4a43-8d3d-6f6a5c1f2a01";
const LOSER = "0b0f6d52-2d2e-4a43-8d3d-6f6a5c1f2a02";

describe("summarizeRecord", () => {
  const record = sampleRecord("abCD1234", { winner: WINNER, loser: LOSER });
  const summary = summarizeRecord(record, new Set([WINNER, LOSER]));

  test("maps the game row", () => {
    expect(summary).toMatchObject({
      id: "abCD1234",
      map: "Africa",
      mode: "Free For All",
      playerCount: 3,
      durationMs: 60000,
      winnerUserId: WINNER,
    });
  });

  test("ranks the winner, then survivors, then the eliminated", () => {
    expect(summary.players.map((p) => p.placement)).toEqual([1, 2, 3]);
    expect(summary.players.map((p) => p.won)).toEqual([true, false, false]);
  });

  test("links accounts and leaves a guest unlinked", () => {
    expect(summary.players.map((p) => p.userId)).toEqual([WINNER, null, LOSER]);
  });

  test("counts the winner's stats", () => {
    expect(summary.players[0]).toMatchObject({
      buildingsBuilt: 3,
      goldCollected: 150,
      troopsSent: 500,
      attacks: 2,
      kills: 1,
      losses: 0,
      unitsBuilt: 6,
      nukesBuilt: 2,
      nukesDestroyed: 1,
      territoryPeak: 900,
      territoryFinal: 800,
    });
  });

  test("marks an eliminated player as a loss", () => {
    expect(summary.players[2]).toMatchObject({ losses: 1, kills: 0 });
  });

  test("a team win credits every winner listed", () => {
    const team = {
      ...record,
      info: { ...record.info, winner: ["team", "Red", "clientBB", "clientCC"] },
    } as typeof record;
    const result = summarizeRecord(team, new Set([WINNER, LOSER]));
    expect(result.players.map((p) => p.won)).toEqual([false, true, true]);
    expect(result.winnerUserId).toBe(LOSER);
  });

  test("a game with no winner stores no winner", () => {
    const none = {
      ...record,
      info: { ...record.info, winner: undefined },
    } as typeof record;
    const result = summarizeRecord(none, new Set([WINNER, LOSER]));
    expect(result.winnerUserId).toBeNull();
    expect(result.players.every((p) => !p.won)).toBe(true);
  });
});
