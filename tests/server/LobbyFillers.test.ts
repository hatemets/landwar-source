import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
  RankedType,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfig, UsernameSchema } from "@openfront/engine-api/Schemas";
import { describe, expect, it } from "vitest";
import {
  churnFillers,
  fillsSeats,
  FILLER_CHURN_MAX_MS,
  FILLER_CHURN_MIN_MS,
  nextChurnDelay,
  pickFillers,
  seatedFillers,
} from "../../src/server/LobbyFillers";

function config(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    gameMap: GameMapType.World,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Public,
    difficulty: Difficulty.Medium,
    nations: "default",
    donateGold: false,
    donateTroops: false,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    maxPlayers: 15,
    ...overrides,
  };
}

describe("pickFillers", () => {
  it("seats 4 or 5 players with valid, distinct names in scheduled lobbies", () => {
    for (const type of ["ffa", "team", "special", "goldrush"] as const) {
      for (let i = 0; i < 50; i++) {
        const fillers = pickFillers(config(), type);
        expect(fillers.length).toBeGreaterThanOrEqual(4);
        expect(fillers.length).toBeLessThanOrEqual(5);
        const names = fillers.map((f) => f.username);
        expect(new Set(names).size).toBe(names.length);
        for (const name of names) {
          expect(UsernameSchema.safeParse(name).success).toBe(true);
        }
      }
    }
  });

  it("gives open lobbies 0 to 5 fillers, often none", () => {
    const counts = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const fillers = pickFillers(config(), "hosted");
      expect(fillers.length).toBeLessThanOrEqual(5);
      counts.add(fillers.length);
    }
    expect(counts.has(0)).toBe(true);
    expect(counts.has(4)).toBe(true);
    expect(fillsSeats(config(), "hosted")).toBe(true);
  });

  it("never fills player-hosted, private, ranked or Humans vs Nations games", () => {
    expect(
      pickFillers(config({ gameType: GameType.Private }), "hosted"),
    ).toEqual([]);
    expect(fillsSeats(config({ gameType: GameType.Private }), "hosted")).toBe(
      false,
    );
    expect(pickFillers(config(), undefined)).toEqual([]);
    expect(
      pickFillers(config({ rankedType: RankedType.OneVOne }), "ffa"),
    ).toEqual([]);
    expect(
      pickFillers(config({ playerTeams: HumansVsNations }), "team"),
    ).toEqual([]);
  });

  it("stops when the random source repeats itself", () => {
    expect(pickFillers(config(), "ffa", () => 0.99)).toHaveLength(1);
  });

  it("leaves a seat free for a real player in a small lobby", () => {
    expect(pickFillers(config({ maxPlayers: 3 }), "ffa")).toHaveLength(2);
  });
});

describe("seatedFillers", () => {
  const fillers = pickFillers(config(), "ffa");

  it("keeps every filler while seats are free", () => {
    expect(seatedFillers(fillers, 3, 15)).toEqual(fillers);
  });

  it("gives up a filler's seat to each real player past the free seats", () => {
    expect(seatedFillers(fillers, 12, 15)).toEqual(
      fillers.slice(0, Math.min(fillers.length, 3)),
    );
    expect(seatedFillers(fillers, 15, 15)).toEqual([]);
  });
});

describe("churnFillers", () => {
  it("waits 18 to 30 seconds between changes, two or three a minute", () => {
    expect(nextChurnDelay(() => 0)).toBe(FILLER_CHURN_MIN_MS);
    expect(nextChurnDelay(() => 0.999999)).toBe(FILLER_CHURN_MAX_MS);
    const meanMs = (FILLER_CHURN_MIN_MS + FILLER_CHURN_MAX_MS) / 2;
    expect(60_000 / meanMs).toBeGreaterThanOrEqual(2);
    expect(60_000 / meanMs).toBeLessThanOrEqual(3);
  });

  it("changes the roster by exactly one filler", () => {
    let fillers = pickFillers(config(), "ffa");
    for (let i = 0; i < 200; i++) {
      const next = churnFillers(fillers, 15);
      expect(Math.abs(next.length - fillers.length)).toBe(1);
      const names = next.map((f) => f.username);
      expect(new Set(names).size).toBe(names.length);
      fillers = next;
    }
  });

  it("keeps the seated fillers in place when one joins", () => {
    const fillers = pickFillers(config(), "ffa");
    // 0.1 < 0.5 picks a join.
    const next = churnFillers(fillers.slice(0, 3), 15, () => 0.1);
    expect(next.slice(0, 3)).toEqual(fillers.slice(0, 3));
    expect(next).toHaveLength(4);
    expect(UsernameSchema.safeParse(next[3]!.username).success).toBe(true);
  });

  it("stays between 2 and 7 fillers", () => {
    let fillers = pickFillers(config({ maxPlayers: 50 }), "ffa");
    for (let i = 0; i < 1000; i++) {
      fillers = churnFillers(fillers, 50);
      expect(fillers.length).toBeGreaterThanOrEqual(2);
      expect(fillers.length).toBeLessThanOrEqual(7);
    }
  });

  it("leaves a seat free for a real player in a small lobby", () => {
    let fillers = pickFillers(config({ maxPlayers: 4 }), "ffa");
    for (let i = 0; i < 100; i++) {
      fillers = churnFillers(fillers, 4);
      expect(fillers.length).toBeLessThanOrEqual(3);
    }
  });
});
