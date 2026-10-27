import { GameMapType } from "@openfront/engine-api/game/GameTypes";

// Maps that suit a ranked 1v1: small enough to finish, with room for two
// players to grow without a runaway start. The practice match against a bot
// uses the same maps, so it trains for the real thing.
export const RANKED_1V1_MAPS: readonly GameMapType[] = [
  GameMapType.Pangaea,
  GameMapType.Onion,
  GameMapType.Halkidiki,
  GameMapType.Lemnos,
  GameMapType.Korea,
  GameMapType.Iceland,
];

// Maps for a ranked 3v3: room for six players, with fronts for two sides.
export const RANKED_3V3_MAPS: readonly GameMapType[] = [
  GameMapType.Italia,
  GameMapType.Britannia,
  GameMapType.Iceland,
  GameMapType.Japan,
  GameMapType.BlackSea,
  GameMapType.Australia,
];

// Maps for a ranked 5v5: the largest land masses, for ten players.
export const RANKED_5V5_MAPS: readonly GameMapType[] = [
  GameMapType.Europe,
  GameMapType.Africa,
  GameMapType.NorthAmerica,
  GameMapType.SouthAmerica,
  GameMapType.Mena,
  GameMapType.Asia,
];

// A ranked game that nobody wins by land ends on the clock.
export const RANKED_TIME_LIMIT_MINUTES = 30;
