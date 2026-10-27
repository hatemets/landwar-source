import type { RankedType } from "@openfront/engine-api/game/GameTypes";

// The ranked queues. Same strings as RankedType, the server's `mode` param and
// the `/?requeue=` value. Each queue has its own ladder. A small module of its
// own, so the homepage can read it without loading the matchmaking modal.
export type MatchmakingMode = "1v1" | "3v3" | "5v5";

export const MATCHMAKING_MODES: readonly MatchmakingMode[] = [
  "1v1",
  "3v3",
  "5v5",
];

export function isMatchmakingMode(value: unknown): value is MatchmakingMode {
  return MATCHMAKING_MODES.includes(value as MatchmakingMode);
}

// The queue a ranked game came from, or null for a ranked type with no queue.
export function matchmakingModeFor(
  rankedType: RankedType | undefined,
): MatchmakingMode | null {
  return isMatchmakingMode(rankedType) ? rankedType : null;
}
