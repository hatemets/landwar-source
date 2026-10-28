import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { SCHEDULED_PUBLIC_GAME_TYPES } from "@openfront/shared/WireSchemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOBBY_SIZES, MapPlaylist } from "../../src/server/MapPlaylist";

const land = vi.hoisted(() => ({ tiles: 0 }));

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => land.tiles,
}));

type PlaylistInternals = {
  lobbyMaxPlayers(map: GameMapType, isCompactMap?: boolean): Promise<number>;
  getCrowdedMaxPlayers(
    map: GameMapType,
    isCompact: boolean,
  ): Promise<number | undefined>;
};

const playlist = () => new MapPlaylist() as unknown as PlaylistInternals;

describe("MapPlaylist lobby sizes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps lobbies at 10 to 20 players", async () => {
    // The Box: 4,194,304 land tiles -> tiers 210/160/105.
    land.tiles = 4_194_304;
    const random = vi.spyOn(Math, "random");
    const sizes: number[] = [];
    for (let i = 0; i < LOBBY_SIZES.length; i++) {
      random.mockReturnValue((i + 0.5) / LOBBY_SIZES.length);
      sizes.push(await playlist().lobbyMaxPlayers(GameMapType.TheBox));
    }
    expect(sizes).toEqual([...LOBBY_SIZES]);
    expect(Math.min(...sizes)).toBe(10);
    expect(Math.max(...sizes)).toBe(20);
  });

  it("keeps a small map's own cap", async () => {
    // 200,000 land tiles -> a cap of 10, and 3 on a compact map.
    land.tiles = 200_000;
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect(await playlist().lobbyMaxPlayers(GameMapType.World)).toBe(10);
    expect(await playlist().lobbyMaxPlayers(GameMapType.World, true)).toBe(3);
  });

  it("makes every scheduled lobby 20 players or fewer", async () => {
    land.tiles = 4_194_304;
    const p = new MapPlaylist();
    for (const type of SCHEDULED_PUBLIC_GAME_TYPES) {
      for (let i = 0; i < 60; i++) {
        const config = await p.gameConfig(type);
        expect(config.maxPlayers).toBeLessThanOrEqual(20);
      }
    }
  });

  it("keeps the crowded modifier at 125 / 60 players on small maps", async () => {
    land.tiles = 1_000_000;
    expect(
      await playlist().getCrowdedMaxPlayers(GameMapType.World, false),
    ).toBe(125);
    expect(await playlist().getCrowdedMaxPlayers(GameMapType.World, true)).toBe(
      60,
    );
  });
});
