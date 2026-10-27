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
import { pickFillers, seatedFillers } from "../../src/server/LobbyFillers";

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

  it("never fills hosted, private, ranked or Humans vs Nations games", () => {
    expect(pickFillers(config(), "hosted")).toEqual([]);
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
