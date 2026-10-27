import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, it, vi } from "vitest";
import { MapPlaylist } from "../../src/server/MapPlaylist";

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => 1_000_000,
}));

type Internals = {
  playlists: Record<string, GameMapType[]>;
  buildMapsList(type: string, mode: undefined, overrides: object): string[];
};

function internals(playlist: MapPlaylist): Internals {
  return playlist as unknown as Internals;
}

describe("MapPlaylist weight overrides", () => {
  // Pangaea, not World: the real-world maps have a rotation of their own.
  it("spreads an override over the build frequency", () => {
    const p = internals(new MapPlaylist());
    const count = (overrides: object) =>
      p
        .buildMapsList("ffa", undefined, overrides)
        .filter((m) => m === GameMapType.Pangaea).length;

    expect(count({ [GameMapType.Pangaea]: { ffaFrequency: 37 } })).toBe(37);
    expect(count({ [GameMapType.Pangaea]: { ffaFrequency: 0 } })).toBe(0);
    // A field for another queue leaves ffa on the build's value.
    expect(count({ [GameMapType.Pangaea]: { teamFrequency: 37 } })).toBe(
      count({}),
    );
  });

  it("drops queued playlists when the overrides change", async () => {
    const playlist = new MapPlaylist();
    // Skip the real-world rotation so the ticket playlist is built.
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    await playlist.gameConfig("ffa");
    random.mockRestore();
    const p = internals(playlist);
    expect(p.playlists.ffa.length).toBeGreaterThan(0);

    playlist.setWeightOverrides({});
    expect(p.playlists.ffa.length).toBeGreaterThan(0);

    playlist.setWeightOverrides({
      [GameMapType.Pangaea]: { ffaFrequency: 0 },
    });
    expect(p.playlists.ffa).toEqual([]);
  });

  it("stops serving a map pulled to 0", async () => {
    const playlist = new MapPlaylist();
    playlist.setWeightOverrides({ [GameMapType.World]: { ffaFrequency: 0 } });
    const queued = internals(playlist).playlists;
    const config = await playlist.gameConfig("ffa");
    expect(config.gameMap).not.toBe(GameMapType.World);
    expect(queued.ffa).not.toContain(GameMapType.World);
  });

  it("ignores overrides that would empty a queue", async () => {
    const playlist = new MapPlaylist();
    const allZero = Object.fromEntries(
      Object.values(GameMapType).map((m) => [m, { ffaFrequency: 0 }]),
    );
    playlist.setWeightOverrides(allZero);
    const config = await playlist.gameConfig("ffa");
    expect(config.gameMap).toBeDefined();
  });
});
