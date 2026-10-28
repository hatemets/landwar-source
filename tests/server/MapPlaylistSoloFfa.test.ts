import { GameMode } from "@openfront/engine-api/game/GameTypes";
import {
  QUEUED_LOBBIES_PER_TYPE,
  SCHEDULED_PUBLIC_GAME_TYPES,
} from "@openfront/shared/WireSchemas";
import { describe, expect, it, vi } from "vitest";
import { MapPlaylist } from "../../src/server/MapPlaylist";

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => 2_000_000,
}));

describe("public free for all is solo", () => {
  it("hides names in every public FFA lobby the server makes", async () => {
    const playlist = new MapPlaylist();
    const configs = [
      await playlist.gameConfig("ffa"),
      await playlist.primeTimeConfig(),
      await playlist.openLobbyConfig(),
    ];
    for (const config of configs) {
      expect(config.gameMode).toBe(GameMode.FFA);
      expect(config.anonymizeNames).toBe(true);
    }
  });

  it("keeps names in team games, where teammates must find each other", async () => {
    const config = await new MapPlaylist().gameConfig("team");
    expect(config.gameMode).toBe(GameMode.Team);
    expect(config.anonymizeNames).toBeUndefined();
  });
});

describe("public queues", () => {
  it("schedules free for all only while the player base is small", () => {
    const running = SCHEDULED_PUBLIC_GAME_TYPES.filter(
      (type) => QUEUED_LOBBIES_PER_TYPE[type] > 0,
    );
    expect(running).toEqual(["ffa"]);
  });
});
