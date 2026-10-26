import { randomUUID } from "crypto";
import type { Express, NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "../db";
import { logger } from "../Logger";
import { balanceOf, ownedFlares } from "../shop/wallet";
import { ratingsForUser } from "../stats/queries";
import {
  isSecureOrigin,
  OAUTH_COOKIE_TTL_MS,
  OAUTH_RETURN_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  publicOrigin,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "./config";
import { finishDiscordLogin, startDiscordLogin } from "./discord";
import {
  finishGoogleLogin,
  type OAuthLoginStart,
  type ProviderProfile,
  startGoogleLogin,
} from "./google";
import { signJoinToken } from "./joinToken";
import {
  createSession,
  deleteSession,
  userForSession,
  type UserRow,
} from "./sessions";
import { type AuthProvider, findUserById, upsertProviderUser } from "./users";

const log = logger.child({ comp: "auth" });

// Cookie values are sent back exactly as they were set. Parse the header
// here so the server needs no cookie middleware.
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureOrigin(),
    path: "/",
    maxAge: maxAgeMs,
  };
}

// A state-changing request must come from this site. SameSite=Lax already
// blocks cross-site cookies on POST. This check adds a second guard.
export function requireSameOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.headers.origin !== publicOrigin()) {
    res.status(403).json({ error: "Cross-origin request refused" });
    return;
  }
  next();
}

// Only same-site relative paths. Anything else falls back to the home page.
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  return value;
}

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    publicId: user.publicId,
    displayName: user.displayName,
    email: user.email,
    avatarUrl: user.avatarUrl,
    // The sign-in methods on the account.
    google: user.googleSub !== null,
    discord: user.discordId !== null,
  };
}

const GuestTokenBodySchema = z.object({
  guestId: z.uuid().optional(),
});

export function registerAuthRoutes(app: Express): void {
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
  app.use("/api/auth", limiter);

  registerProviderRoutes(app, "google", startGoogleLogin, finishGoogleLogin);
  registerProviderRoutes(app, "discord", startDiscordLogin, finishDiscordLogin);

  app.post("/api/auth/logout", requireSameOrigin, async (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await deleteSession(db().db, token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  });

  app.get("/api/me", async (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    const user = token ? await userForSession(db().db, token) : null;
    res.setHeader("Cache-Control", "no-store");
    if (user === null) {
      res.json({ user: null });
      return;
    }
    const [ratings, soft, flares] = await Promise.all([
      ratingsForUser(db().db, user.id),
      balanceOf(db().db, user.id),
      ownedFlares(db().db, user.id),
    ]);
    res.json({
      user: publicUser(user),
      ratings,
      currency: { soft, hard: 0 },
      flares,
    });
  });

  // Issues a join token. A signed-in player gets an account token. Anyone
  // else gets a guest token. The client keeps its guestId across refreshes.
  app.post("/api/auth/token", requireSameOrigin, async (req, res) => {
    const parsed = GuestTokenBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid guestId" });
      return;
    }
    const sessionToken = readCookie(req, SESSION_COOKIE);
    const user = sessionToken
      ? await userForSession(db().db, sessionToken)
      : null;
    const guestId = parsed.data.guestId;
    const guestIdFree =
      user === null && guestId !== undefined && (await isFreeGuestId(guestId));
    const claims = user
      ? { sub: user.id, kind: "user" as const }
      : { sub: guestIdFree ? guestId : randomUUID(), kind: "guest" as const };
    const issued = await signJoinToken(claims);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      token: issued.token,
      expiresAt: issued.expiresAt,
      kind: claims.kind,
      id: claims.sub,
    });
  });
}

// Account ids are not secret (profiles show them), so a guest may not claim
// one: rejoin and stats match on the id alone. If the database cannot answer,
// the guest gets a new id rather than no token.
async function isFreeGuestId(guestId: string): Promise<boolean> {
  try {
    return (await findUserById(db().db, guestId)) === null;
  } catch (error) {
    log.warn("guest id check failed", { error: String(error) });
    return false;
  }
}

// GET /api/auth/<provider> sends the browser to the provider, and its callback
// signs the player in. A player who is already signed in links the provider to
// their account instead, and lands on the account page with the result.
function registerProviderRoutes(
  app: Express,
  provider: AuthProvider,
  start: () => OAuthLoginStart,
  finish: (code: string, codeVerifier: string) => Promise<ProviderProfile>,
): void {
  app.get(`/api/auth/${provider}`, (req, res) => {
    let login: OAuthLoginStart;
    try {
      login = start();
    } catch (error) {
      log.error(`${provider} sign-in is not configured`, {
        error: String(error),
      });
      res.status(503).json({ error: `${provider}_not_configured` });
      return;
    }
    const maxAge = OAUTH_COOKIE_TTL_MS;
    res.cookie(OAUTH_STATE_COOKIE, login.state, cookieOptions(maxAge));
    res.cookie(
      OAUTH_VERIFIER_COOKIE,
      login.codeVerifier,
      cookieOptions(maxAge),
    );
    res.cookie(
      OAUTH_RETURN_COOKIE,
      safeReturnPath(req.query.return),
      cookieOptions(maxAge),
    );
    res.redirect(302, login.url.toString());
  });

  app.get(`/api/auth/${provider}/callback`, async (req, res) => {
    const clearOauth = () => {
      res.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
      res.clearCookie(OAUTH_VERIFIER_COOKIE, { path: "/" });
      res.clearCookie(OAUTH_RETURN_COOKIE, { path: "/" });
    };
    const state = readCookie(req, OAUTH_STATE_COOKIE);
    const verifier = readCookie(req, OAUTH_VERIFIER_COOKIE);
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const returned = typeof req.query.state === "string" ? req.query.state : "";
    const returnPath = safeReturnPath(readCookie(req, OAUTH_RETURN_COOKIE));
    clearOauth();
    if (!state || !verifier || !code || returned !== state) {
      res.redirect(302, "/?auth=failed");
      return;
    }
    const sessionToken = readCookie(req, SESSION_COOKIE);
    const signedIn = sessionToken
      ? await userForSession(db().db, sessionToken)
      : null;
    try {
      const profile = await finish(code, verifier);
      const result = await upsertProviderUser(
        db().db,
        provider,
        profile,
        signedIn?.id ?? null,
      );
      if (signedIn !== null) {
        const link = result.type === "ok" ? provider : "already_linked";
        res.redirect(302, `/#modal=account&link=${link}`);
        return;
      }
      if (result.type !== "ok") throw new Error("no account to sign in to");
      const session = await createSession(db().db, result.user.id);
      res.cookie(SESSION_COOKIE, session.token, cookieOptions(SESSION_TTL_MS));
      res.redirect(302, returnPath);
    } catch (error) {
      log.error(`${provider} sign-in failed`, { error: String(error) });
      res.redirect(
        302,
        signedIn !== null ? "/#modal=account&link=error" : "/?auth=failed",
      );
    }
  });
}
