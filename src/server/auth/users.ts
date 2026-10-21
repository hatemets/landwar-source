import type { Db } from "@landwar/db/client";
import { users } from "@landwar/db/schema";
import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import type { GoogleProfile } from "./google";
import type { UserRow } from "./sessions";

// Public ids use lowercase letters and digits only, so they read well in URLs.
const publicIdAlphabet = customAlphabet(
  "abcdefghijklmnopqrstuvwxyz0123456789",
  10,
);

// Creates the account on first sign-in. Later sign-ins refresh the email,
// name, and picture from Google. The public id never changes.
export async function upsertGoogleUser(
  db: Db,
  profile: GoogleProfile,
): Promise<UserRow> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.googleSub, profile.sub))
    .limit(1);
  if (existing[0]) {
    const [updated] = await db
      .update(users)
      .set({
        email: profile.email,
        displayName: profile.name,
        avatarUrl: profile.picture,
      })
      .where(eq(users.id, existing[0].id))
      .returning();
    if (!updated) throw new Error("user update returned no row");
    return updated;
  }
  const [created] = await db
    .insert(users)
    .values({
      googleSub: profile.sub,
      email: profile.email,
      displayName: profile.name,
      avatarUrl: profile.picture,
      publicId: publicIdAlphabet(),
    })
    .returning();
  if (!created) throw new Error("user insert returned no row");
  return created;
}

// Looks up an account by id. Returns null when no such account exists.
export async function findUserById(
  db: Db,
  id: string,
): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}
