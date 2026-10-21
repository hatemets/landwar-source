import type { Db } from "@landwar/db/client";
import {
  gamePlayers,
  games,
  playerRatings,
  users,
  userStats,
} from "@landwar/db/schema";
import { and, count, desc, eq, gt, sql } from "drizzle-orm";

export type StatsRow = Omit<
  typeof userStats.$inferSelect,
  "userId" | "updatedAt"
>;

export const EMPTY_STATS: StatsRow = {
  gamesPlayed: 0,
  wins: 0,
  buildingsBuilt: 0,
  goldCollected: 0,
  troopsSent: 0,
  attacks: 0,
  kills: 0,
  losses: 0,
  unitsBuilt: 0,
  unitsDestroyed: 0,
  nukesBuilt: 0,
  nukesDestroyed: 0,
  bestTerritoryPeak: 0,
};

export interface RecentGame {
  gameId: string;
  map: string;
  mode: string;
  endedAt: Date;
  durationMs: number;
  placement: number;
  won: boolean;
  playerCount: number;
}

export interface PublicProfile {
  publicId: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: Date;
  stats: StatsRow;
  recentGames: RecentGame[];
}

export interface LeaderboardEntry {
  rank: number;
  publicId: string;
  displayName: string;
  avatarUrl: string | null;
  gamesPlayed: number;
  wins: number;
}

export async function statsForUser(db: Db, userId: string): Promise<StatsRow> {
  const rows = await db
    .select()
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return { ...EMPTY_STATS };
  const stats: Partial<typeof row> = { ...row };
  delete stats.userId;
  delete stats.updatedAt;
  return stats as StatsRow;
}

export async function recentGamesForUser(
  db: Db,
  userId: string,
  limit: number,
): Promise<RecentGame[]> {
  const rows = await db
    .select({
      gameId: games.id,
      map: games.map,
      mode: games.mode,
      endedAt: games.endedAt,
      durationMs: games.durationMs,
      playerCount: games.playerCount,
      placement: gamePlayers.placement,
      won: gamePlayers.won,
    })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .where(eq(gamePlayers.userId, userId))
    .orderBy(desc(games.endedAt))
    .limit(limit);
  return rows;
}

// A profile never exposes the email or the internal user id.
export async function publicProfile(
  db: Db,
  publicId: string,
): Promise<PublicProfile | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.publicId, publicId))
    .limit(1);
  const user = rows[0];
  if (!user) return null;
  const [stats, recentGames] = await Promise.all([
    statsForUser(db, user.id),
    recentGamesForUser(db, user.id, 20),
  ]);
  return {
    publicId: user.publicId,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    stats,
    recentGames,
  };
}

// Ranks by wins, then by win count per game, then by older account first.
export async function leaderboard(
  db: Db,
  limit: number,
): Promise<LeaderboardEntry[]> {
  const rows = await db
    .select({
      publicId: users.publicId,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      gamesPlayed: userStats.gamesPlayed,
      wins: userStats.wins,
    })
    .from(userStats)
    .innerJoin(users, eq(users.id, userStats.userId))
    .where(and(gt(userStats.gamesPlayed, 0)))
    .orderBy(
      desc(userStats.wins),
      sql`${userStats.wins}::float / ${userStats.gamesPlayed} desc`,
      users.createdAt,
    )
    .limit(limit);
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

export interface StatsLeaf {
  wins: string;
  losses: string;
  total: string;
  stats: { attacks: string[]; gold: string[] };
}

// Totals per game type, mode and difficulty, in the shape the profile screen
// reads: tree[gameType][mode][difficulty].
export async function statsTree(
  db: Db,
  userId: string,
): Promise<Record<string, Record<string, Record<string, StatsLeaf>>>> {
  const rows = await db
    .select({
      gameType: games.gameType,
      mode: games.mode,
      difficulty: games.difficulty,
      total: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${gamePlayers.won})::int`,
      troopsSent: sql<string>`coalesce(sum(${gamePlayers.troopsSent}), 0)::text`,
      gold: sql<string>`coalesce(sum(${gamePlayers.goldCollected}), 0)::text`,
    })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .where(eq(gamePlayers.userId, userId))
    .groupBy(games.gameType, games.mode, games.difficulty);
  const tree: Record<string, Record<string, Record<string, StatsLeaf>>> = {};
  for (const r of rows) {
    const byMode = (tree[r.gameType] ??= {});
    const byDifficulty = (byMode[r.mode] ??= {});
    byDifficulty[r.difficulty] = {
      wins: String(r.wins),
      losses: String(r.total - r.wins),
      total: String(r.total),
      stats: { attacks: [r.troopsSent], gold: [r.gold] },
    };
  }
  return tree;
}

export async function profileForClient(db: Db, publicId: string) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.publicId, publicId))
    .limit(1);
  const user = rows[0];
  if (!user) return null;
  return {
    createdAt: user.createdAt.toISOString(),
    username: user.displayName,
    stats: await statsTree(db, user.id),
  };
}

export const RANKED_PAGE_SIZE = 50;

export interface RankedEntry {
  rank: number;
  elo: number;
  peakElo: number;
  wins: number;
  losses: number;
  total: number;
  public_id: string;
  accountUsername: string;
}

// One page of a ladder, best Elo first. `pages` is how many pages exist, at
// least 1 so an empty ladder still has a first page.
export async function rankedPage(
  db: Db,
  ladder: string,
  page: number,
): Promise<{ entries: RankedEntry[]; pages: number }> {
  const [{ value: total } = { value: 0 }] = await db
    .select({ value: count() })
    .from(playerRatings)
    .where(and(eq(playerRatings.ladder, ladder), gt(playerRatings.games, 0)));
  const pages = Math.max(1, Math.ceil(total / RANKED_PAGE_SIZE));
  const offset = (page - 1) * RANKED_PAGE_SIZE;
  const rows = await db
    .select({
      elo: playerRatings.elo,
      peakElo: playerRatings.peakElo,
      wins: playerRatings.wins,
      losses: playerRatings.losses,
      games: playerRatings.games,
      publicId: users.publicId,
      displayName: users.displayName,
    })
    .from(playerRatings)
    .innerJoin(users, eq(users.id, playerRatings.userId))
    .where(and(eq(playerRatings.ladder, ladder), gt(playerRatings.games, 0)))
    .orderBy(
      desc(playerRatings.elo),
      desc(playerRatings.peakElo),
      users.createdAt,
      users.id,
    )
    .limit(RANKED_PAGE_SIZE)
    .offset(offset);
  return {
    pages,
    entries: rows.map((r, i) => ({
      rank: offset + i + 1,
      elo: r.elo,
      peakElo: r.peakElo,
      wins: r.wins,
      losses: r.losses,
      total: r.games,
      public_id: r.publicId,
      accountUsername: r.displayName,
    })),
  };
}

// The caller's Elo on each ladder, keyed the way /api/me reports it. A ladder
// the player has not played is absent.
export async function ratingsForUser(
  db: Db,
  userId: string,
): Promise<{
  oneVone?: { elo: number };
  ffa?: { elo: number };
}> {
  const rows = await db
    .select({ ladder: playerRatings.ladder, elo: playerRatings.elo })
    .from(playerRatings)
    .where(and(eq(playerRatings.userId, userId), gt(playerRatings.games, 0)));
  const out: {
    oneVone?: { elo: number };
    ffa?: { elo: number };
  } = {};
  for (const r of rows) {
    if (r.ladder === "1v1") out.oneVone = { elo: r.elo };
    else if (r.ladder === "ffa") out.ffa = { elo: r.elo };
  }
  return out;
}
