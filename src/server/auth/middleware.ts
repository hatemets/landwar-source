import type { NextFunction, Request, Response } from "express";
import { db } from "../db";
import { logger } from "../Logger";
import { SESSION_COOKIE } from "./config";
import { readCookie } from "./routes";
import { userForSession, type UserRow } from "./sessions";

const log = logger.child({ comp: "auth" });

export type Authed = Request & { user: UserRow };

// The account behind the session cookie, or null.
export async function sessionUser(req: Request): Promise<UserRow | null> {
  const token = readCookie(req, SESSION_COOKIE);
  return token ? userForSession(db().db, token) : null;
}

// Refuses a request without a session. The account is on `req.user`.
export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await sessionUser(req);
    if (user === null) {
      res.status(401).json({ error: "Sign in required" });
      return;
    }
    (req as Authed).user = user;
    next();
  } catch (error) {
    log.error("failed to read the session", { error: String(error) });
    res.status(500).json({ error: "internal_error" });
  }
}
