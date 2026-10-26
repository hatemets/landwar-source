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

// A ranked game that nobody wins by land ends on the clock.
export const RANKED_TIME_LIMIT_MINUTES = 30;
