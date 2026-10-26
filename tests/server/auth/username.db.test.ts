import { createDb, type DbHandle } from "@kleopolis/db/client";
import { runMigrations } from "@kleopolis/db/migrate";
import { users } from "@kleopolis/db/schema";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSession } from "../../../src/server/auth/sessions";
import { findUserById } from "../../../src/server/auth/users";
import { googleUser } from "../../util/TestUsers";

// Runs only when TEST_DATABASE_URL is set. The test database is migrated first.
const url = process.env.TEST_DATABASE_URL;
const ORIGIN = "http://localhost:8888";

describe.skipIf(!url)("username change (database)", () => {
  let handle: DbHandle;
  let server: Server;
  let base: string;
  let userId = "";
  let cookie = "";
  const sub = `test-${randomUUID()}`;

  function put(body: unknown, headers: Record<string, string> = {}) {
    return fetch(`${base}/api/users/@me/username`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: ORIGIN,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!);
    vi.stubEnv("DATABASE_URL", url!);
    vi.stubEnv("PUBLIC_ORIGIN", ORIGIN);
    const user = await googleUser(handle.db, {
      sub,
      email: "real.name@example.com",
      name: "Real Name",
      picture: null,
    });
    userId = user.id;
    cookie = `landwar_session=${(await createSession(handle.db, user.id)).token}`;
    const { registerUsernameRoutes } =
      await import("../../../src/server/auth/usernameRoutes");
    const app = express();
    app.use(express.json());
    registerUsernameRoutes(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.close();
    const { db } = await import("../../../src/server/db");
    await db().pool.end();
    await handle.db.delete(users).where(inArray(users.id, [userId]));
    await handle.pool.end();
    vi.unstubAllEnvs();
  });

  it("renames the account, and a later sign-in keeps the new name", async () => {
    const res = await put({ username: "Kleo_Fan" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      username: "Kleo_Fan",
      base: "Kleo_Fan",
    });

    await googleUser(handle.db, {
      sub,
      email: "real.name@example.com",
      name: "Real Name",
      picture: null,
    });
    expect((await findUserById(handle.db, userId))?.displayName).toBe(
      "Kleo_Fan",
    );
  });

  it("refuses an invalid or profane name", async () => {
    expect((await put({ username: "a" })).status).toBe(400);
    expect((await put({ username: "dots.not.allowed" })).status).toBe(400);
    const profane = await put({ username: "fuck" });
    expect(profane.status).toBe(400);
    expect(await profane.json()).toEqual({ code: "USERNAME_PROFANE" });
  });

  it("refuses a request without a session or from another site", async () => {
    expect((await put({ username: "Valid" }, { cookie: "" })).status).toBe(401);
    expect(
      (await put({ username: "Valid" }, { origin: "https://evil.example" }))
        .status,
    ).toBe(403);
  });
});
