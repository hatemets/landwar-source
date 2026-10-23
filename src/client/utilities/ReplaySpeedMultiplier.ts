// Multiplies the turn interval: lower is faster (0.5 = ×2, 0 = as fast as
// the client can process).
export enum ReplaySpeedMultiplier {
  slow = 2,
  normal = 1,
  brisk = 2 / 3, // ×1.5
  fast = 0.5,
  fastest = 0,
}

export const defaultReplaySpeedMultiplier = ReplaySpeedMultiplier.brisk;
