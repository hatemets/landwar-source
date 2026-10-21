export const START_ELO = 1000;
export const ELO_K = 32;

export interface RatedPlayer {
  id: string;
  // 1 is best. Equal values are a tie.
  placement: number;
  elo: number;
}

// Elo for a free-for-all: every pair of players is a match, and each match
// moves the rating by K / (n - 1), so a big lobby is worth the same as a duel.
// Returns the whole-point change for each player.
export function eloDeltas(players: RatedPlayer[]): Map<string, number> {
  const delta = new Map<string, number>(players.map((p) => [p.id, 0]));
  const n = players.length;
  if (n < 2) return delta;
  const k = ELO_K / (n - 1);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = players[i]!;
      const b = players[j]!;
      const expectedA = 1 / (1 + Math.pow(10, (b.elo - a.elo) / 400));
      const scoreA =
        a.placement < b.placement ? 1 : a.placement === b.placement ? 0.5 : 0;
      const change = k * (scoreA - expectedA);
      delta.set(a.id, (delta.get(a.id) ?? 0) + change);
      delta.set(b.id, (delta.get(b.id) ?? 0) - change);
    }
  }
  for (const [id, value] of delta) delta.set(id, Math.round(value));
  return delta;
}
