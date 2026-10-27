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
  RANKED_3V3_MAPS,
  RANKED_5V5_MAPS,
  RANKED_TIME_LIMIT_MINUTES,
} from "@openfront/shared/RankedMaps";
import { type Match, type QueueMode, TEAMS_PER_MATCH } from "./matcher";

const MAPS: Record<QueueMode, readonly GameMapType[]> = {
  "1v1": RANKED_1V1_MAPS,
  "3v3": RANKED_3V3_MAPS,
  "5v5": RANKED_5V5_MAPS,
};

const RANKED_TYPE: Record<QueueMode, RankedType> = {
  "1v1": RankedType.OneVOne,
  "3v3": RankedType.ThreeVThree,
  "5v5": RankedType.FiveVFive,
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
  const teams = match.teams !== undefined;
  return {
    // Teammates may help each other, as in public team games.
    donateGold: teams,
    donateTroops: teams,
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
    ...(teams
      ? { gameMode: GameMode.Team, playerTeams: TEAMS_PER_MATCH }
      : { gameMode: GameMode.FFA }),
    maxPlayers: match.players.length,
    rankedType: RANKED_TYPE[mode],
    // Invite-only: just the matched accounts may join.
    allowedPublicIds: match.players.map((p) => p.publicId),
  };
}

// The team pins the worker seats players by: one list of publicIds per side.
// Undefined for a 1v1.
export function matchTeams(match: Match): string[][] | undefined {
  return match.teams?.map((side) => side.map((p) => p.publicId));
}
