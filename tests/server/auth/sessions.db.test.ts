import { createDb, type DbHandle } from "@kleopolis/db/client";
import { runMigrations } from "@kleopolis/db/migrate";
import { users } from "@kleopolis/db/schema";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSession,
  deleteSession,
  userForSession,
} from "../../../src/server/auth/sessions";
import { googleUser } from "../../util/TestUsers";

// Runs only when TEST_DATABASE_URL is set. The test database is migrated first.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("sessions (database)", () => {
  let handle: DbHandle;
  const googleSub = `test-${randomUUID()}`;

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!);
  });

  afterAll(async () => {
    await handle.db.delete(users).where(eq(users.googleSub, googleSub));
    await handle.pool.end();
  });

  it("creates, resolves, and deletes a session", async () => {
    const user = await googleUser(handle.db, {
      sub: googleSub,
      email: "db-test@example.com",
      name: "DB Test",
      picture: null,
    });
    const session = await createSession(handle.db, user.id);
    const found = await userForSession(handle.db, session.token);
    expect(found?.id).toBe(user.id);

    await deleteSession(handle.db, session.token);
    expect(await userForSession(handle.db, session.token)).toBeNull();
  });

  it("refuses an expired session and removes it", async () => {
    const user = await googleUser(handle.db, {
      sub: googleSub,
      email: "db-test@example.com",
      name: "DB Test",
      picture: null,
    });
    const past = new Date(Date.now() - 60_000);
    const session = await createSession(
      handle.db,
      user.id,
      new Date(Date.now() - 31 * 24 * 3600 * 1000),
    );
    expect(await userForSession(handle.db, session.token, past)).toBeNull();
  });

  it("keeps the public id and name when the same Google account signs in again", async () => {
    const first = await googleUser(handle.db, {
      sub: googleSub,
      email: "db-test@example.com",
      name: "First",
      picture: null,
    });
    const second = await googleUser(handle.db, {
      sub: googleSub,
      email: "db-test@example.com",
      name: "Second",
      picture: null,
    });
    expect(second.id).toBe(first.id);
    expect(second.publicId).toBe(first.publicId);
    expect(second.displayName).toBe(first.displayName);
  });
});
