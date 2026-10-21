import { createDb, type DbHandle } from "@landwar/db/client";
import { runMigrations } from "@landwar/db/migrate";
import { users } from "@landwar/db/schema";
import { eq } from "drizzle-orm";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registerAuthRoutes } from "../../../src/server/auth/routes";
import { FakeGoogle } from "../../util/FakeGoogle";

// Runs only when TEST_DATABASE_URL is set. It walks the real sign-in routes
// against a stand-in for Google: redirect out, redirect back, session cookie.
const url = process.env.TEST_DATABASE_URL;
const SECRET = "fake-google-secret";

describe.skipIf(!url)("Google sign-in (database)", () => {
  let handle: DbHandle;
  let google: FakeGoogle;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!);
    google = new FakeGoogle(SECRET);
    await google.start();
    vi.stubEnv("GAME_ENV", "dev");
    vi.stubEnv("DATABASE_URL", url!);
    vi.stubEnv("GOOGLE_OAUTH_BASE_URL", google.baseUrl);
    vi.stubEnv("GOOGLE_CLIENT_ID", "fake-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", SECRET);
    vi.stubEnv("PUBLIC_ORIGIN", "http://localhost:8888");
    const app = express();
    app.use(express.json());
    registerAuthRoutes(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.close();
    await google.stop();
    await handle.db
      .delete(users)
      .where(eq(users.googleSub, google.profile.sub));
    const { db } = await import("../../../src/server/db");
    await db().pool.end();
    await handle.pool.end();
    vi.unstubAllEnvs();
  });

  // Collects Set-Cookie values into a request Cookie header.
  function cookies(res: Response, jar: Map<string, string>) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const [name, ...rest] = pair!.split("=");
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(line)) jar.delete(name!);
      else jar.set(name!, rest.join("="));
    }
  }
  const header = (jar: Map<string, string>) =>
    [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

  it("signs a player in through the whole flow", async () => {
    const jar = new Map<string, string>();

    // 1. The site sends the browser to Google, with PKCE and a state.
    const start = await fetch(`${base}/api/auth/google?return=/player/x`, {
      redirect: "manual",
    });
    expect(start.status).toBe(302);
    cookies(start, jar);
    const authUrl = new URL(start.headers.get("location")!);
    expect(authUrl.origin).toBe(google.baseUrl);
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("client_id")).toBe("fake-client");

    // 2. Google approves and sends the browser back with a code.
    const approved = await fetch(authUrl, { redirect: "manual" });
    const callbackUrl = new URL(approved.headers.get("location")!);
    expect(callbackUrl.pathname).toBe("/api/auth/google/callback");

    // 3. The callback exchanges the code, makes the account, sets a session.
    const callback = await fetch(
      `${base}${callbackUrl.pathname}${callbackUrl.search}`,
      {
        redirect: "manual",
        headers: { cookie: header(jar) },
      },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/player/x");
    cookies(callback, jar);
    expect(jar.has("landwar_session")).toBe(true);
    expect(google.requests).toEqual(["auth", "token", "userinfo"]);

    // 4. The session names the account.
    const me = await fetch(`${base}/api/me`, {
      headers: { cookie: header(jar) },
    });
    const body = (await me.json()) as {
      user: { displayName: string; email: string };
    };
    expect(body.user).toMatchObject({
      displayName: "Fake Player",
      email: "fake.player@example.com",
    });

    // 5. A join token for that session is an account token.
    const token = await fetch(`${base}/api/auth/token`, {
      method: "POST",
      headers: {
        cookie: header(jar),
        origin: "http://localhost:8888",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(((await token.json()) as { kind: string }).kind).toBe("user");

    // 6. Logging out ends the session.
    const out = await fetch(`${base}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: header(jar), origin: "http://localhost:8888" },
    });
    expect(out.status).toBe(204);
    const after = await fetch(`${base}/api/me`, {
      headers: { cookie: header(jar) },
    });
    expect(((await after.json()) as { user: unknown }).user).toBeNull();
  });

  it("signing in again keeps the same account", async () => {
    const before = await handle.db
      .select()
      .from(users)
      .where(eq(users.googleSub, google.profile.sub));
    const jar = new Map<string, string>();
    const start = await fetch(`${base}/api/auth/google`, {
      redirect: "manual",
    });
    cookies(start, jar);
    const approved = await fetch(start.headers.get("location")!, {
      redirect: "manual",
    });
    const cb = new URL(approved.headers.get("location")!);
    await fetch(`${base}${cb.pathname}${cb.search}`, {
      redirect: "manual",
      headers: { cookie: header(jar) },
    });
    const after = await handle.db
      .select()
      .from(users)
      .where(eq(users.googleSub, google.profile.sub));
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before[0]!.id);
    expect(after[0]!.publicId).toBe(before[0]!.publicId);
  });

  it("rejects a callback whose state does not match", async () => {
    const jar = new Map<string, string>();
    const start = await fetch(`${base}/api/auth/google`, {
      redirect: "manual",
    });
    cookies(start, jar);
    const approved = await fetch(start.headers.get("location")!, {
      redirect: "manual",
    });
    const cb = new URL(approved.headers.get("location")!);
    cb.searchParams.set("state", "forged");
    const res = await fetch(`${base}${cb.pathname}${cb.search}`, {
      redirect: "manual",
      headers: { cookie: header(jar) },
    });
    expect(res.headers.get("location")).toBe("/?auth=failed");
    expect(res.headers.getSetCookie().join(";")).not.toContain(
      "landwar_session=",
    );
  });

  it("rejects a code replayed with the wrong verifier", async () => {
    const jar = new Map<string, string>();
    const start = await fetch(`${base}/api/auth/google`, {
      redirect: "manual",
    });
    cookies(start, jar);
    jar.set("landwar_oauth_verifier", "x".repeat(64));
    const approved = await fetch(start.headers.get("location")!, {
      redirect: "manual",
    });
    const cb = new URL(approved.headers.get("location")!);
    const res = await fetch(`${base}${cb.pathname}${cb.search}`, {
      redirect: "manual",
      headers: { cookie: header(jar) },
    });
    expect(res.headers.get("location")).toBe("/?auth=failed");
  });
});
