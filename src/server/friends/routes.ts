import type { Express, Request, Response } from "express";
import { z } from "zod";
import { type Authed, requireUser } from "../auth/middleware";
import { requireSameOrigin } from "../auth/routes";
import { db } from "../db";
import { logger } from "../Logger";
import {
  acceptRequest,
  deleteRequest,
  listFriends,
  listRequests,
  removeFriend,
  sendRequest,
} from "./queries";

const log = logger.child({ comp: "friends" });

const PublicIdSchema = z.string().regex(/^[a-z0-9]{1,32}$/);
const PageSchema = z.coerce.number().int().min(1).max(10_000).default(1);
const LimitSchema = z.coerce.number().int().min(1).max(100).default(20);

function target(req: Request, res: Response): string | null {
  const id = PublicIdSchema.safeParse(req.params.publicId);
  if (!id.success) {
    res.status(400).json({ error: "Invalid player id" });
    return null;
  }
  return id.data;
}

function fail(res: Response, error: unknown): void {
  log.error("friends request failed", { error: String(error) });
  res.status(500).json({ error: "internal_error" });
}

export function registerFriendsRoutes(app: Express): void {
  app.use("/api/friends", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/api/friends/requests", requireUser, async (req, res) => {
    try {
      res.json(await listRequests(db().db, (req as Authed).user.id));
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/friends", requireUser, async (req, res) => {
    const page = PageSchema.safeParse(req.query.page);
    const limit = LimitSchema.safeParse(req.query.limit);
    if (!page.success || !limit.success) {
      res.status(400).json({ error: "Invalid paging" });
      return;
    }
    try {
      res.json(
        await listFriends(
          db().db,
          (req as Authed).user.id,
          page.data,
          limit.data,
        ),
      );
    } catch (error) {
      fail(res, error);
    }
  });

  app.post(
    "/api/friends/requests/:publicId",
    requireSameOrigin,
    requireUser,
    async (req, res) => {
      const publicId = target(req, res);
      if (publicId === null) return;
      try {
        const result = await sendRequest(
          db().db,
          (req as Authed).user.id,
          publicId,
        );
        if ("error" in result) {
          const code = { not_found: 404, conflict: 409, bad_request: 400 }[
            result.error
          ];
          res.status(code).json({ error: result.error });
          return;
        }
        res.json(result);
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.post(
    "/api/friends/requests/:publicId/accept",
    requireSameOrigin,
    requireUser,
    async (req, res) => {
      const publicId = target(req, res);
      if (publicId === null) return;
      try {
        const ok = await acceptRequest(
          db().db,
          (req as Authed).user.id,
          publicId,
        );
        if (!ok) res.status(404).json({ error: "not_found" });
        else res.status(204).end();
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.delete(
    "/api/friends/requests/:publicId",
    requireSameOrigin,
    requireUser,
    async (req, res) => {
      const publicId = target(req, res);
      if (publicId === null) return;
      try {
        const ok = await deleteRequest(
          db().db,
          (req as Authed).user.id,
          publicId,
        );
        if (!ok) res.status(404).json({ error: "not_found" });
        else res.status(204).end();
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.delete(
    "/api/friends/:publicId",
    requireSameOrigin,
    requireUser,
    async (req, res) => {
      const publicId = target(req, res);
      if (publicId === null) return;
      try {
        const ok = await removeFriend(
          db().db,
          (req as Authed).user.id,
          publicId,
        );
        if (!ok) res.status(404).json({ error: "not_found" });
        else res.status(204).end();
      } catch (error) {
        fail(res, error);
      }
    },
  );
}
