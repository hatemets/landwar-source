import { AccountUsernameSchema } from "@openfront/shared/AccountUsername";
import type { PutUsernameResponse } from "@openfront/shared/ApiSchemas";
import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { profanityMatcher } from "../Censor";
import { db } from "../db";
import { logger } from "../Logger";
import { type Authed, requireUser } from "./middleware";
import { requireSameOrigin } from "./routes";
import { setDisplayName } from "./users";

const log = logger.child({ comp: "username" });

// The body the client's updateUsername sends. Names are not unique here, so
// acceptSuffixed has no effect.
const BodySchema = z.object({
  username: z.string(),
  acceptSuffixed: z.boolean().optional(),
});

export function registerUsernameRoutes(app: Express): void {
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });

  // Sets the name the player plays under. A Google sign-in seeds it with the
  // real name, so this is how a player hides it.
  app.put(
    "/api/users/@me/username",
    limiter,
    requireSameOrigin,
    requireUser,
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const body = BodySchema.safeParse(req.body ?? {});
      const name = AccountUsernameSchema.safeParse(body.data?.username);
      if (!body.success || !name.success) {
        res.status(400).json({ code: "USERNAME_INVALID" });
        return;
      }
      if (profanityMatcher.hasMatch(name.data)) {
        res.status(400).json({ code: "USERNAME_PROFANE" });
        return;
      }
      try {
        const user = await setDisplayName(
          db().db,
          (req as Authed).user.id,
          name.data,
        );
        if (user === null) {
          res.status(401).json({ error: "Sign in required" });
          return;
        }
        const response: PutUsernameResponse = {
          username: user.displayName,
          base: user.displayName,
          discriminator: "",
          usernameStatus: "unclaimed",
          nextUsernameChangeAt: null,
        };
        res.json(response);
      } catch (error) {
        log.error("username update failed", { error: String(error) });
        res.status(500).json({ error: "internal_error" });
      }
    },
  );
}
