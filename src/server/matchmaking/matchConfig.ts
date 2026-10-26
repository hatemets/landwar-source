import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  RankedType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import {
  RANKED_1V1_MAPS,
  RANKED_TIME_LIMIT_MINUTES,
} from "@openfront/shared/RankedMaps";
import type { Match, QueueMode } from "./matcher";

const MAPS: Record<QueueMode, readonly GameMapType[]> = {
  "1v1": RANKED_1V1_MAPS,
};

// Seconds the matched players get to connect before the game is cancelled.
export const MATCH_JOIN_DEADLINE_SECONDS = 45;

export function matchGameConfig(
  mode: QueueMode,
  match: Match,
  random: () => number = Math.random,
): GameConfig {
  const maps = MAPS[mode];
  const map = maps[Math.floor(random() * maps.length)]!;
  return {
    donateGold: false,
    donateTroops: false,
    gameMap: map,
    gameType: GameType.Public,
    gameMapSize: GameMapSize.Compact,
    difficulty: Difficulty.Medium,
    // Only the matched humans play.
    nations: "disabled",
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    disabledUnits: [],
    maxTimerValue: RANKED_TIME_LIMIT_MINUTES,
    gameMode: GameMode.FFA,
    maxPlayers: match.players.length,
    rankedType: RankedType.OneVOne,
    // Invite-only: just the matched accounts may join.
    allowedPublicIds: match.players.map((p) => p.publicId),
  };
}
