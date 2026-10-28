import {
  GameMode,
  GameType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfigSchema } from "@openfront/engine-api/Schemas";
import { describe, expect, it, vi } from "vitest";
import {
  MapPlaylist,
  OPEN_LOBBY_ECONOMIES,
  PRIME_TIME_MAPS,
} from "../../src/server/MapPlaylist";

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => 4_000_000,
}));

// The server-run lobbies in the Join Lobby list.
describe("MapPlaylist open lobbies", () => {
  it("is a small free for all on a real-world map with a rich economy", async () => {
    const playlist = new MapPlaylist();
    for (let i = 0; i < 30; i++) {
      const config = await playlist.openLobbyConfig();
      expect(GameConfigSchema.safeParse(config).success).toBe(true);
      expect(config.gameType).toBe(GameType.Public);
      expect(config.gameMode).toBe(GameMode.FFA);
      expect(PRIME_TIME_MAPS).toContain(config.gameMap);
      expect(config.goldMultiplier).toBeGreaterThanOrEqual(5);
      expect(config.startingGold).toBeGreaterThanOrEqual(5_000_000);
      expect(config.publicGameModifiers?.goldMultiplier).toBe(
        config.goldMultiplier,
      );
      expect(config.publicGameModifiers?.startingGold).toBe(
        config.startingGold,
      );
      expect(config.maxPlayers).toBeGreaterThanOrEqual(10);
      expect(config.maxPlayers).toBeLessThanOrEqual(20);
    }
  });

  it("steps through the economies, half of them without missiles", async () => {
    const playlist = new MapPlaylist();
    let noMissiles = 0;
    for (const economy of OPEN_LOBBY_ECONOMIES) {
      const config = await playlist.openLobbyConfig();
      expect(config.startingGold).toBe(economy.startingGold);
      expect(config.goldMultiplier).toBe(economy.goldMultiplier);
      if (economy.noMissiles) {
        noMissiles++;
        expect(config.publicGameModifiers?.isNukesDisabled).toBe(true);
        expect(config.disabledUnits).toContain(UnitType.MissileSilo);
        expect(config.disabledUnits).toContain(UnitType.AtomBomb);
      } else {
        expect(config.disabledUnits).toEqual([]);
      }
    }
    expect(noMissiles * 2).toBe(OPEN_LOBBY_ECONOMIES.length);
  });

  it("uses each real-world map once before it repeats one", async () => {
    const playlist = new MapPlaylist();
    const maps = new Set();
    for (let i = 0; i < PRIME_TIME_MAPS.length; i++) {
      maps.add((await playlist.openLobbyConfig()).gameMap);
    }
    expect(maps.size).toBe(PRIME_TIME_MAPS.length);
  });
});
