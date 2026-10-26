import { ID } from "@openfront/engine-api/Schemas";
import type { Express } from "express";
import { z } from "zod";
import {
  PlayerGameModeFilterSchema,
  PlayerGameTypeFilterSchema,
} from "@openfront/shared/ApiSchemas";
import { SESSION_COOKIE } from "../auth/config";
import { readCookie } from "../auth/routes";
import { userForSession } from "../auth/sessions";
import { users } from "@kleopolis/db/schema";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { FFA_LADDER, loadGameRecord } from "../GameStore";
import { logger } from "../Logger";
import {
  leaderboard,
  playerGamesPage,
  profileForClient,
  publicProfile,
  rankedPage,
  statsForUser,
} from "./queries";

const log = logger.child({ comp: "stats" });

const PublicIdSchema = z.string().regex(/^[a-z0-9]{1,32}$/);
const LimitSchema = z.coerce.number().int().min(1).max(100).default(25);

// Read-only endpoints for finished games, profiles, and the leaderboard.
export function registerStatsRoutes(app: Express): void {
  // The archived record of a finished game. Account ids and reports are
  // removed, as in the public API.
  app.get("/api/games/:id", async (req, res) => {
    const id = ID.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "Invalid game id" });
      return;
    }
    try {
      const record = await loadGameRecord(db().db, id.data);
      if (record === null) {
        res.status(404).json({ error: "Game not found" });
        return;
      }
      const info = { ...record.info };
      delete info.reports;
      const scrubbed = {
        ...record,
        info: {
          ...info,
          players: info.players.map((p) => ({ ...p, persistentID: null })),
        },
      };
      res.setHeader("Cache-Control", "public, max-age=300");
      res
        .type("json")
        .send(
          JSON.stringify(scrubbed, (_k, v) =>
            typeof v === "bigint" ? v.toString() : v,
          ),
        );
    } catch (error) {
      log.error("failed to read a game record", { error: String(error) });
      res.status(500).json({ error: "internal_error" });
    }
  });

  app.get("/api/players/:publicId", async (req, res) => {
    const publicId = PublicIdSchema.safeParse(req.params.publicId);
    if (!publicId.success) {
      res.status(400).json({ error: "Invalid player id" });
      return;
    }
    try {
      const profile = await publicProfile(db().db, publicId.data);
      if (profile === null) {
        res.status(404).json({ error: "Player not found" });
        return;
      }
      res.json(profile);
    } catch (error) {
      log.error("failed to read a profile", { error: String(error) });
      res.status(500).json({ error: "internal_error" });
    }
  });

  // A player's finished games, newest first, one page per request.
  app.get("/api/players/:publicId/games", async (req, res) => {
    const publicId = PublicIdSchema.safeParse(req.params.publicId);
    const query = z
      .object({
        filter: PlayerGameModeFilterSchema.optional(),
        type: PlayerGameTypeFilterSchema.optional(),
        cursor: z.string().max(200).optional(),
      })
      .safeParse(req.query);
    if (!publicId.success || !query.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    try {
      const rows = await db()
        .db.select({ id: users.id })
        .from(users)
        .where(eq(users.publicId, publicId.data))
        .limit(1);
      const user = rows[0];
      if (!user) {
        res.status(404).json({ error: "Player not found" });
        return;
      }
      const page = await playerGamesPage(db().db, user.id, query.data);
      if (page === null) {
        res.status(400).json({ error: "Invalid cursor" });
        return;
      }
      res.json(page);
    } catch (error) {
      log.error("failed to read player games", { error: String(error) });
      res.status(500).json({ error: "internal_error" });
    }
  });

  // The profile in the shape the profile screen reads.
  app.get("/api/players/:publicId/profile", async (req, res) => {
    const publicId = PublicIdSchema.safeParse(req.params.publicId);
    if (!publicId.success) {
      res.status(400).json({ error: "Invalid player id" });
      return;
    }
    try {
      const profile = await profileForClient(db().db, publicId.data);
      if (profile === null) {
        res.status(404).json({ error: "Player not found" });
        return;
      }
      res.json(profile);
    } catch (error) {
      log.error("failed to read a profile", { error: String(error) });
      res.status(500).json({ error: "internal_error" });
    }
  });

  app.get("/api/me/stats", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const token = readCookie(req, SESSION_COOKIE);
      const user = token ? await userForSession(db().db, token) : null;
      if (user === null) {
        res.status(401).json({ error: "Sign in required" });
        return;
      }
      res.json({ stats: await statsForUser(db().db, user.id) });
    } catch (error) {
      log.error("failed to read stats", { error: String(error) });
      res.status(500).json({ error: "internal_error" });
    }
  });

  // The Elo ladders, in the shape the leaderboard screen reads: one page of
  // each ladder per request.
  app.get("/api/leaderboard/ranked", async (req, res) => {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(100_000)
      .default(1)
      .safeParse(req.query.page);
    if (!page.success) {
      res.status(400).json({ message: "Invalid page" });
      return;
    }
    try {
      const [duel, ffa] = await Promise.all([
        rankedPage(db().db, "1v1", page.data),
        rankedPage(db().db, FFA_LADDER, page.data),
      ]);
      // Past the end of the longest ladder.
      const pages = Math.max(duel.pages, ffa.pages);
      if (page.data > pages) {
        res
          .status(400)
          .json({ message: `Page must be between 1 and ${pages}` });
        return;
      }
      res.setHeader("Cache-Control", "public, max-age=30");
      res.json({
        "1v1": duel.entries,
        ffa: ffa.entries,
      });
    } catch (error) {
      log.error("failed to read the ranked ladder", { error: String(error) });
      res.status(500).json({ error: "internal_error" });
    }
  });

  app.get("/api/leaderboard", async (req, res) => {
    const limit = LimitSchema.safeParse(req.query.limit);
    if (!limit.success) {
      res.status(400).json({ error: "Invalid limit" });
      return;
    }
    try {
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({ entries: await leaderboard(db().db, limit.data) });
    } catch (error) {
      log.error("failed to read the leaderboard", { error: String(error) });
      res.status(500).json({ error: "internal_error" });
    }
  });
}
