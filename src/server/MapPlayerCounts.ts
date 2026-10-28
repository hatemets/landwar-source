/**
 * Calculate player counts from land tiles
 * For every 1,000,000 land tiles, take 50 players
 * Second value is 75% of calculated value, third is 50%
 * All values are rounded to the nearest 5
 */
export function calculateMapPlayerCounts(
  landTiles: number,
): [number, number, number] {
  const roundToNearest5 = (n: number) => Math.round(n / 5) * 5;

  const base = Math.max(roundToNearest5((landTiles / 1_000_000) * 50), 5);
  return [base, roundToNearest5(base * 0.75), roundToNearest5(base * 0.5)];
}
