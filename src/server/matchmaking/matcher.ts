// Pure matching for the ranked queues. No sockets and no clock: the caller
// passes `now`, so every rule here can be tested on its own.

export type QueueMode = "1v1";

export const MODE_SIZE: Record<QueueMode, number> = { "1v1": 2 };

export interface Ticket {
  // Account id.
  userId: string;
  publicId: string;
  elo: number;
  // When the player joined the queue (ms).
  joinedAt: number;
}

export interface Match {
  players: Ticket[];
}

// Players get matched with anyone near their rating. The window starts tight
// and widens the longer they wait, so a lone player is not stuck for ever.
export const BASE_WINDOW = 100;
export const WINDOW_GROWTH_PER_SECOND = 20;
export const MAX_WINDOW = 800;

export function windowFor(waitedMs: number): number {
  const grown =
    BASE_WINDOW + (Math.max(0, waitedMs) / 1000) * WINDOW_GROWTH_PER_SECOND;
  return Math.min(MAX_WINDOW, grown);
}

// Builds every match the queue can make now. The longest waiter anchors each
// match: the others must sit inside that player's window, nearest rating
// first. Tickets used in one match are not offered to the next.
export function findMatches(
  tickets: readonly Ticket[],
  mode: QueueMode,
  now: number,
): Match[] {
  const size = MODE_SIZE[mode];
  const pool = [...tickets].sort(
    (a, b) => a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId),
  );
  const used = new Set<string>();
  const matches: Match[] = [];

  for (const anchor of pool) {
    if (used.has(anchor.userId)) continue;
    const window = windowFor(now - anchor.joinedAt);
    const near = pool
      .filter(
        (t) =>
          t.userId !== anchor.userId &&
          !used.has(t.userId) &&
          Math.abs(t.elo - anchor.elo) <= window,
      )
      .sort(
        (a, b) =>
          Math.abs(a.elo - anchor.elo) - Math.abs(b.elo - anchor.elo) ||
          a.joinedAt - b.joinedAt,
      );
    if (near.length < size - 1) continue;
    const players = [anchor, ...near.slice(0, size - 1)];
    // The whole group has to be close, not only each player to the anchor.
    const elos = players.map((p) => p.elo);
    if (Math.max(...elos) - Math.min(...elos) > 2 * window) continue;
    for (const p of players) used.add(p.userId);
    matches.push({ players });
  }
  return matches;
}
