import {
  Difficulty,
  GameMode,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfigSchema } from "@openfront/engine-api/Schemas";
import { SCHEDULED_PUBLIC_GAME_TYPES } from "@openfront/shared/WireSchemas";
import { describe, expect, it, vi } from "vitest";
import {
  GOLD_RUSH_ECONOMIES,
  GOLD_RUSH_MAPS,
  GOLD_RUSH_NATION_DIFFICULTIES,
  MapPlaylist,
} from "../../src/server/MapPlaylist";

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => 1_000_000,
}));

describe("MapPlaylist gold rush games", () => {
  it("is a scheduled queue, so the master always keeps one open", () => {
    expect(SCHEDULED_PUBLIC_GAME_TYPES).toContain("goldrush");
  });

  it("gives every game a big land and sea map, a 10M or 30M start and x5 or x10 income", async () => {
    const playlist = new MapPlaylist();
    for (let i = 0; i < 20; i++) {
      const config = await playlist.gameConfig("goldrush");
      expect(GameConfigSchema.safeParse(config).success).toBe(true);
      expect(GOLD_RUSH_MAPS).toContain(config.gameMap);
      expect(config.gameMode).toBe(GameMode.FFA);
      expect([10_000_000, 30_000_000]).toContain(config.startingGold);
      expect([5, 10]).toContain(config.goldMultiplier);
      expect(config.publicGameModifiers?.startingGold).toBe(
        config.startingGold,
      );
      expect(config.publicGameModifiers?.goldMultiplier).toBe(
        config.goldMultiplier,
      );
    }
  });

  it("runs each economy once without missiles and once with them", async () => {
    const playlist = new MapPlaylist();
    for (const economy of GOLD_RUSH_ECONOMIES) {
      const noMissiles = await playlist.gameConfig("goldrush");
      const missiles = await playlist.gameConfig("goldrush");
      for (const config of [noMissiles, missiles]) {
        expect(config.startingGold).toBe(economy.startingGold);
        expect(config.goldMultiplier).toBe(economy.goldMultiplier);
      }
      expect(noMissiles.publicGameModifiers?.isNukesDisabled).toBe(true);
      expect(missiles.publicGameModifiers?.isNukesDisabled).toBeUndefined();
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
