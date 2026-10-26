import type { Db } from "@kleopolis/db/client";
import { sessions, users } from "@kleopolis/db/schema";
import { createHash, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { SESSION_TTL_MS } from "./config";

export type UserRow = typeof users.$inferSelect;

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: hashSessionToken(token),
    userId,
    expiresAt,
  });
  return { token, expiresAt };
}

// Returns the user for a live session, or null. An expired session is deleted.
export async function userForSession(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<UserRow | null> {
  const id = hashSessionToken(token);
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.session.expiresAt.getTime() <= now.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  return row.user;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token)));
}
