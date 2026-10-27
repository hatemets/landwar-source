import { createDb, type DbHandle } from "@kleopolis/db/client";
import { runMigrations } from "@kleopolis/db/migrate";
import {
  gameRecords,
  games,
  playerRatings,
  users,
  userStats,
} from "@kleopolis/db/schema";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  profileSummary,
  sitemapEntries,
} from "../../../src/server/stats/seoQueries";
import { googleUser } from "../../util/TestUsers";

// Runs only when TEST_DATABASE_URL is set. The test database is migrated first.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("SEO queries (database)", () => {
  let handle: DbHandle;
  const userIds: string[] = [];
  const gameIds: string[] = [];
  const veteran = { id: "", publicId: "" };
  const rookie = { id: "", publicId: "" };
  const tag = randomUUID().slice(0, 6);

  async function account(name: string) {
    const user = await googleUser(handle.db, {
      sub: `test-${randomUUID()}`,
      email: `${name}@example.com`,
      name,
      picture: null,
    });
    userIds.push(user.id);
    return { id: user.id, publicId: user.publicId };
  }

  async function game(
    id: string,
    gameType: string,
    endedAt: Date,
    withRecord = true,
  ) {
    gameIds.push(id);
    await handle.db.insert(games).values({
      id,
      map: "World",
      mode: "Free For All",
      gameType,
      playerCount: 2,
      startedAt: new Date(endedAt.getTime() - 60_000),
      endedAt,
      durationMs: 60_000,
    });
    if (withRecord) {
      await handle.db.insert(gameRecords).values({ gameId: id, record: "{}" });
    }
  }

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!);
    Object.assign(veteran, await account("Veteran"));
    Object.assign(rookie, await account("Rookie"));
    await handle.db.insert(userStats).values([
      { userId: veteran.id, gamesPlayed: 8, wins: 2 },
      { userId: rookie.id, gamesPlayed: 4, wins: 4 },
    ]);
    await handle.db.insert(playerRatings).values([
      { userId: veteran.id, ladder: "1v1", elo: 1100, games: 6 },
      { userId: veteran.id, ladder: "ffa", elo: 1300, games: 2 },
    ]);
    const now = Date.now();
    await game(`seo${tag}pub`, "Public", new Date(now - 60_000));
    await game(`seo${tag}prv`, "Private", new Date(now - 60_000));
    await game(`seo${tag}old`, "Public", new Date(now - 40 * 86_400_000));
    await game(`seo${tag}nor`, "Public", new Date(now - 60_000), false);
  });

  afterAll(async () => {
    await handle.db.delete(games).where(inArray(games.id, gameIds));
    await handle.db.delete(users).where(inArray(users.id, userIds));
    await handle.pool.end();
  });

  it("summarizes a player with their most played ladder", async () => {
    expect(await profileSummary(handle.db, veteran.publicId)).toEqual({
      publicId: veteran.publicId,
      displayName: "Veteran",
      gamesPlayed: 8,
      wins: 2,
      rating: { ladder: "1v1", elo: 1100 },
    });
  });

  it("returns null for an unknown player", async () => {
    expect(await profileSummary(handle.db, "nosuchplayer")).toBeNull();
  });

  it("lists players with 5+ games and recent public games with a replay", async () => {
    const entries = await sitemapEntries(handle.db);
    const ids = entries.profiles.map((p) => p.publicId);
    expect(ids).toContain(veteran.publicId);
    expect(ids).not.toContain(rookie.publicId);
    const games = entries.games.map((g) => g.gameId);
    expect(games).toContain(`seo${tag}pub`);
    expect(games).not.toContain(`seo${tag}prv`);
    expect(games).not.toContain(`seo${tag}old`);
    expect(games).not.toContain(`seo${tag}nor`);
    for (const g of entries.games) expect(g.lastmod).toBeInstanceOf(Date);
    const sorted = [...entries.games].sort(
      (a, b) => b.lastmod.getTime() - a.lastmod.getTime(),
    );
    expect(entries.games).toEqual(sorted);
  });
});
