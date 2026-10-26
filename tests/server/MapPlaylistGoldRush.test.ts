import {
  Difficulty,
  GameMode,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfigSchema } from "@openfront/engine-api/Schemas";
import { SCHEDULED_PUBLIC_GAME_TYPES } from "@openfront/shared/WireSchemas";
import { describe, expect, it, vi } from "vitest";
import {
  GOLD_RUSH_GOLD_MULTIPLIER,
  GOLD_RUSH_MAPS,
  GOLD_RUSH_NATION_DIFFICULTIES,
  GOLD_RUSH_STARTING_GOLD,
  MapPlaylist,
} from "../../src/server/MapPlaylist";

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => 1_000_000,
}));

describe("MapPlaylist gold rush games", () => {
  it("is a scheduled queue, so the master always keeps one open", () => {
    expect(SCHEDULED_PUBLIC_GAME_TYPES).toContain("goldrush");
  });

  it("gives every game a big land and sea map, 50M gold and x5 income", async () => {
    const playlist = new MapPlaylist();
    for (let i = 0; i < 20; i++) {
      const config = await playlist.gameConfig("goldrush");
      expect(GameConfigSchema.safeParse(config).success).toBe(true);
      expect(GOLD_RUSH_MAPS).toContain(config.gameMap);
      expect(config.gameMode).toBe(GameMode.FFA);
      expect(config.startingGold).toBe(GOLD_RUSH_STARTING_GOLD);
      expect(config.goldMultiplier).toBe(GOLD_RUSH_GOLD_MULTIPLIER);
      expect(config.publicGameModifiers?.startingGold).toBe(50_000_000);
      expect(config.publicGameModifiers?.goldMultiplier).toBe(5);
    }
  });

  it("alternates a no-missile game and a missile game with a nation roll", async () => {
    const playlist = new MapPlaylist();
    const noMissiles = await playlist.gameConfig("goldrush");
    expect(noMissiles.publicGameModifiers?.isNukesDisabled).toBe(true);
    expect(noMissiles.nations).toBe("default");
    expect(noMissiles.difficulty).toBe(Difficulty.Medium);
    for (const unit of [
      UnitType.MissileSilo,
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
      UnitType.MIRV,
    ]) {
      expect(noMissiles.disabledUnits).toContain(unit);
    }

    const withNations = await playlist.gameConfig("goldrush");
    expect(withNations.publicGameModifiers?.isNukesDisabled).toBeUndefined();
    expect(withNations.disabledUnits).toEqual([]);
    expect(withNations.nations).toBe("default");
    expect(GOLD_RUSH_NATION_DIFFICULTIES).toContain(withNations.difficulty);

    expect(
      (await playlist.gameConfig("goldrush")).publicGameModifiers
        ?.isNukesDisabled,
    ).toBe(true);
  });

  it("rolls nations from Medium to Impossible, never Easy", async () => {
    const random = vi.spyOn(Math, "random");
    try {
      const playlist = new MapPlaylist();
      const seen = new Set<Difficulty>();
      for (const roll of [0, 0.5, 0.99]) {
        await playlist.gameConfig("goldrush"); // the no-missile game
        random.mockReturnValue(roll);
        seen.add((await playlist.gameConfig("goldrush")).difficulty);
      }
      expect([...seen].sort()).toEqual(
        [Difficulty.Medium, Difficulty.Hard, Difficulty.Impossible].sort(),
      );
    } finally {
      random.mockRestore();
    }
  });
});
