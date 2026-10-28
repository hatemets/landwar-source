import type { Db } from "@kleopolis/db/client";
import { users } from "@kleopolis/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { trackServer } from "../Analytics";
import type { ProviderProfile } from "./google";
import type { UserRow } from "./sessions";

// Public ids use lowercase letters and digits only, so they read well in URLs.
const publicIdAlphabet = customAlphabet(
  "abcdefghijklmnopqrstuvwxyz0123456789",
  10,
);

export type AuthProvider = "google" | "discord";

const providerColumn = {
  google: users.googleSub,
  discord: users.discordId,
} as const;

const providerField = {
  google: "googleSub",
  discord: "discordId",
} as const;

export type ProviderSignIn =
  | { type: "ok"; user: UserRow }
  // The provider account already belongs to a different player.
  | { type: "already_linked" };

// Finds or creates the account for a provider sign-in.
//
// - `signedInId` set: the player is linking this provider to the account they
//   are signed in to.
// - The provider account is known: that account. Later sign-ins refresh the
//   email and picture. The name is the player's own once set, so a sign-in
//   never resets it.
// - An account with the same email has no account of this provider yet: the
//   provider joins it. Google and Discord both verify the email, so this is
//   the same person signing in another way.
// - Otherwise a new account. The public id never changes.
export async function upsertProviderUser(
  db: Db,
  provider: AuthProvider,
  profile: ProviderProfile,
  signedInId: string | null = null,
): Promise<ProviderSignIn> {
  const column = providerColumn[provider];
  const field = providerField[provider];
  const [owner] = await db
    .select()
    .from(users)
    .where(eq(column, profile.sub))
    .limit(1);

  if (signedInId !== null) {
    if (owner && owner.id !== signedInId) return { type: "already_linked" };
    const [linked] = await db
      .update(users)
      .set({ [field]: profile.sub })
      .where(eq(users.id, signedInId))
      .returning();
    if (!linked) throw new Error("user link returned no row");
    return { type: "ok", user: linked };
  }

  if (owner) {
    const [updated] = await db
      .update(users)
      .set({
        email: profile.email,
        avatarUrl: profile.picture ?? owner.avatarUrl,
      })
      .where(eq(users.id, owner.id))
      .returning();
    if (!updated) throw new Error("user update returned no row");
    return { type: "ok", user: updated };
  }

  const [sameEmail] = await db
    .select()
    .from(users)
    .where(
      and(sql`lower(${users.email}) = lower(${profile.email})`, isNull(column)),
    )
    .orderBy(users.createdAt)
    .limit(1);
  if (sameEmail) {
    const [joined] = await db
      .update(users)
      .set({
        [field]: profile.sub,
        avatarUrl: sameEmail.avatarUrl ?? profile.picture,
      })
      .where(eq(users.id, sameEmail.id))
      .returning();
    if (!joined) throw new Error("user link returned no row");
    return { type: "ok", user: joined };
  }

  const [created] = await db
    .insert(users)
    .values({
      [field]: profile.sub,
      email: profile.email,
      displayName: profile.name,
      avatarUrl: profile.picture,
      publicId: publicIdAlphabet(),
    })
    .returning();
  if (!created) throw new Error("user insert returned no row");
  trackServer(created.id, "signed_up", { provider: field });
  return { type: "ok", user: created };
}

// Looks up an account by id. Returns null when no such account exists.
export async function findUserById(
  db: Db,
  id: string,
): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

// Renames an account. Returns the updated row, or null when no such account
// exists.
export async function setDisplayName(
  db: Db,
  id: string,
  displayName: string,
): Promise<UserRow | null> {
  const [updated] = await db
    .update(users)
    .set({ displayName })
    .where(eq(users.id, id))
    .returning();
  return updated ?? null;
}
