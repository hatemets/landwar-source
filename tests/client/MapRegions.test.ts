import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, it } from "vitest";
import { mapRegions } from "../../src/client/globe/MapRegions";

describe("mapRegions", () => {
  it("puts every map of a region in it, whatever its size", () => {
    expect(mapRegions(GameMapType.Europe)).toContain("europe");
    expect(mapRegions(GameMapType.EuropeClassic)).toContain("europe");
    expect(mapRegions(GameMapType.Britannia)).toContain("europe");
  });

  it("gives a map that spans regions to each of them", () => {
    expect(mapRegions(GameMapType.BlackSea)).toEqual(
      expect.arrayContaining(["europe", "asia"]),
    );
  });

  it("gives world, fictional and unknown maps no region", () => {
    expect(mapRegions(GameMapType.World)).toEqual([]);
    expect(mapRegions(GameMapType.Achiran)).toEqual([]);
    expect(mapRegions("Nowhere")).toEqual([]);
    expect(mapRegions(undefined)).toEqual([]);
  });
});
