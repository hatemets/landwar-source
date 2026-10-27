import type { Db } from "@kleopolis/db/client";
import {
  gameRecords,
  games,
  playerRatings,
  users,
  userStats,
} from "@kleopolis/db/schema";
import { and, desc, eq, gt, gte, sql } from "drizzle-orm";

// What a profile page's head tags say about a player.
export interface ProfileSummary {
  publicId: string;
  displayName: string;
  gamesPlayed: number;
  wins: number;
  // The ladder the player has played most, if any.
  rating: { ladder: string; elo: number } | null;
}

export async function profileSummary(
  db: Db,
  publicId: string,
): Promise<ProfileSummary | null> {
  const rows = await db
    .select({
      id: users.id,
      publicId: users.publicId,
      displayName: users.displayName,
      gamesPlayed: userStats.gamesPlayed,
      wins: userStats.wins,
    })
    .from(users)
    .leftJoin(userStats, eq(userStats.userId, users.id))
    .where(eq(users.publicId, publicId))
    .limit(1);
  const user = rows[0];
  if (!user) return null;
  const ratings = await db
    .select({ ladder: playerRatings.ladder, elo: playerRatings.elo })
    .from(playerRatings)
    .where(and(eq(playerRatings.userId, user.id), gt(playerRatings.games, 0)))
    .orderBy(desc(playerRatings.games), desc(playerRatings.elo))
    .limit(1);
  return {
    publicId: user.publicId,
    displayName: user.displayName,
    gamesPlayed: user.gamesPlayed ?? 0,
    wins: user.wins ?? 0,
    rating: ratings[0] ?? null,
  };
}

export const SITEMAP_MIN_GAMES = 5;
export const SITEMAP_MAX_PROFILES = 5000;
export const SITEMAP_MAX_GAMES = 5000;
export const SITEMAP_GAME_DAYS = 30;

export interface SitemapEntries {
  profiles: { publicId: string; lastmod: Date }[];
  games: { gameId: string; lastmod: Date }[];
}

// Profiles worth indexing, most recently active first, and the finished
// public games of the last 30 days that still have a replay.
export async function sitemapEntries(db: Db): Promise<SitemapEntries> {
  const [profiles, recentGames] = await Promise.all([
    db
      .select({ publicId: users.publicId, lastmod: userStats.updatedAt })
      .from(userStats)
      .innerJoin(users, eq(users.id, userStats.userId))
      .where(gte(userStats.gamesPlayed, SITEMAP_MIN_GAMES))
      .orderBy(desc(userStats.updatedAt))
      .limit(SITEMAP_MAX_PROFILES),
    db
      .select({ gameId: games.id, lastmod: games.endedAt })
      .from(games)
      .innerJoin(gameRecords, eq(gameRecords.gameId, games.id))
      .where(
        and(
          eq(games.gameType, "Public"),
          gte(
            games.endedAt,
            sql`now() - make_interval(days => ${SITEMAP_GAME_DAYS})`,
          ),
        ),
      )
      .orderBy(desc(games.endedAt))
      .limit(SITEMAP_MAX_GAMES),
  ]);
  return { profiles, games: recentGames };
}
