import { createDb, type DbHandle } from "@kleopolis/db/client";
import { runMigrations } from "@kleopolis/db/migrate";
import { users } from "@kleopolis/db/schema";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../../../src/server/auth/sessions";
import { googleUser } from "../../util/TestUsers";

// Runs only when TEST_DATABASE_URL is set. The test database is migrated first.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("friends (database)", () => {
  let handle: DbHandle;
  let server: Server;
  let base: string;
  const ids: string[] = [];
  const me = { publicId: "", cookie: "" };
  const you = { publicId: "", cookie: "" };

  async function account(name: string) {
    const user = await googleUser(handle.db, {
      sub: `test-${randomUUID()}`,
      email: `${name}@example.com`,
      name,
      picture: null,
    });
    ids.push(user.id);
    const session = await createSession(handle.db, user.id);
    return {
      publicId: user.publicId,
      cookie: `landwar_session=${session.token}`,
    };
  }

  function call(
    who: { cookie: string },
    method: string,
    path: string,
    sameOrigin = true,
  ) {
    return fetch(`${base}/api/friends${path}`, {
      method,
      headers: {
        cookie: who.cookie,
        ...(sameOrigin ? { origin: "http://localhost:8888" } : {}),
      },
    });
  }

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!);
    process.env.DATABASE_URL = url;
    Object.assign(me, await account("Me"));
    Object.assign(you, await account("You"));
    const { registerFriendsRoutes } =
      await import("../../../src/server/friends/routes");
    const app = express();
    registerFriendsRoutes(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.close();
    const { db } = await import("../../../src/server/db");
    await db().pool.end();
    await handle.db.delete(users).where(inArray(users.id, ids));
    await handle.pool.end();
  });

  it("refuses a request without a session", async () => {
    const res = await fetch(`${base}/api/friends`);
    expect(res.status).toBe(401);
  });

  it("refuses a change from another origin", async () => {
    const res = await call(me, "POST", `/requests/${you.publicId}`, false);
    expect(res.status).toBe(403);
  });

  it("sends, lists, accepts, lists friends, and removes", async () => {
    expect((await call(me, "POST", `/requests/${me.publicId}`)).status).toBe(
      400,
    );
    expect((await call(me, "POST", "/requests/nosuchplayer")).status).toBe(404);

    const sent = await call(me, "POST", `/requests/${you.publicId}`);
    expect(await sent.json()).toEqual({ status: "requested" });
    expect((await call(me, "POST", `/requests/${you.publicId}`)).status).toBe(
      409,
    );

    const mine = (await (await call(me, "GET", "/requests")).json()) as {
      incoming: unknown[];
      outgoing: { publicId: string }[];
    };
    expect(mine.outgoing.map((e) => e.publicId)).toEqual([you.publicId]);
    const yours = (await (await call(you, "GET", "/requests")).json()) as {
      incoming: { publicId: string }[];
    };
    expect(yours.incoming.map((e) => e.publicId)).toEqual([me.publicId]);

    // Only the addressee can accept.
    expect(
      (await call(me, "POST", `/requests/${you.publicId}/accept`)).status,
    ).toBe(404);
    expect(
      (await call(you, "POST", `/requests/${me.publicId}/accept`)).status,
    ).toBe(204);

    for (const [who, other] of [
      [me, you],
      [you, me],
    ] as const) {
      const list = (await (
        await call(who, "GET", "?page=1&limit=10")
      ).json()) as {
        results: { publicId: string }[];
        total: number;
        page: number;
      };
      expect(list.total).toBe(1);
      expect(list.page).toBe(1);
      expect(list.results.map((e) => e.publicId)).toEqual([other.publicId]);
    }
    expect((await call(me, "POST", `/requests/${you.publicId}`)).status).toBe(
      409,
    );

    expect((await call(you, "DELETE", `/${me.publicId}`)).status).toBe(204);
    expect((await call(you, "DELETE", `/${me.publicId}`)).status).toBe(404);
    const after = (await (await call(me, "GET", "")).json()) as {
      total: number;
    };
    expect(after.total).toBe(0);
  });

  it("treats a request to someone who already asked as an accept", async () => {
    await call(me, "POST", `/requests/${you.publicId}`);
    const res = await call(you, "POST", `/requests/${me.publicId}`);
    expect(await res.json()).toEqual({ status: "accepted" });
    await call(me, "DELETE", `/${you.publicId}`);
  });

  it("lets either side cancel or decline a pending request", async () => {
    await call(me, "POST", `/requests/${you.publicId}`);
    expect((await call(you, "DELETE", `/requests/${me.publicId}`)).status).toBe(
      204,
    );
    await call(me, "POST", `/requests/${you.publicId}`);
    expect((await call(me, "DELETE", `/requests/${you.publicId}`)).status).toBe(
      204,
    );
    expect((await call(me, "DELETE", `/requests/${you.publicId}`)).status).toBe(
      404,
    );
  });

  it("survives two requests crossing each other", async () => {
    const [a, b] = await Promise.all([
      call(me, "POST", `/requests/${you.publicId}`),
      call(you, "POST", `/requests/${me.publicId}`),
    ]);
    // One is the request. The other is an accept or a conflict, never an error.
    expect([a.status, b.status].every((c) => c === 200 || c === 409)).toBe(
      true,
    );
    const pair = (await (await call(me, "GET", "/requests")).json()) as {
      incoming: unknown[];
      outgoing: unknown[];
    };
    const friends = (await (await call(me, "GET", "")).json()) as {
      total: number;
    };
    // Exactly one link exists for the pair.
    expect(pair.incoming.length + pair.outgoing.length + friends.total).toBe(1);
  });
});
