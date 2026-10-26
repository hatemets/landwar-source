import { createDb, type DbHandle } from "@landwar/db/client";
import { runMigrations } from "@landwar/db/migrate";
import { games, users } from "@landwar/db/schema";
import {
  PlayerProfileSchema,
  PublicPlayerGamesResponseSchema,
} from "@openfront/shared/ApiSchemas";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadGameRecord, saveGameRecord } from "../../../src/server/GameStore";
import { upsertGoogleUser } from "../../../src/server/auth/users";
import {
  leaderboard,
  profileForClient,
  publicProfile,
  rankedPage,
  statsForUser,
} from "../../../src/server/stats/queries";
import { sampleRecord } from "../GameStore.fixture";

// Runs only when TEST_DATABASE_URL is set. The test database is migrated first.
const url = process.env.TEST_DATABASE_URL;

function gameId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

describe.skipIf(!url)("game store (database)", () => {
  let handle: DbHandle;
  let winnerId: string;
  let loserId: string;
  let winnerPublicId: string;
  const ids: string[] = [];
  const subs = [`test-${randomUUID()}`, `test-${randomUUID()}`];

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!);
    const winner = await upsertGoogleUser(handle.db, {
      sub: subs[0]!,
      email: "winner@example.com",
      name: "Winner",
      picture: null,
    });
    const loser = await upsertGoogleUser(handle.db, {
      sub: subs[1]!,
      email: "loser@example.com",
      name: "Loser",
      picture: null,
    });
    winnerId = winner.id;
    loserId = loser.id;
    winnerPublicId = winner.publicId;
  });

  afterAll(async () => {
    await handle.db.delete(games).where(inArray(games.id, ids));
    await handle.db.delete(users).where(inArray(users.id, [winnerId, loserId]));
    await handle.pool.end();
  });

  it("stores a game once and reads the record back", async () => {
    const id = gameId();
    ids.push(id);
    const record = sampleRecord(id, { winner: winnerId, loser: loserId });
    expect(await saveGameRecord(handle.db, record)).toBe(true);
    expect(await saveGameRecord(handle.db, record)).toBe(false);

    const loaded = await loadGameRecord(handle.db, id);
    expect(loaded?.info.gameID).toBe(id);
    expect(loaded?.info.players[0]?.stats?.gold).toEqual([100n, 50n]);
    expect(await loadGameRecord(handle.db, "zzzzzzzz")).toBeNull();
  });

  it("adds each game to the account totals once", async () => {
    const id = gameId();
    ids.push(id);
    await saveGameRecord(
      handle.db,
      sampleRecord(id, { winner: winnerId, loser: loserId }),
    );
    // The first test stored one game. This one makes two for each account.
    const winner = await statsForUser(handle.db, winnerId);
    expect(winner).toMatchObject({
      gamesPlayed: 2,
      wins: 2,
      troopsSent: 1000,
      attacks: 4,
      bestTerritoryPeak: 900,
    });
    const loser = await statsForUser(handle.db, loserId);
    expect(loser).toMatchObject({ gamesPlayed: 2, wins: 0, losses: 2 });
  });

  it("returns a public profile without private fields", async () => {
    const profile = await publicProfile(handle.db, winnerPublicId);
    expect(profile?.displayName).toBe("Winner");
    expect(profile?.recentGames).toHaveLength(2);
    expect(profile).not.toHaveProperty("email");
    expect(await publicProfile(handle.db, "nosuchplayer")).toBeNull();
  });

  it("builds a profile the client schema accepts", async () => {
    const profile = await profileForClient(handle.db, winnerPublicId);
    const parsed = PlayerProfileSchema.parse(profile);
    const leaf = parsed.stats.Public?.["Free For All"]?.Medium;
    expect(leaf).toMatchObject({ wins: 2n, losses: 0n, total: 2n });
  });

  it("rates a public free-for-all between accounts, once per game", async () => {
    // Two games were stored for the same pair; the winner won both.
    const page = await rankedPage(handle.db, "ffa", 1);
    const winner = page.entries.find((e) => e.public_id === winnerPublicId);
    const loser = page.entries.find((e) => e.accountUsername === "Loser");
    expect(winner).toMatchObject({ wins: 2, losses: 0, total: 2 });
    expect(winner!.elo).toBeGreaterThan(1000);
    expect(loser!.elo).toBeLessThan(1000);
    expect(winner!.rank).toBeLessThan(loser!.rank);
    expect(winner!.peakElo).toBe(winner!.elo);
  });

  it("ranks the leaderboard by wins", async () => {
    const entries = await leaderboard(handle.db, 100);
    const winnerRank = entries.findIndex((e) => e.publicId === winnerPublicId);
    const loserRank = entries.findIndex((e) => e.displayName === "Loser");
    expect(winnerRank).toBeGreaterThanOrEqual(0);
    expect(winnerRank).toBeLessThan(loserRank);
  });

  describe("routes", () => {
    let server: Server;
    let base: string;

    beforeAll(async () => {
      process.env.DATABASE_URL = url;
      const { registerStatsRoutes } =
        await import("../../../src/server/stats/routes");
      const app = express();
      registerStatsRoutes(app);
      server = app.listen(0);
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      server.close();
      const { db } = await import("../../../src/server/db");
      await db().pool.end();
    });

    it("serves a record with account ids removed", async () => {
      const res = await fetch(`${base}/api/games/${ids[0]}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        info: { players: { persistentID: unknown }[] };
      };
      expect(body.info.players.map((p) => p.persistentID)).toEqual([
        null,
        null,
        null,
      ]);
      expect((await fetch(`${base}/api/games/zzzzzzzz`)).status).toBe(404);
      expect((await fetch(`${base}/api/games/bad!`)).status).toBe(400);
    });

    it("serves a profile and refuses stats without a session", async () => {
      const ok = await fetch(`${base}/api/players/${winnerPublicId}`);
      expect(ok.status).toBe(200);
      expect((await fetch(`${base}/api/players/nosuchplayer`)).status).toBe(
        404,
      );
      expect((await fetch(`${base}/api/me/stats`)).status).toBe(401);
    });

    it("serves the ladder in the shape the client reads", async () => {
      const res = await fetch(`${base}/api/leaderboard/ranked?page=1`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown[]>;
      expect(Array.isArray(body["1v1"])).toBe(true);
      expect(body.ffa!.length).toBeGreaterThan(0);
      const past = await fetch(`${base}/api/leaderboard/ranked?page=999`);
      expect(past.status).toBe(400);
      expect(((await past.json()) as { message: string }).message).toMatch(
        /^Page must be between 1 and \d+$/,
      );
    });

    it("serves a player's game history", async () => {
      const res = await fetch(`${base}/api/players/${winnerPublicId}/games`);
      expect(res.status).toBe(200);
      const page = PublicPlayerGamesResponseSchema.parse(await res.json());
      expect(page.results).toHaveLength(2);
      expect(page.results[0]).toMatchObject({
        result: "victory",
        type: "Public",
      });
      expect(page.nextCursor).toBeNull();
      const none = await fetch(
        `${base}/api/players/${winnerPublicId}/games?filter=ranked`,
      );
      expect(
        ((await none.json()) as { results: unknown[] }).results,
      ).toHaveLength(0);
      const ffa = await fetch(
        `${base}/api/players/${winnerPublicId}/games?filter=ffa&type=public`,
      );
      expect(
        ((await ffa.json()) as { results: unknown[] }).results,
      ).toHaveLength(2);
      const bad = await fetch(
        `${base}/api/players/${winnerPublicId}/games?cursor=!!`,
      );
      expect(bad.status).toBe(400);
      const missing = await fetch(`${base}/api/players/nosuchplayer/games`);
      expect(missing.status).toBe(404);
    });

    it("serves the leaderboard", async () => {
      const res = await fetch(`${base}/api/leaderboard?limit=5`);
      expect(res.status).toBe(200);
      expect((await res.json()) as { entries: unknown[] }).toHaveProperty(
        "entries",
      );
      expect((await fetch(`${base}/api/leaderboard?limit=0`)).status).toBe(400);
    });
  });
});
