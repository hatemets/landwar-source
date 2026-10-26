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

/**
 * Where the globe turns to for each real-world map, in degrees. A map not
 * listed here falls back to its first region's anchor.
 */
const MAP_ANCHORS: Partial<Record<GameMapType, { lat: number; lon: number }>> =
  {
    [GameMapType.Aegean]: { lat: 38.5, lon: 25 },
    [GameMapType.Africa]: { lat: 3, lon: 20 },
    [GameMapType.Alps]: { lat: 46.5, lon: 10 },
    [GameMapType.AmazonRiver]: { lat: -3, lon: -60 },
    [GameMapType.Antarctica]: { lat: -78, lon: 30 },
    [GameMapType.ArchipelagoSea]: { lat: 60.2, lon: 21.5 },
    [GameMapType.Arctic]: { lat: 75, lon: -40 },
    [GameMapType.Asia]: { lat: 40, lon: 95 },
    [GameMapType.Australia]: { lat: -25, lon: 134 },
    [GameMapType.BabelMandebStrait]: { lat: 12.6, lon: 43.4 },
    [GameMapType.Baikal]: { lat: 53.5, lon: 108 },
    [GameMapType.BajaCalifornia]: { lat: 28, lon: -113 },
    [GameMapType.Balkans]: { lat: 43, lon: 21 },
    [GameMapType.Balkhash]: { lat: 46.5, lon: 75 },
    [GameMapType.Baltics]: { lat: 57, lon: 24 },
    [GameMapType.Benelux]: { lat: 51, lon: 5 },
    [GameMapType.BeringSea]: { lat: 58, lon: -178 },
    [GameMapType.BeringStrait]: { lat: 65.8, lon: -169 },
    [GameMapType.BetweenTwoSeas]: { lat: 43, lon: 42 },
    [GameMapType.BlackSea]: { lat: 43.5, lon: 34 },
    [GameMapType.BosphorusStraits]: { lat: 41, lon: 29 },
    [GameMapType.Britannia]: { lat: 54, lon: -3 },
    [GameMapType.BritanniaClassic]: { lat: 54, lon: -3 },
    [GameMapType.CanaryIslands]: { lat: 28.3, lon: -15.8 },
    [GameMapType.CapeCod]: { lat: 41.7, lon: -70.2 },
    [GameMapType.CapeOfGoodHope]: { lat: -34.3, lon: 18.5 },
    [GameMapType.Caribbean]: { lat: 17, lon: -72 },
    [GameMapType.CaspianSea]: { lat: 41.5, lon: 51 },
    [GameMapType.Caucasus]: { lat: 42.5, lon: 44 },
    [GameMapType.CentralAmerica]: { lat: 13, lon: -86 },
    [GameMapType.ChannelIslands]: { lat: 34, lon: -119.8 },
    [GameMapType.China]: { lat: 34, lon: 104 },
    [GameMapType.ClearwaterLakes]: { lat: 56.2, lon: -74.4 },
    [GameMapType.Conakry]: { lat: 9.6, lon: -13.7 },
    [GameMapType.Crimea]: { lat: 45.3, lon: 34.4 },
    [GameMapType.DanishStraits]: { lat: 55.7, lon: 11 },
    [GameMapType.EastAsia]: { lat: 35, lon: 120 },
    [GameMapType.Europe]: { lat: 50, lon: 12 },
    [GameMapType.EuropeClassic]: { lat: 50, lon: 12 },
    [GameMapType.FalklandIslands]: { lat: -51.7, lon: -59.5 },
    [GameMapType.FaroeIslands]: { lat: 62, lon: -6.9 },
    [GameMapType.FingerLakes]: { lat: 42.6, lon: -76.9 },
    [GameMapType.France]: { lat: 46.5, lon: 2.5 },
    [GameMapType.GatewayToTheAtlantic]: { lat: 48, lon: -5 },
    [GameMapType.Germany]: { lat: 51, lon: 10.4 },
    [GameMapType.GreatLakes]: { lat: 45, lon: -84 },
    [GameMapType.GulfOfGuinea]: { lat: 3, lon: 3 },
    [GameMapType.GulfOfMexico]: { lat: 25, lon: -90 },
    [GameMapType.GulfOfStLawrence]: { lat: 48, lon: -62 },
    [GameMapType.Halkidiki]: { lat: 40.3, lon: 23.5 },
    [GameMapType.Hawaii]: { lat: 20.5, lon: -157 },
    [GameMapType.Hecatestrait]: { lat: 53, lon: -130.5 },
    [GameMapType.HongKong]: { lat: 22.3, lon: 114.2 },
    [GameMapType.HornOfAfrica]: { lat: 8, lon: 45 },
    [GameMapType.Iceland]: { lat: 65, lon: -18.5 },
    [GameMapType.IndianSubcontinent]: { lat: 21, lon: 79 },
    [GameMapType.IrishSea]: { lat: 53.8, lon: -5 },
    [GameMapType.Italia]: { lat: 42.5, lon: 12.5 },
    [GameMapType.Japan]: { lat: 36.5, lon: 138 },
    [GameMapType.JuanDeFucaStrait]: { lat: 48.3, lon: -124 },
    [GameMapType.Korea]: { lat: 37.5, lon: 127.5 },
    [GameMapType.LasVegasStrip]: { lat: 36.1, lon: -115.2 },
    [GameMapType.Lemnos]: { lat: 39.9, lon: 25.2 },
    [GameMapType.Levant]: { lat: 33, lon: 36 },
    [GameMapType.Lisbon]: { lat: 38.7, lon: -9.1 },
    [GameMapType.LosAngeles]: { lat: 34, lon: -118.3 },
    [GameMapType.Madagascar]: { lat: -19, lon: 46.7 },
    [GameMapType.Manicouagan]: { lat: 51.4, lon: -68.7 },
    [GameMapType.MareNostrum]: { lat: 38, lon: 15 },
    [GameMapType.Mena]: { lat: 28, lon: 25 },
    [GameMapType.MiddleEast]: { lat: 29, lon: 45 },
    [GameMapType.MississippiRiver]: { lat: 35, lon: -90 },
    [GameMapType.Montreal]: { lat: 45.5, lon: -73.6 },
    [GameMapType.NewYorkCity]: { lat: 40.7, lon: -74 },
    [GameMapType.NewZealand]: { lat: -41, lon: 174 },
    [GameMapType.NileDelta]: { lat: 30.8, lon: 31 },
    [GameMapType.NorthAmerica]: { lat: 44, lon: -100 },
    [GameMapType.NorthwestPassage]: { lat: 72, lon: -100 },
    [GameMapType.Oceania]: { lat: -20, lon: 150 },
    [GameMapType.PulicatLake]: { lat: 13.6, lon: 80.2 },
    [GameMapType.QingChina]: { lat: 36, lon: 105 },
    [GameMapType.RioDeJaneiro]: { lat: -22.9, lon: -43.2 },
    [GameMapType.Russia]: { lat: 60, lon: 90 },
    [GameMapType.SanFrancisco]: { lat: 37.8, lon: -122.4 },
    [GameMapType.Scandinavia]: { lat: 63, lon: 15 },
    [GameMapType.SouthAmerica]: { lat: -15, lon: -60 },
    [GameMapType.SoutheastAsia]: { lat: 5, lon: 110 },
    [GameMapType.StraitOfGibraltar]: { lat: 36, lon: -5.5 },
    [GameMapType.StraitOfHormuz]: { lat: 26.6, lon: 56.3 },
    [GameMapType.StraitOfMalacca]: { lat: 3, lon: 100.5 },
    [GameMapType.TaiwanStrait]: { lat: 24, lon: 119.5 },
    [GameMapType.TierraDelFuego]: { lat: -54, lon: -68.5 },
    [GameMapType.UnitedStates]: { lat: 39, lon: -98 },
    [GameMapType.VancouverIsland]: { lat: 49.6, lon: -125.5 },
    [GameMapType.Venice]: { lat: 45.4, lon: 12.3 },
    [GameMapType.Vietnam]: { lat: 16, lon: 106.5 },
    [GameMapType.YangtzeRiver]: { lat: 30.5, lon: 112 },
    [GameMapType.YellowSea]: { lat: 36, lon: 123 },
    [GameMapType.Yenisei]: { lat: 62, lon: 90 },
  };

/** A place on Earth the globe turns to show. */
export type GlobeFocus = { lat: number; lon: number };

/** What the globe shows for a map; null for maps with no place on it. */
export function mapFocus(
  map: GameMapType | string | undefined,
): GlobeFocus | null {
  const regions = mapRegions(map);
  if (!regions.length) return null;
  return MAP_ANCHORS[map as GameMapType] ?? REGION_ANCHORS[regions[0]];
}
