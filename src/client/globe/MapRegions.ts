import {
  GameMapType,
  maps,
  type MapCategory,
} from "@openfront/engine-api/game/GameTypes";

/** A part of the real world that maps can show; a map picker category. */
export type MapRegion = Extract<
  MapCategory,
  | "europe"
  | "asia"
  | "africa"
  | "north_america"
  | "south_america"
  | "oceania"
  | "antarctica"
>;

/** Where each region's pin stands on the globe, in degrees. */
export const REGION_ANCHORS: Record<MapRegion, { lat: number; lon: number }> = {
  europe: { lat: 50, lon: 12 },
  asia: { lat: 48, lon: 92 },
  africa: { lat: 5, lon: 21 },
  north_america: { lat: 44, lon: -100 },
  south_america: { lat: -14, lon: -60 },
  oceania: { lat: -25, lon: 134 },
  antarctica: { lat: -76, lon: 30 },
};

export const MAP_REGIONS = Object.keys(REGION_ANCHORS) as MapRegion[];

const isRegion = (c: MapCategory): c is MapRegion => c in REGION_ANCHORS;

/**
 * Regions of each real-world map. Fictional maps carry a region category for
 * the map picker, but they show no real place, so they have none here.
 */
const regionsByMap = new Map<string, readonly MapRegion[]>(
  maps.map((m) => [
    m.type,
    m.categories.includes("fictional") ? [] : m.categories.filter(isRegion),
  ]),
);

/** The real-world regions a map shows; empty for fictional and world maps. */
export function mapRegions(
  map: GameMapType | string | undefined,
): readonly MapRegion[] {
  return regionsByMap.get(map ?? "") ?? [];
}

/** One pin on the globe: a region and how many lobbies play there. */
export interface GlobeRegionPin {
  region: MapRegion;
  label: string;
  count: number;
  selected: boolean;
}
