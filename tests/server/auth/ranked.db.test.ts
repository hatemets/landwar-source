import { createDb, type DbHandle } from "@landwar/db/client";
import { runMigrations } from "@landwar/db/migrate";
import { games, playerRatings, users } from "@landwar/db/schema";
import type { GameRecord } from "@openfront/shared/WireSchemas";
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertGoogleUser } from "../../../src/server/auth/users";
import { saveGameRecord } from "../../../src/server/GameStore";
import { sampleRecord } from "../GameStore.fixture";

// Runs only when TEST_DATABASE_URL is set. Matchmade games rate their own
// ladders: 1v1 as a duel.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("ranked ratings (database)", () => {
  let handle: DbHandle;
  const userIds: string[] = [];
  const gameIds: string[] = [];

  const newGameId = () => {
    const id = randomUUID().replace(/-/g, "").slice(0, 8);
    gameIds.push(id);
    return id;
  };
  async function account(name: string) {
    const u = await upsertGoogleUser(handle.db, {
      sub: `ranked-${randomUUID()}`,
      email: `${name}@example.com`,
      name,
      picture: null,
    });
    userIds.push(u.id);
    return u.id;
  }
  const rating = async (userId: string, ladder: string) =>
    (
      await handle.db
        .select()
        .from(playerRatings)
        .where(
          and(
            eq(playerRatings.userId, userId),
            eq(playerRatings.ladder, ladder),
          ),
        )
    )[0];

  function match(kind: "1v1", ids: string[], winners: number[]): GameRecord {
    const record = sampleRecord(newGameId(), {
      winner: ids[0]!,
      loser: ids[1]!,
    });
    const clientIds = ids.map((_, i) =>
      `client${String.fromCharCode(65 + i)}${i}`.padEnd(8, "x"),
    );
    record.info.config = {
      ...record.info.config,
      rankedType: kind,
      gameMode: "Free For All",
    } as never;
    record.info.players = ids.map((id, i) => ({
      clientID: clientIds[i]!,
      username: `P${i}`,
      clanTag: null,
      persistentID: id,
      stats: {},
    })) as never;
    record.info.winner = (
      winners.length === 0 ? undefined : ["player", clientIds[winners[0]!]!]
    ) as never;
    return record;
  }

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!);
  });

  afterAll(async () => {
    await handle.db.delete(games).where(inArray(games.id, gameIds));
    await handle.db.delete(users).where(inArray(users.id, userIds));
    await handle.pool.end();
  });

  it("rates a 1v1 on its own ladder", async () => {
    const [a, b] = [await account("DuelA"), await account("DuelB")];
    await saveGameRecord(handle.db, match("1v1", [a, b], [0]));
    expect(await rating(a, "1v1")).toMatchObject({
      elo: 1016,
      wins: 1,
      losses: 0,
      games: 1,
    });
    expect(await rating(b, "1v1")).toMatchObject({
      elo: 984,
      wins: 0,
      losses: 1,
      games: 1,
    });
    // The free-for-all ladder is untouched.
    expect(await rating(a, "ffa")).toBeUndefined();
  });

  it("moves a rematch by the new gap", async () => {
    const [a, b] = [await account("RematchA"), await account("RematchB")];
    await saveGameRecord(handle.db, match("1v1", [a, b], [0]));
    // The favourite wins again: a smaller swing than 16.
    await saveGameRecord(handle.db, match("1v1", [a, b], [0]));
    const winner = await rating(a, "1v1");
    expect(winner!.elo).toBeGreaterThan(1016);
    expect(winner!.elo).toBeLessThan(1032);
    expect(winner).toMatchObject({ wins: 2, peakElo: winner!.elo });
  });

  it("does not rate a matchmade game nobody won", async () => {
    const [a, b] = [await account("NoWinA"), await account("NoWinB")];
    await saveGameRecord(handle.db, match("1v1", [a, b], []));
    expect(await rating(a, "1v1")).toBeUndefined();
  });

  it("does not rate a 1v1 with a guest", async () => {
    const a = await account("Lonely");
    const record = match("1v1", [a, randomUUID()], [0]);
    await saveGameRecord(handle.db, record);
    expect(await rating(a, "1v1")).toBeUndefined();
  });

  it("stores the ranked type with the game", async () => {
    const [a, b] = [await account("TypeA"), await account("TypeB")];
    const record = match("1v1", [a, b], [0]);
    await saveGameRecord(handle.db, record);
    const row = (
      await handle.db
        .select()
        .from(games)
        .where(eq(games.id, record.info.gameID))
    )[0];
    expect(row?.rankedType).toBe("1v1");
  });
});
